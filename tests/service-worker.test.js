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
    for (const name of ['SHELL_CACHE', 'LOCAL_CACHE', 'OP_META_CACHE', 'OP_CDN_CACHE', 'RUNTIME_CACHE']) {
      assert.match(sw, new RegExp(`const ${name}\\s*=`), `missing bucket: ${name}`);
    }
    // /op-cdn/ proxy 分岐とナビゲーション fallback は SW の挙動の要なので回帰させない
    assert.match(sw, /\/op-cdn\//);
    assert.match(sw, /OFFLINE_NAVIGATION_FALLBACK/);
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
