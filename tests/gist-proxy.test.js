import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGistApi, GIST_PROXY_FRESH_MS } from '../apps/web/src/gist-proxy.ts';

// ホスト版 Worker の /gist-api/gists/<id> 中継 (#142)。
// 共有回線 (授業・会場) から数十人が開いても利用者の IP の枠を消費しないよう、
// Worker がトークン付きで GitHub に問い合わせ、ETag の 304 (認証付きなら枠を消費しない)
// で鮮度を確かめる。ここでは fetch / cache / 時刻を差し替えて振る舞いを固定する。

const ID = '5880276ae98f45363351a5ba4c835ce2';
const TOKEN = 'test-token';

function gistBody(content) {
  return JSON.stringify({ id: ID, files: { 'index.html': { filename: 'index.html', content } } });
}

/** caches.default 相当。キーは URL 文字列。 */
function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const hit = store.get(typeof req === 'string' ? req : req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      store.set(typeof req === 'string' ? req : req.url, res.clone());
    },
    async delete(req) {
      return store.delete(typeof req === 'string' ? req : req.url);
    },
  };
}

/** 呼ばれた順に responses を返す fetch。Error を入れると reject する。 */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected upstream fetch');
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

/**
 * @param {{ responses?: Array<Response | Error>, token?: string, cache?: ReturnType<typeof fakeCache>, log?: (message: string) => void }} [options]
 */
function setup(options = {}) {
  const { responses = [], cache = fakeCache() } = options;
  // token: undefined を「未設定」として渡せるよう、既定値の引数は使わない
  const token = 'token' in options ? options.token : TOKEN;
  let now = 1_000_000;
  const pending = [];
  const fetch = fakeFetch(responses);
  /** @type {import('../apps/web/src/gist-proxy.ts').GistProxyDeps} */
  const deps = {
    fetch,
    cache,
    token,
    now: () => now,
    waitUntil: (p) => { pending.push(p); },
    log: options.log ?? (() => {}),
  };
  return {
    fetch,
    cache,
    advance(ms) { now += ms; },
    async request(path = `/gist-api/gists/${ID}`, init = {}) {
      const req = new Request(`https://dropcaster.example${path}`, init);
      const res = await handleGistApi(req, new URL(req.url), deps);
      await Promise.all(pending.splice(0));
      return res;
    },
  };
}

function upstream(status, body = '', headers = {}) {
  return new Response(status === 304 ? null : body, { status, headers });
}

test('first request fetches GitHub with the server token and caches the body', async () => {
  const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"', 'content-type': 'application/json' })] });
  const res = await s.request();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'miss');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.match(await res.text(), /v1/);
  assert.equal(s.fetch.calls.length, 1);
  assert.equal(s.fetch.calls[0].url, `https://api.github.com/gists/${ID}`);
  assert.equal(s.fetch.calls[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(s.fetch.calls[0].headers.get('if-none-match'), null);
  assert.ok(s.fetch.calls[0].headers.get('user-agent'), 'GitHub API は User-Agent 必須');
  assert.equal(s.cache.store.size, 1);
});

test('a request within the fresh window is served from cache without asking GitHub', async () => {
  const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"' })] });
  await s.request();
  s.advance(GIST_PROXY_FRESH_MS - 1);
  const res = await s.request();
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'hit');
  assert.match(await res.text(), /v1/);
  assert.equal(s.fetch.calls.length, 1);
});

test('after the fresh window it revalidates with If-None-Match and serves the cache on 304', async () => {
  const s = setup({ responses: [
    upstream(200, gistBody('v1'), { etag: 'W/"v1"' }),
    upstream(304, '', { etag: 'W/"v1"' }),
  ] });
  await s.request();
  s.advance(GIST_PROXY_FRESH_MS);
  const res = await s.request();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'revalidated');
  assert.match(await res.text(), /v1/);
  assert.equal(s.fetch.calls[1].headers.get('if-none-match'), 'W/"v1"');
  assert.equal(s.fetch.calls[1].headers.get('authorization'), `Bearer ${TOKEN}`);
  // 304 で取得時刻を更新するので、直後は再び問い合わせない
  s.advance(1);
  assert.equal((await s.request()).headers.get('x-dc-gist-proxy'), 'hit');
  assert.equal(s.fetch.calls.length, 2);
});

test('an updated gist (200 on revalidation) replaces the cache', async () => {
  const s = setup({ responses: [
    upstream(200, gistBody('v1'), { etag: 'W/"v1"' }),
    upstream(200, gistBody('v2'), { etag: 'W/"v2"' }),
    upstream(304, '', { etag: 'W/"v2"' }),
  ] });
  await s.request();
  s.advance(GIST_PROXY_FRESH_MS);
  const res = await s.request();
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'miss');
  assert.match(await res.text(), /v2/);
  s.advance(GIST_PROXY_FRESH_MS);
  await s.request();
  assert.equal(s.fetch.calls[2].headers.get('if-none-match'), 'W/"v2"');
});

