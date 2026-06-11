// dropcaster 統合 Worker
//
// 1 つの Cloudflare Worker で 2 つの責務を兼ねる:
//   1. /op-cdn/* — OpenProcessing CDN (deckard.openprocessing.org) への proxy。
//                  Access-Control-Allow-Origin: * を後付けして CORS を有効化。
//                  これにより viewer の iframe (about:srcdoc) から
//                  crossOrigin='anonymous' で取得しても canvas が tainted に
//                  ならず、captureStream → 投影マッピングが成立する。
//   2. それ以外  — wrangler.toml の `[assets]` で宣言した dist/ の静的ファイルを返す。
//                  not_found_handling = "single-page-application" により、未マッチ時は
//                  index.html を返すので /op/<id> のような SPA ルートも自然に動く。
//
// 旧構成では proxy が別 Worker (workers.dev) にあり、viewer はクロスオリジン URL を
// 書き換えていた。本統合により proxy は **同一オリジン** (`/op-cdn/...`) になり、
// CORS の特殊扱い・SW の cross-origin キャッシュ判定・dev/prod 間の URL 差異が消える。

const OP_CDN_PREFIX = '/op-cdn/';
const UPSTREAM_ORIGIN = 'https://deckard.openprocessing.org';
const ALLOWED_UPSTREAM_PATTERN = /^user\d+\//; // S3 の /user{id}/visual{id}/... 配下のみ許可
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';
const CACHE_TTL_BROWSER = 86400;            // 1 日 (ブラウザ side max-age)
const CACHE_TTL_EDGE = 60 * 60 * 24 * 30;   // 30 日 (Cloudflare エッジ s-maxage)

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith(OP_CDN_PREFIX)) {
      return proxyOpCdn(req, url, ctx);
    }

    // 静的アセット (HTML / JS / CSS / sw.js / manifest / アイコン)。
    // wrangler の Static Assets は path-not-found を SPA fallback (index.html) に流す。
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function proxyOpCdn(req: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
  }

  const tail = url.pathname.slice(OP_CDN_PREFIX.length);
  if (!ALLOWED_UPSTREAM_PATTERN.test(tail)) {
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
  }

  const upstreamUrl = `${UPSTREAM_ORIGIN}/${tail}${url.search}`;
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });
  const cache = caches.default;

  let res = await cache.match(cacheKey);
  if (!res) {
    // fetch 層の cf キャッシュ指定（cacheTtl + cacheEverything）は使わない:
    // status を問わず TTL が効くため、上流の一時的な 404/5xx までエッジに固着していた。
    // エッジキャッシュは下の caches.default.put（res.ok 時のみ・s-maxage 付き）で行う。
    const upstream = await fetch(upstreamUrl);
    const headers = new Headers(upstream.headers);
    applyCorsHeaders(headers);
    if (upstream.ok) {
      headers.set('Cache-Control', `public, max-age=${CACHE_TTL_BROWSER}, s-maxage=${CACHE_TTL_EDGE}, immutable`);
    } else {
      // エラーをブラウザに 1 日キャッシュさせない（上流復旧後も失敗し続けるのを防ぐ）
      headers.set('Cache-Control', 'no-store');
    }
    headers.delete('Vary'); // ACAO=* なら Origin によるバリアントは不要
    res = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
    // 304 は条件付きリクエストを上流へ転送していない以上返らないし、
    // ボディ無し応答を cache.put すると以後の GET にそのまま返ってしまうので ok のみ
    if (res.ok) {
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
  } else {
    res = new Response(res.body, res);
    applyCorsHeaders(res.headers);
  }

  if (req.method === 'HEAD') {
    return new Response(null, { status: res.status, headers: res.headers });
  }
  return res;
}

function corsHeaders(): Headers {
  const h = new Headers();
  applyCorsHeaders(h);
  return h;
}

function applyCorsHeaders(h: Headers): void {
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  h.set('Access-Control-Expose-Headers', '*');
}

function preflightResponse(): Response {
  const h = corsHeaders();
  h.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers: h });
}
