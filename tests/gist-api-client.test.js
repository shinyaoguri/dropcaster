import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGist,
  GistNotFoundError,
  GistRateLimitError,
  GistFormatError,
} from '../src/core/modules/gist-api-client.js';

// viewer の Gist 取得: GitHub への直接取得が基本の経路 (#144, ADR 0018)。
// ホスト版は同一オリジンの中継 (/gist-api) を予備に持ち、直接取得が使えない
// (教室の IP の枠が枯れた・障害) ときだけ中継を試す。ギャラリーは中継を設定しない。

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
const resetIn = (seconds) => String(Math.floor(Date.now() / 1000) + seconds);
const rateLimited = () => new Response('{}', {
  status: 403,
  headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetIn(120) },
});

test('without a proxy it fetches GitHub directly (gallery)', async () => {
  const calls = routeFetch({ [DIRECT]: ok('direct') });
  const gist = await fetchGist(ID);
  assert.equal(gist.files.get('index.html'), 'direct');
  assert.deepEqual(calls, [DIRECT]);
});

test('without a proxy a rate limit is reported as is (gallery)', async () => {
  const calls = routeFetch({ [DIRECT]: rateLimited });
  await assert.rejects(fetchGist(ID), GistRateLimitError);
  assert.deepEqual(calls, [DIRECT]);
});

/** @type {Array<[string, () => Response | Error, (err: unknown) => boolean]>} */
const galleryFailures = [
  ['404', () => new Response('{}', { status: 404 }), (err) => err instanceof GistNotFoundError],
  ['500', () => new Response('{"message":"boom"}', { status: 500 }), (err) => /GitHub API error \(500\): boom/.test(String(err))],
];
for (const [label, direct, check] of galleryFailures) {
  test(`without a proxy a direct ${label} is reported as is (gallery)`, async () => {
    const calls = routeFetch({ [DIRECT]: direct });
    await assert.rejects(fetchGist(ID), check);
    assert.deepEqual(calls, [DIRECT]);
  });
}

test('without a proxy a network failure propagates the original error (gallery)', async () => {
  const failure = new TypeError('Failed to fetch');
  routeFetch({ [DIRECT]: () => failure });
  await assert.rejects(fetchGist(ID), (err) => err === failure);
});

test('with a proxy configured it still fetches GitHub directly first and leaves the proxy alone', async () => {
  const calls = routeFetch({ [DIRECT]: ok('direct') });
  const gist = await fetchGist(ID, { proxyBaseUrl: '/gist-api' });
  assert.equal(gist.files.get('index.html'), 'direct');
  assert.deepEqual(calls, [DIRECT]);
});

test('a 404 from GitHub means the gist does not exist; the proxy is not asked', async () => {
  const calls = routeFetch({ [DIRECT]: () => new Response('{"message":"Not Found"}', { status: 404 }) });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), GistNotFoundError);
  assert.deepEqual(calls, [DIRECT]);
});

test('a gist without usable files is a format error; the proxy is not asked', async () => {
  const calls = routeFetch({ [DIRECT]: () => new Response('{"id":"x","files":{}}', { status: 200 }) });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), GistFormatError);
  assert.deepEqual(calls, [DIRECT]);
});

/** @type {Array<[string, () => Response | Error]>} */
const directFailures = [
  ['rate limited (403 + remaining 0)', rateLimited],
  ['secondary rate limited (429)', () => new Response('{}', { status: 429 })],
  ['server error (502)', () => new Response('', { status: 502 })],
  ['403 without an exhausted quota', () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '12' } })],
  ['401', () => new Response('{}', { status: 401 })],
  ['network failure', () => new TypeError('Failed to fetch')],
  ['non-JSON 200', () => new Response('<html>', { status: 200 })],
];
for (const [label, direct] of directFailures) {
  test(`falls back to the proxy when GitHub directly is ${label}`, async () => {
    const calls = routeFetch({ [DIRECT]: direct, [PROXY]: ok('proxied') });
    const gist = await fetchGist(ID, { proxyBaseUrl: '/gist-api' });
    assert.equal(gist.files.get('index.html'), 'proxied');
    assert.deepEqual(calls, [DIRECT, PROXY]);
  });
}

test('a trailing slash on the proxy base is tolerated', async () => {
  const calls = routeFetch({ [DIRECT]: rateLimited, [PROXY]: ok('proxied') });
  await fetchGist(ID, { proxyBaseUrl: '/gist-api/' });
  assert.deepEqual(calls, [DIRECT, PROXY]);
});

test('when GitHub directly is rate limited and the proxy is unavailable it reports the direct rate limit', async () => {
  routeFetch({ [DIRECT]: rateLimited, [PROXY]: () => new Response('', { status: 503 }) });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), (err) => {
    assert.ok(err instanceof GistRateLimitError);
    assert.ok(err.retryAfterMs > 60_000 && err.retryAfterMs <= 120_000);
    return true;
  });
});

test('when both fail with errors other than a rate limit it reports the direct error', async () => {
  routeFetch({ [DIRECT]: () => new Response('{"message":"boom"}', { status: 500 }), [PROXY]: () => new TypeError('Failed to fetch') });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), /GitHub API error \(500\): boom/);
});

test('a 404 from the proxy after a direct failure means the gist does not exist', async () => {
  routeFetch({
    [DIRECT]: rateLimited,
    [PROXY]: () => new Response('{}', { status: 404, headers: { 'x-dc-gist-proxy': 'error' } }),
  });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), GistNotFoundError);
});

test('a 404 that did not come from the proxy (no proxy deployed there) reports the direct error', async () => {
  // gistApiBaseUrl を設定したが、そのパスに中継が居ない静的ホスト。全 Gist が「見つからない」にならない。
  routeFetch({ [DIRECT]: rateLimited, [PROXY]: () => new Response('Not Found', { status: 404 }) });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), GistRateLimitError);
});

test('when both GitHub directly and the proxy fail to connect it throws the original direct error', async () => {
  const failure = new TypeError('Failed to fetch');
  routeFetch({ [DIRECT]: () => failure, [PROXY]: () => new TypeError('proxy down') });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), (err) => err === failure);
});

test('a proxied gist without usable files is a format error, not the direct error', async () => {
  routeFetch({ [DIRECT]: rateLimited, [PROXY]: () => new Response('{"id":"x","files":{}}', { status: 200 }) });
  await assert.rejects(fetchGist(ID, { proxyBaseUrl: '/gist-api' }), GistFormatError);
});
