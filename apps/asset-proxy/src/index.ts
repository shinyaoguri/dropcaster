// dropcaster asset proxy — Cloudflare Worker
//
// OpenProcessing の CDN (https://deckard.openprocessing.org) を同一オリジン化して
// `Access-Control-Allow-Origin: *` を付けて返す。これにより viewer の iframe
// (about:srcdoc) から crossOrigin='anonymous' で取得でき、canvas が tainted に
// ならないので captureStream → 投影マッピングが成立する。
//
// 経路:
//   worker URL: https://dropcaster-asset-proxy.<account>.workers.dev/user.../X.png
//        ↓ proxy
//   upstream:   https://deckard.openprocessing.org/user.../X.png
//
// 任意 URL の prefetch を防ぐため、upstream パスは ALLOWED_PREFIXES のいずれかで
// 始まることを要求する (OP の S3 バケット構造は user{ID}/visual{ID}/... のみ)。
//
// キャッシュ: Cloudflare の Cache API を使ってエッジでキャッシュする。アセット URL は
// content hash (h<32hex>) を含むので immutable 扱いで良い。

const UPSTREAM = 'https://deckard.openprocessing.org';
const ALLOWED_PREFIXES = ['/user'];
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';
const CACHE_TTL_BROWSER = 86400;      // 1 day
const CACHE_TTL_EDGE = 60 * 60 * 24 * 30; // 30 days

export default {
  async fetch(req: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (req.method === 'OPTIONS') return preflightResponse();

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
    }

    const url = new URL(req.url);
    if (!ALLOWED_PREFIXES.some(p => url.pathname.startsWith(p))) {
      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    }

    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    const cacheKey = new Request(upstreamUrl, { method: 'GET' });
    const cache = caches.default;

    let res = await cache.match(cacheKey);
    if (!res) {
      const upstream = await fetch(upstreamUrl, {
        cf: { cacheTtl: CACHE_TTL_EDGE, cacheEverything: true },
      });
      // Body をストリームのまま流用しつつ、headers だけ差し替えた新しい Response を作る
      const headers = new Headers(upstream.headers);
      // CORS と Cache-Control を上書き
      applyCorsHeaders(headers);
      headers.set('Cache-Control', `public, max-age=${CACHE_TTL_BROWSER}, s-maxage=${CACHE_TTL_EDGE}, immutable`);
      // upstream の Vary: Origin はオリジン別キャッシュで混乱の元になるので消す
      headers.delete('Vary');
      res = new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
      // 成功系のみキャッシュへ。エラーは透過
      if (res.ok || res.status === 304) {
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      }
    } else {
      // キャッシュ HIT 時もヘッダ強制 (Cache に積んだ後で挙動を変えた場合の保険)
      res = new Response(res.body, res);
      applyCorsHeaders(res.headers);
    }

    // HEAD なら body は流さない (Cloudflare Workers の HEAD ハンドリング)
    if (req.method === 'HEAD') {
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return res;
  },
} satisfies ExportedHandler;

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
