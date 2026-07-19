import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig, DEFAULT_CONFIG } from '../src/cli/utils/config.js';

// loadConfig の結果は dev / build がそのまま vite define で
// import.meta.env.DROPCASTER_CONFIG に埋め、viewer の getConfig が読む。
// viewer 向けキー (assetProxyBaseUrl 等) が素通しされることを固定する回帰テスト。

test('loadConfig passes assetProxyBaseUrl through to the viewer-bound config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dropcaster-config-'));
  try {
    await writeFile(
      join(dir, 'dropcaster.config.js'),
      "export default { title: 'T', assetProxyBaseUrl: '/op-cdn' };",
      'utf-8',
    );
    const config = await loadConfig(dir);
    assert.equal(config.assetProxyBaseUrl, '/op-cdn');
    assert.equal(config.title, 'T');
    // ユーザーが書いていないキーはデフォルトで補完される
    assert.equal(config.display, DEFAULT_CONFIG.display);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadConfig without a config file returns plain defaults (no assetProxyBaseUrl)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dropcaster-config-'));
  try {
    const config = await loadConfig(dir);
    assert.equal(config.assetProxyBaseUrl, undefined);
    assert.deepEqual(config, DEFAULT_CONFIG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
