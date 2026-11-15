import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import {
  localPathForUrl,
  downloadAssets,
  rewriteCodeWithAssetMap,
} from '../src/core/modules/asset-downloader.js';

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

// --- #114: 保存名と参照 URL が同じファイルを指す ---------------------------------
//
// 配信サーバは参照 URL をデコードしてファイルを探す。Vite (sirv) は decodeURI、
// nginx・Python の http.server などは decodeURIComponent 相当でデコードするので、
// 書き換えた参照をどちらでデコードしても保存したファイル名に戻ることを確かめる。

const DIR = 'https://deckard.openprocessing.org/user1/visual2/h3/';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** URL を本文に入れて返す fetch に差し替えて downloadAssets を走らせる */
async function download(urls) {
  const outDir = mkdtempSync(join(tmpdir(), 'dropcaster-assets-'));
  globalThis.fetch = async (url) => new Response(`body:${url}`);
  const map = await downloadAssets(urls, outDir);
  return { outDir, map };
}

/** dir 配下のファイルを '/' 区切りの相対パスで列挙する */
function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

for (const [label, name, fileName] of [
  ['an encoded space (%20)', 'a%20b.png', 'a b.png'],
  ['a raw space', 'a b.png', 'a b.png'],
  ['encoded Japanese', '%E6%97%A5%E6%9C%AC.png', '日本.png'],
  ['raw Japanese', '日本.png', '日本.png'],
  // NFD (か + 濁点) は NFC (が) に揃えて保存・参照する。macOS は両者を同じファイルとして扱い、
  // Vite は実在する名前と文字列で照合するので、両方の形で参照されると片方が 404 になる
  ['encoded decomposed (NFD) Japanese', '%E3%81%8B%E3%82%99.png', 'が.png'],
  ['an encoded percent sign (%25)', '100%25.png', '100%.png'],
  ['an encoded reserved char allowed in paths (%40)', 'foo%402x.png', 'foo@2x.png'],
]) {
  test(`downloadAssets saves ${label} under the decoded name and rewrites to a URL that resolves to it`, async () => {
    const url = DIR + name;
    const { outDir, map } = await download([url]);
    const expectedFile = `assets/user1/visual2/h3/${fileName}`;
    assert.deepEqual(listFiles(outDir), [expectedFile]);
    assert.equal(readFileSync(join(outDir, expectedFile), 'utf-8'), `body:${url}`);
    const ref = map.get(url);
    assert.equal(typeof ref, 'string', `no reference for ${url}`);
    assert.equal(decodeURI(ref), expectedFile, `Vite (decodeURI) would look for another file: ${ref}`);
    assert.equal(decodeURIComponent(ref), expectedFile, `decodeURIComponent servers would look for another file: ${ref}`);
  });
}

