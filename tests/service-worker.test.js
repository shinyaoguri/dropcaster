import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { generateServiceWorker } from '../src/cli/utils/service-worker.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dc-sw-'));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

/**
 * 生成した sw.js を、偽の self / caches / fetch の上で動かす。scope は登録先の URL。
 * navigate の振り分けは request.destination の実値に依るので、ここでは扱わない
 * (tests/browser/service-worker-offline.mjs が実ブラウザで見る)。
 * @param {string} scope
 */
async function loadWorker(scope) {
  const sw = await withTempDir(async (dir) => readFile(await generateServiceWorker(dir, { cacheVersion: 'test' }), 'utf-8'));
  /** @type {Map<string, Map<string, Response>>} */
  const stores = new Map();
  /** @type {Record<string, (event: any) => void>} */
  const listeners = {};
  const urlOf = (req) => (typeof req === 'string' ? req : req.url);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      match: async (req) => store.get(urlOf(req))?.clone(),
      put: async (req, res) => { store.set(urlOf(req), res); },
      keys: async () => [...store.keys()].map(url => ({ url })),
      delete: async (req) => store.delete(urlOf(req)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    has: async (name) => stores.has(name),
    delete: async (name) => stores.delete(name),
  };
  const self = {
    registration: { scope },
    location: new URL(scope),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(sw, { self, caches, fetch: async () => new Response('fetched'), URL, Request, Response, Headers });
  // バケット名はテンプレートの定数を正とする (テストに写さない)
  const bucket = (constant) => {
    const value = sw.match(new RegExp(`const ${constant}\\s*= '([^']+)';`))?.[1];
    assert.ok(value, `sw.js に ${constant} が無い`);
    return value;
  };
  const holding = (url) => [...stores].filter(([, store]) => store.has(url)).map(([name]) => name).sort();
  return {
    bucket,
    holding,
    seed: async (name, url, body) => (await open(name)).put(url, new Response(body)),
    text: async (name, url) => (await (await open(name)).match(url))?.text(),
    /** navigate でない GET を 1 件流し、入ったバケット名を返す */
    get: async (url) => {
      let responded;
      listeners.fetch({ request: { method: 'GET', url, mode: 'no-cors', destination: '' }, respondWith: (res) => { responded = res; } });
      assert.ok(responded, `${url} に SW が応答しない`);
      await responded;
      // cache.put は応答と非同期
      await new Promise(resolve => setImmediate(resolve));
      return holding(url);
    },
    activate: async () => {
      let done;
      listeners.activate({ waitUntil: (promise) => { done = promise; } });
      await done;
    },
  };
}

test('generateServiceWorker emits a multi-bucket SW with all expected cache buckets', async () => {
  await withTempDir(async (dir) => {
    await generateServiceWorker(dir);
    const sw = await readFile(join(dir, 'sw.js'), 'utf-8');
    for (const name of ['SHELL_CACHE', 'LOCAL_CACHE', 'OP_META_CACHE', 'GIST_CACHE', 'OP_CDN_CACHE', 'RUNTIME_CACHE']) {
      assert.match(sw, new RegExp(`const ${name}\\s*=`), `missing bucket: ${name}`);
    }
    // /op-cdn/ proxy 分岐とナビゲーション fallback は SW の挙動の要なので回帰させない
    assert.match(sw, /\/op-cdn\//);
    assert.match(sw, /OFFLINE_NAVIGATION_FALLBACK/);
    // Gist は同じ ID のまま更新されるので NetworkFirst で拾う (CacheFirst に倒すと
    // 作者が直しても古い srcdoc が出続ける)
    assert.match(sw, /api\.github\.com/);
    assert.match(sw, /networkFirst\(req, GIST_CACHE\)/);
  });
});

test('generateServiceWorker sends the same-origin Gist proxy through NetworkFirst, not the SWR runtime bucket', async () => {
  await withTempDir(async (dir) => {
    await generateServiceWorker(dir);
    const sw = await readFile(join(dir, 'sw.js'), 'utf-8');
    // ホスト版の /gist-api/* (Worker の中継, #142) が同一オリジン GET の SWR に落ちると、
    // 作者が直した後も古い Gist を返してしまう。api.github.com 直と同じ NetworkFirst に乗せる。
    const branch = sw.match(/if \(url\.pathname\.startsWith\('\/gist-api\/'\)\) \{\s*event\.respondWith\(([^;]+)\);/);
    assert.ok(branch, '/gist-api/ の分岐が無い');
    assert.equal(branch[1], 'networkFirst(req, GIST_CACHE)');
    assert.ok(sw.indexOf("startsWith('/gist-api/')") < sw.indexOf('staleWhileRevalidate(req, RUNTIME_CACHE)'),
      '/gist-api/ の分岐は同一オリジンの SWR より前に置く');
  });
});

test('generateServiceWorker respects an explicit cacheVersion option', async () => {
  await withTempDir(async (dir) => {
    await generateServiceWorker(dir, { cacheVersion: 'v42-test' });
    const sw = await readFile(join(dir, 'sw.js'), 'utf-8');
    assert.match(sw, /const CACHE_VERSION = "v42-test";/);
  });
});

test('generateServiceWorker falls back to package.json version when no option given', async () => {
  await withTempDir(async (dir) => {
    await generateServiceWorker(dir);
    const sw = await readFile(join(dir, 'sw.js'), 'utf-8');
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'));
    assert.match(sw, new RegExp(`const CACHE_VERSION = "${pkg.version}";`));
  });
});

test('generateServiceWorker waits for all windows to close before activating a new version (#164)', async () => {
  await withTempDir(async (dir) => {
    await generateServiceWorker(dir);
    const sw = await readFile(join(dir, 'sw.js'), 'utf-8');
    // install で skipWaiting すると、上演中の操作画面が新しい版に切り替わり出力ウィンドウが閉じる
    const install = sw.match(/self\.addEventListener\('install', \(event\) => \{([\s\S]*?)\n\}\);/);
    assert.ok(install, 'install ハンドラが無い');
    assert.doesNotMatch(install[1], /skipWaiting/);
    // 利用者が通知で適用を選んだときだけ、ページからの適用メッセージで切り替える。
    // SKIP_WAITING は、この変更より前の版のページが自動で送るので受けない (移行時に上演が止まる)
    assert.match(sw, /event\.data\.type === APPLY_UPDATE_MESSAGE\) \{\s*self\.skipWaiting\(\);/);
    assert.doesNotMatch(sw, /['"]SKIP_WAITING['"]/);
    const swMessage = sw.match(/const APPLY_UPDATE_MESSAGE = '([^']+)';/)?.[1];
    const register = await readFile(new URL('../src/viewer/pwa/register.ts', import.meta.url), 'utf-8');
    const pageMessage = register.match(/const APPLY_UPDATE_MESSAGE = '([^']+)';/)?.[1];
    assert.ok(swMessage, 'SW に APPLY_UPDATE_MESSAGE が無い');
    assert.notEqual(swMessage, 'SKIP_WAITING');
    assert.equal(pageMessage, swMessage, 'ページが送る適用メッセージと SW が受けるものが違う');
  });
});

test('generateServiceWorker precaches the shell strictly and keeps content caches across versions (#164)', async () => {
  await withTempDir(async (dir) => {
    await generateServiceWorker(dir, { cacheVersion: 'v9' });
    const sw = await readFile(join(dir, 'sw.js'), 'utf-8');
    // 新しい版の資産は旧版のページが開いている間は取られない。install で揃えないと、
    // 閉じた後にオフラインで開いたとき JS / CSS が無く何も出ない。取れなければ install ごと失敗させる
    assert.match(sw, /event\.waitUntil\(precacheShell\(\)\);/);
    assert.doesNotMatch(sw.slice(sw.indexOf('async function precacheShell'), sw.indexOf('async function fetchRequired')),
      /cache\.put\([^)]*\)\.catch/, '必須の資産の保存の失敗を握りつぶしている');
    // サブパス配信の assets/ も shell (CacheFirst) から引く。runtime に落ちると事前キャッシュが使われない
    assert.match(sw, /isScopeAsset\(url\) \|\|/);
    // 版を持つのは shell だけ。中身のバケットは版をまたいで同じ名前を使う (溜め込まず、写しもしない)
    assert.match(sw, /const SHELL_CACHE\s*= `\$\{SHELL_PREFIX\}\$\{CACHE_VERSION\}`;/);
    for (const name of ['LOCAL_CACHE', 'OP_META_CACHE', 'GIST_CACHE', 'OP_CDN_CACHE', 'RUNTIME_CACHE']) {
      assert.match(sw, new RegExp(`const ${name}\\s*= 'dropcaster-[a-z-]+';`), `${name} が版を持っている`);
    }
  });
});

// ルート配信とサブパス配信で、同じ相対パスは同じバケットに入る (#179)。
// サブパス配信で作品のサブリソースが runtime に落ちると、作品の HTML (LOCAL) と置き場が分かれる。
for (const scope of ['https://gallery.example/', 'https://gallery.example/sub/']) {
  test(`the service worker routes same-origin GETs by scope-relative path (scope ${new URL(scope).pathname})`, async () => {
    const worker = await loadWorker(scope);
    const local = worker.bucket('LOCAL_CACHE');
    const runtime = worker.bucket('RUNTIME_CACHE');
    const shell = `${worker.bucket('SHELL_PREFIX')}test`;
    const expected = {
      'sketches/a/sketch.js': local,
      'sketches/a/data/points.json': local,
      'sketches.json': local,
      'assets/index-abc123.js': shell,
      'manifest.json': shell,
      'previews/a.gif': runtime,
      // 名前が似ているだけのものは作品ではない
      'sketches-old/a/sketch.js': runtime,
      'docs/sketches/a/sketch.js': runtime,
    };
    for (const [path, bucket] of Object.entries(expected)) {
      assert.deepEqual(await worker.get(scope + path), [bucket], `${path} の入ったバケット`);
    }
  });
}

test('the service worker keeps other origins and out-of-scope paths out of the local bucket (#179)', async () => {
  const worker = await loadWorker('https://gallery.example/sub/');
  const runtime = worker.bucket('RUNTIME_CACHE');
  for (const url of [
    // 別オリジンの同じパス
    'https://other.example/sub/sketches/a/sketch.js',
    'https://other.example/sub/sketches.json',
    // 同じオリジンでも scope の外 (同じオリジンに同居する別のサイト)
    'https://gallery.example/sketches/a/sketch.js',
    'https://gallery.example/sketches.json',
    'https://gallery.example/other/sketches/a/sketch.js',
  ]) {
    assert.deepEqual(await worker.get(url), [runtime], `${url} の入ったバケット`);
  }
});

test('activating moves local sketch files that an older version left in the runtime bucket (#179)', async () => {
  // 中身のバケットは版をまたいで残る。振り分けを直しただけでは、直す前に runtime に入った作品の JS を
  // LOCAL から引けず、更新後にオフラインで開いた作品が動かない
  const scope = 'https://gallery.example/sub/';
  const worker = await loadWorker(scope);
  const local = worker.bucket('LOCAL_CACHE');
  const runtime = worker.bucket('RUNTIME_CACHE');
  const stray = `${scope}sketches/a/sketch.js`;
  const versioned = `${scope}sketches/b/sketch.js`;
  const both = `${scope}sketches/c/sketch.js`;
  const kept = [`${scope}previews/a.gif`, 'https://gallery.example/sketches/a/sketch.js', 'https://other.example/sub/sketches/a/sketch.js'];
  await worker.seed(runtime, stray, 'stray');
  // 版を持っていたころの runtime にあったものも、版の無い runtime を経て LOCAL へ移る
  await worker.seed(`${runtime}-old`, versioned, 'versioned');
  await worker.seed(runtime, both, 'from runtime');
  await worker.seed(local, both, 'from local');
  for (const url of kept) await worker.seed(runtime, url, 'kept');

  await worker.activate();

  assert.deepEqual(worker.holding(stray), [local]);
  assert.equal(await worker.text(local, stray), 'stray');
  assert.deepEqual(worker.holding(versioned), [local]);
  assert.deepEqual(worker.holding(both), [local]);
  assert.equal(await worker.text(local, both), 'from local', 'LOCAL に既にあるものを上書きした');
  for (const url of kept) assert.deepEqual(worker.holding(url), [runtime], `${url} は runtime に残す`);
});

test('the service worker leaves the hosted proxies on their own buckets (#179)', async () => {
  // ホスト版 (apps/web) はルート配信で、ローカル作品を持たない。Worker の中継の振り分けは変えない
  const worker = await loadWorker('https://dropcaster.example/');
  assert.deepEqual(await worker.get('https://dropcaster.example/op-cdn/h0123456789abcdef0123456789abcdef/a.png'), [worker.bucket('OP_CDN_CACHE')]);
  assert.deepEqual(await worker.get('https://dropcaster.example/gist-api/gists/abc'), [worker.bucket('GIST_CACHE')]);
});
