import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGist,
  GistNotFoundError,
  GistRateLimitError,
} from '../src/core/modules/gist-api-client.js';

// viewer の Gist 取得: ホスト版は同一オリジンの中継 (/gist-api) を優先し、
// 中継が使えないときだけ GitHub に直接つなぐ (#142)。ギャラリーは中継を設定しない。

const ID = '5880276ae98f45363351a5ba4c835ce2';
const DIRECT = `https://api.github.com/gists/${ID}`;
const PROXY = `/gist-api/gists/${ID}`;
const realFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = realFetch; });

function gistJson(content) {
  return JSON.stringify({
    id: ID,
    owner: { login: 'someone' },
    files: { 'index.html': { filename: 'index.html', content } },
  });
}

/** URL ごとに応答を決める fetch。呼ばれた URL を記録する。 */
function routeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const key = String(url);
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    const value = route();
    if (value instanceof Error) throw value;
    return value;
  };
  return calls;
}

const ok = (content) => () => new Response(gistJson(content), { status: 200 });

test('without a proxy it fetches GitHub directly (gallery)', async () => {
  const calls = routeFetch({ [DIRECT]: ok('direct') });
  const gist = await fetchGist(ID);
  assert.equal(gist.files.get('index.html'), 'direct');
  assert.deepEqual(calls, [DIRECT]);
});

test('with a proxy it uses the proxy and does not touch GitHub directly', async () => {
  const calls = routeFetch({ [PROXY]: ok('proxied') });
  const gist = await fetchGist(ID, { proxyBaseUrl: '/gist-api' });
  assert.equal(gist.files.get('index.html'), 'proxied');
  assert.deepEqual(calls, [PROXY]);
});

test('a trailing slash on the proxy base is tolerated', async () => {
  const calls = routeFetch({ [PROXY]: ok('proxied') });
  await fetchGist(ID, { proxyBaseUrl: '/gist-api/' });
  assert.deepEqual(calls, [PROXY]);
});

for (const [label, proxy] of [
  ['unconfigured (503)', () => new Response('', { status: 503 })],
  ['rate limited (403 + remaining 0)', () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })],
  ['server error (502)', () => new Response('', { status: 502 })],
  ['network failure', () => new TypeError('Failed to fetch')],
  ['non-JSON 200', () => new Response('<html>', { status: 200 })],
]) {
  test(`falls back to GitHub directly when the proxy is ${label}`, async () => {
    const calls = routeFetch({ [PROXY]: proxy, [DIRECT]: ok('direct') });
    const gist = await fetchGist(ID, { proxyBaseUrl: '/gist-api' });
    assert.equal(gist.files.get('index.html'), 'direct');
    assert.deepEqual(calls, [PROXY, DIRECT]);
  });
}

test('a 404 from the proxy means the gist does not exist; GitHub is not asked again', async () => {
  const calls = routeFetch({ [PROXY]: () => new Response('{}', { status: 404, headers: { 'x-dc-gist-proxy': 'error' } }) });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), GistNotFoundError);
  assert.deepEqual(calls, [PROXY]);
});

test('a 404 that did not come from the proxy (no proxy deployed there) falls back to GitHub directly', async () => {
  // gistApiBaseUrl を設定したが、そのパスに中継が居ない静的ホスト。全 Gist が「見つからない」にならない。
  const calls = routeFetch({ [PROXY]: () => new Response('Not Found', { status: 404 }), [DIRECT]: ok('direct') });
  const gist = await fetchGist(ID, { proxyBaseUrl: '/gist-api' });
  assert.equal(gist.files.get('index.html'), 'direct');
  assert.deepEqual(calls, [PROXY, DIRECT]);
});

test('when both the proxy and GitHub are rate limited it reports the direct rate limit', async () => {
  const reset = Math.floor(Date.now() / 1000) + 120;
  routeFetch({
    [PROXY]: () => new Response('', { status: 503 }),
    [DIRECT]: () => new Response('{}', {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    }),
  });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), (err) => {
    assert.ok(err instanceof GistRateLimitError);
    assert.ok(err.retryAfterMs > 60_000 && err.retryAfterMs <= 120_000);
    return true;
  });
});
