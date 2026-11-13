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
