// /gist-api/gists/<id> — GitHub Gist API の中継 (#142, ADR 0017)。
//
// 授業や会場のように同じグローバル IP から数十人が使うと、viewer が GitHub API を
// 認証なしで直接呼ぶ経路は「60 req/時・IP 単位」の枠を全員で分け合って枯渇する。
// ホスト版では Worker が dropcaster のトークン (権限なし) で問い合わせ、利用者の IP の
// 枠を使わない。
//
// 鮮度は ETag で確かめる。認証付きの 304 は GitHub の枠を消費しないので、毎回最新を
// 確かめつつ、枠を使うのは Gist の中身が変わったときだけになる。FRESH_MS 以内の
// 再要求は問い合わせずに返し、同時アクセス (教室で一斉に開く等) をまとめる。
//
// worker.ts から振り分けるだけにして、fetch / cache / 時刻を差し替えられる形にしている
// (tests/gist-proxy.test.js が Node から直接 import する。他モジュールを import しないこと)。

export const GIST_PROXY_PREFIX = '/gist-api/';
/** この時間内の再要求は GitHub に確かめずにキャッシュを返す。作者の更新が遅れて見えるのは最大でこの時間。 */
export const GIST_PROXY_FRESH_MS = 5_000;

const GIST_PATH = /^\/gist-api\/gists\/([0-9a-f]{20,64})\/?$/i;
const UPSTREAM_BASE = 'https://api.github.com/gists/';
const API_VERSION = '2022-11-28';
/** エッジに置く期間。鮮度は ETag の再検証で担保するので長くてよい。 */
const EDGE_TTL_SECONDS = 60 * 60 * 24 * 30;
const FETCHED_AT_HEADER = 'x-dc-fetched-at';
const PASSTHROUGH_HEADERS = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'];

interface ProxyCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

export interface GistProxyDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  cache: ProxyCache;
  /** wrangler の secret GITHUB_TOKEN。未設定なら中継しない (503)。 */
  token?: string;
  now: () => number;
  waitUntil: (promise: Promise<unknown>) => void;
}

type ProxyState = 'hit' | 'revalidated' | 'miss' | 'stale' | 'error' | 'unconfigured';

export async function handleGistApi(req: Request, url: URL, deps: GistProxyDeps): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  // 公開 Gist の読み取りだけを中継する。任意の GitHub API の踏み台にはしない。
  const match = url.pathname.match(GIST_PATH);
  if (!match) return new Response('Not Found', { status: 404 });
  const id = match[1].toLowerCase();

  // トークン無しで Cloudflare の共有 IP から認証なしで叩くと、他テナントと枠を分け合って
  // すぐ枯れる。中継を断り、クライアントに GitHub への直接取得へ切り替えさせる。
  if (!deps.token) return respond(req, new Response('Gist proxy is not configured', { status: 503 }), 'unconfigured');

  const cacheKey = new Request(`https://gist-proxy.internal/gists/${id}`);
  const cached = await deps.cache.match(cacheKey);
  if (cached && deps.now() - Number(cached.headers.get(FETCHED_AT_HEADER) || 0) < GIST_PROXY_FRESH_MS) {
    return respond(req, cached, 'hit');
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'dropcaster-gist-proxy',
    Authorization: `Bearer ${deps.token}`,
  };
  const etag = cached?.headers.get('etag');
  if (etag) headers['If-None-Match'] = etag;

  let upstream: Response;
  try {
    upstream = await deps.fetch(`${UPSTREAM_BASE}${id}`, { headers });
  } catch {
    if (cached) return respond(req, cached, 'stale');
    return respond(req, new Response('Bad Gateway', { status: 502 }), 'error');
  }

  if (upstream.status === 304 && cached) {
    const refreshed = toCacheEntry(await cached.arrayBuffer(), cached.headers, deps.now());
    deps.waitUntil(deps.cache.put(cacheKey, refreshed.clone()));
    return respond(req, refreshed, 'revalidated');
  }
  if (upstream.status === 200) {
    const entry = toCacheEntry(await upstream.arrayBuffer(), upstream.headers, deps.now());
    deps.waitUntil(deps.cache.put(cacheKey, entry.clone()));
    return respond(req, entry, 'miss');
  }
  if (upstream.status === 404) {
    // 削除・非公開化された Gist を古いキャッシュで出し続けない
    deps.waitUntil(deps.cache.delete(cacheKey));
    return respond(req, passthrough(upstream), 'error');
  }
  // 制限 (403 + remaining 0 / 429)・認証失敗・5xx。手元に版があればそれを返して投影を止めない。
  if (cached) return respond(req, cached, 'stale');
  return respond(req, passthrough(upstream), 'error');
}

/** キャッシュに置く形。本文と、再検証・表示に要るヘッダだけを持つ。 */
function toCacheEntry(body: ArrayBuffer, source: Headers, fetchedAt: number): Response {
  const headers = new Headers();
  for (const name of ['content-type', 'etag', 'last-modified']) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  headers.set(FETCHED_AT_HEADER, String(fetchedAt));
  headers.set('cache-control', `public, s-maxage=${EDGE_TTL_SECONDS}`);
  return new Response(body, { status: 200, headers });
}

/** 上流のエラー応答を、クライアントの判定に要るヘッダ (レート制限) だけ残して返す。 */
function passthrough(upstream: Response): Response {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function respond(req: Request, source: Response, state: ProxyState): Response {
  const headers = new Headers(source.headers);
  headers.delete(FETCHED_AT_HEADER);
  // 鮮度は Worker が判断する。ブラウザの HTTP キャッシュに古い版を残さない。
  headers.set('cache-control', 'no-cache');
  headers.set('x-dc-gist-proxy', state);
  if (state === 'stale') headers.set('x-dc-stale', '1');
  const body = req.method === 'HEAD' ? null : source.body;
  return new Response(body, { status: source.status, headers });
}