// 1 文字ずつ差し込んだ名前で不変条件を総当たりする。保存したなら、参照をどちらの方式で
// デコードしても保存したただ 1 つのファイルに戻る。拒否したなら何も書かない。
// URL パーサはタブ・改行を削り、末尾の空白・制御文字を削るので、制御文字と境界 (先頭・末尾) を含める。
test('downloadAssets either rejects a name or rewrites to a URL that resolves to the saved file, for every ASCII char and position', async () => {
  const chars = [];
  for (let c = 0; c < 0x80; c++) chars.push(c);
  const escapes = chars.map((c) => `%${c.toString(16).toUpperCase().padStart(2, '0')}`);
  // 非 ASCII の空白・制御文字 (C1 制御文字 U+0085・NBSP・全角空白)
  escapes.push('%C2%85', '%C2%A0', '%E3%80%80');
  const failures = [];
  for (const esc of escapes) {
    for (const name of [`a${esc}b.png`, `${esc}b.png`, `a.png${esc}`]) {
      const url = DIR + name;
      const { outDir, map } = await download([url]);
      const files = listFiles(outDir);
      const ref = map.get(url);
      if (ref === undefined) {
        if (readdirSync(outDir).length !== 0) failures.push(`${name}: rejected but wrote ${JSON.stringify(files)}`);
        continue;
      }
      if (files.length !== 1) { failures.push(`${name}: wrote ${JSON.stringify(files)}`); continue; }
      for (const [how, decode] of Object.entries({ decodeURI, decodeURIComponent })) {
        let decoded;
        try { decoded = decode(ref); } catch { decoded = '(decode error)'; }
        if (decoded !== files[0]) failures.push(`${name}: saved ${JSON.stringify(files[0])} but ${how}(${JSON.stringify(ref)}) is ${JSON.stringify(decoded)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('downloadAssets keeps plain ASCII names (no %XX, nothing the URL parser escapes) and references as before', async () => {
  const urls = [
    DIR + 'foo.png',
    DIR + 'bar.png?v=3',
    DIR + 'a(1)_x-y.png',
    DIR + 'foo@2x.png',
    DIR + 'a+b,c;d=e.png',
  ];
  const { outDir, map } = await download(urls);
  const expected = [
    'assets/user1/visual2/h3/foo.png',
    'assets/user1/visual2/h3/bar.png',
    'assets/user1/visual2/h3/a(1)_x-y.png',
    'assets/user1/visual2/h3/foo@2x.png',
    'assets/user1/visual2/h3/a+b,c;d=e.png',
  ];
  assert.deepEqual(urls.map((u) => map.get(u)), expected);
  assert.deepEqual(listFiles(outDir), [...expected].sort());
});

test('downloadAssets writes nothing for names that cannot be saved and served as the same file', async () => {
  const urls = [
    DIR + 'a%2Fb.png', // デコードするとパス区切り
    DIR + 'a%5Cb.png', // Windows のパス区切り
    DIR + '..%2F..%2F..%2Fevil.js',
    DIR + 'a%00b.png', // NUL
    DIR + '100%.png', // 不正なエンコード (% 単独)
    DIR + '%zz.png', // 不正なエンコード
    DIR + 'a%23b.png', // # は decodeURI がデコードせず、サーバ間で参照先が割れる
    DIR + 'a%3Fb.png', // ? も同じ
    // URL パーサが削る文字: 参照にすると消えて保存名とずれる
    DIR + 'x.png%20', // 末尾の空白
    DIR + '%20x.png', // 先頭の空白
    DIR + 'a%0Ab.png', // LF
    DIR + 'a%0Db.png', // CR
    DIR + 't%09.png', // タブ
    DIR + 'a%01b.png', // その他の C0 制御文字
    DIR + 'a%7Fb.png', // DEL
  ];
  const { outDir, map } = await download(urls);
  assert.deepEqual([...map.entries()], []);
  assert.deepEqual(readdirSync(outDir), [], 'nothing should be written for rejected URLs');
});

test('rewriteCodeWithAssetMap points code at the saved file for an encoded name', async () => {
  const url = DIR + 'my%20image.png';
  const { outDir, map } = await download([url]);
  const rewritten = rewriteCodeWithAssetMap(`img = loadImage('${url}');`, map);
  const ref = /loadImage\('([^']+)'\)/.exec(rewritten)?.[1];
  assert.ok(ref && !ref.startsWith('https:'), rewritten);
  assert.ok(existsSync(join(outDir, decodeURI(ref))), `${ref} does not resolve to a saved file`);
});

test('rewriteCodeWithAssetMap rewrites a URL that another rewritten URL is a prefix of', async () => {
  // 短い方を先に取得したので、Map も短い方から並ぶ。短い方で先に置換すると、長い方の残り
  // `%402x.png` がエンコードのまま残り、decodeURI では `@` に戻らないので別のファイルを指す
  const short = DIR + 'a';
  const long = DIR + 'a%402x.png';
  const { outDir, map } = await download([short, long]);
  const rewritten = rewriteCodeWithAssetMap(`load('${short}'); load('${long}');`, map);
  const refs = [...rewritten.matchAll(/load\('([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(refs.length, 2, rewritten);
  assert.deepEqual(
    refs.map((ref) => (existsSync(join(outDir, decodeURI(ref))) ? readFileSync(join(outDir, decodeURI(ref)), 'utf-8') : `(missing: ${ref})`)),
    [`body:${short}`, `body:${long}`],
  );
});
