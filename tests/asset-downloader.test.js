import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPathForUrl } from '../src/core/modules/asset-downloader.js';

test('localPathForUrl maps a normal deckard URL to assets/...', () => {
  assert.equal(
    localPathForUrl('https://deckard.openprocessing.org/user110137/visual2862331/h123/foo.png'),
    'assets/user110137/visual2862331/h123/foo.png'
  );
});

test('localPathForUrl strips query strings', () => {
  assert.equal(
    localPathForUrl('https://deckard.openprocessing.org/user1/visual2/foo.png?v=3'),
    'assets/user1/visual2/foo.png'
  );
});

test('localPathForUrl rejects non-deckard URLs', () => {
  assert.equal(localPathForUrl('https://example.com/foo.png'), null);
});

test('localPathForUrl neutralizes path traversal attempts', () => {
  // 生の ../ — URL 正規化でホスト直下に丸められ、outDir 外には出られない
  const rel = localPathForUrl('https://deckard.openprocessing.org/../../../../tmp/evil.js');
  assert.equal(rel, 'assets/tmp/evil.js');

  // パーセントエンコードされた .. も URL 正規化でドットセグメント扱いになる
  const rel2 = localPathForUrl('https://deckard.openprocessing.org/a/%2e%2e/%2e%2e/%2e%2e/tmp/evil.js');
  assert.ok(rel2 === null || (!rel2.includes('..') && rel2.startsWith('assets/')));

  // どんな入力でも assets/ 配下の相対パスしか返さないこと
  for (const url of [
    'https://deckard.openprocessing.org/..',
    'https://deckard.openprocessing.org/',
    'https://deckard.openprocessing.org/a/../../b',
  ]) {
    const r = localPathForUrl(url);
    assert.ok(r === null || (r.startsWith('assets/') && !r.split('/').includes('..')), `unsafe: ${url} -> ${r}`);
  }
});