test('a deleted gist (404) drops the cache and returns 404', async () => {
  const s = setup({ responses: [
    upstream(200, gistBody('v1'), { etag: 'W/"v1"' }),
    upstream(404, '{"message":"Not Found"}'),
  ] });
  await s.request();
  s.advance(GIST_PROXY_FRESH_MS);
  const res = await s.request();
  assert.equal(res.status, 404);
  assert.equal(s.cache.store.size, 0, '削除・非公開になった Gist を古いキャッシュで出し続けない');
});

/** @type {Array<[string, () => Response | Error]>} */
const transientFailures = [
  ['server error (502)', () => upstream(502, 'bad gateway')],
  ['network failure', () => new Error('network down')],
];
for (const [label, res] of transientFailures) {
  test(`upstream ${label} serves the cached copy marked stale`, async () => {
    const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"' }), res()] });
    await s.request();
    s.advance(GIST_PROXY_FRESH_MS);
    const out = await s.request();
    assert.equal(out.status, 200);
    assert.equal(out.headers.get('x-dc-gist-proxy'), 'stale');
    assert.equal(out.headers.get('x-dc-stale'), '1');
    assert.match(await out.text(), /v1/);
  });
}

// トークンの失効・枠の枯渇は一時的な障害ではない。古い版を 200 で返し続けると、
// 作者が直しても反映されないまま (エッジ TTL の間) 気付けない。キャッシュがあっても
// 上流のステータスを返す (viewer は直接取得のエラーを出す。ADR 0018)。
/** @type {Array<[string, () => Response]>} */
const tokenFailures = [
  ['token rejected (401)', () => upstream(401, '{"message":"Bad credentials"}')],
  ['rate limit (403 + remaining 0)', () => upstream(403, '{}', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794590000' })],
  ['secondary rate limit (429)', () => upstream(429, '{}', { 'retry-after': '60' })],
];
for (const [label, res] of tokenFailures) {
  test(`upstream ${label} is passed through even with a cache, and logged`, async () => {
    const logs = [];
    const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"' }), res()], log: (m) => logs.push(m) });
    await s.request();
    s.advance(GIST_PROXY_FRESH_MS);
    const out = await s.request();
    assert.notEqual(out.status, 200);
    assert.equal(out.headers.get('x-dc-gist-proxy'), 'error');
    assert.equal(out.headers.get('x-dc-stale'), null);
    assert.equal(logs.length, 1, 'メンテナが失効・枯渇に気付けるよう記録する');
  });
}

test('upstream rate limit without a cache passes the status and rate-limit headers through', async () => {
  const s = setup({ responses: [upstream(403, '{"message":"rate limit"}', {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794590000',
  })] });
  const res = await s.request();
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('x-ratelimit-remaining'), '0');
  assert.equal(res.headers.get('x-ratelimit-reset'), '1794590000');
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'error');
});

test('network failure without a cache returns 502', async () => {
  const s = setup({ responses: [new Error('network down')] });
  const res = await s.request();
  assert.equal(res.status, 502);
});

test('without a token it refuses with 503 instead of calling GitHub unauthenticated', async () => {
  const s = setup({ token: undefined });
  const res = await s.request();
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'unconfigured');
  assert.equal(s.fetch.calls.length, 0, 'トークン無しでは Cloudflare の共有 IP から認証なしで叩かない');
});

test('only GET /gist-api/gists/<hex id> is proxied', async () => {
  const s = setup();
  for (const path of [
    '/gist-api/gists/not-hex',
    '/gist-api/gists/abc',
    `/gist-api/gists/${ID}/commits`,
    '/gist-api/users/octocat',
    '/gist-api/rate_limit',
  ]) {
    assert.equal((await s.request(path)).status, 404, path);
  }
  assert.equal((await s.request(`/gist-api/gists/${ID}`, { method: 'POST' })).status, 405);
  assert.equal(s.fetch.calls.length, 0);
});

test('the cache key stays on the request origin (Cloudflare caches only in-zone URLs)', async () => {
  const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"' })] });
  await s.request();
  assert.deepEqual([...s.cache.store.keys()], [`https://dropcaster.example/gist-api/gists/${ID}`]);
});

test('upper-case ids are normalized to the same cache entry', async () => {
  const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"' })] });
  await s.request(`/gist-api/gists/${ID}`);
  const res = await s.request(`/gist-api/gists/${ID.toUpperCase()}`);
  assert.equal(res.headers.get('x-dc-gist-proxy'), 'hit');
  assert.equal(s.fetch.calls.length, 1);
});

test('HEAD returns headers without a body', async () => {
  const s = setup({ responses: [upstream(200, gistBody('v1'), { etag: 'W/"v1"' })] });
  const res = await s.request(`/gist-api/gists/${ID}`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});
