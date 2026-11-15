import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateServiceWorker } from '../src/cli/utils/service-worker.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dc-sw-'));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
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
