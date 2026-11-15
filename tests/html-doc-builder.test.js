import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleDocumentFromFiles } from '../src/core/modules/html-doc-builder.js';

// 組み立て後の <script> 開始タグを文書順に取り出す (fetch shim など src の無いものも含む)。
function scriptTags(html) {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
}

// 開始タグの属性 (名前は小文字) → 値。値なし属性は ''。
function attrsOf(tag) {
  const attrs = new Map();
  const body = tag.replace(/^<script\b/i, '').replace(/>$/, '');
  for (const m of body.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

// data: URL を元の文字列に戻す (base64 は UTF-8 のバイト列として読む)。
function decodeDataUrl(url) {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
  assert.ok(m, `not a data: URL: ${url.slice(0, 40)}`);
  return m[2] ? Buffer.from(m[3], 'base64').toString('utf8') : decodeURIComponent(m[3]);
}

// 仮想ファイル由来 (data-dc-file 付き) の script を { file, attrs, code } で返す。
function embeddedScripts(html) {
  return scriptTags(html)
    .map(attrsOf)
    .filter(attrs => attrs.has('data-dc-file'))
    .map(attrs => ({ file: attrs.get('data-dc-file'), attrs, code: decodeDataUrl(attrs.get('src')) }));
}

function assemble(index, files) {
  return assembleDocumentFromFiles({ files: new Map([['index.html', index], ...Object.entries(files)]) });
}

test('inline script: a module keeps type="module" and its code is embedded as a data: URL', () => {
  const html = assemble(
    '<head></head><body><script type="module" src="./sketch.js"></script></body>',
    { 'sketch.js': 'await Promise.resolve();\nexport const ran = true;' },
  );
  const [script] = embeddedScripts(html);
  assert.ok(script, 'sketch.js is embedded');
  assert.equal(script.file, 'sketch.js');
  assert.equal(script.attrs.get('type'), 'module');
  assert.match(script.attrs.get('src'), /^data:text\/javascript;charset=utf-8;base64,/);
  assert.ok(script.code.startsWith('await Promise.resolve();\nexport const ran = true;'), 'code survives verbatim');
  assert.match(script.code, /\n\/\/# sourceURL=sketch\.js$/, 'sourceURL names the original file');
});

test('inline script: execution attributes stay on each script in document order', () => {
  const html = assemble(
    [
      '<html><head>',
      '<script src="classic.js"></script>',
      '<script defer src="d1.js"></script>',
      '<script type="module" src="m.js"></script>',
      "<script src='d2.js' defer></script>",
      '<script async src="a.js"></script>',
      '<script nomodule src="legacy.js"></script>',
      '</head><body></body></html>',
    ].join('\n'),
    {
      'classic.js': '/* classic */',
      'd1.js': '/* d1 */',
      'm.js': '/* m */',
      'd2.js': '/* d2 */',
      'a.js': '/* a */',
      'legacy.js': '/* legacy */',
    },
  );
  const scripts = embeddedScripts(html);
  assert.deepEqual(scripts.map(s => s.file), ['classic.js', 'd1.js', 'm.js', 'd2.js', 'a.js', 'legacy.js']);
  const flags = scripts.map(s => ['type', 'defer', 'async', 'nomodule'].filter(a => s.attrs.has(a)).join(','));
  assert.deepEqual(flags, ['', 'defer', 'type', 'defer', 'async', 'nomodule']);
  for (const s of scripts) {
    assert.ok(s.code.startsWith(`/* ${s.file.replace(/\.js$/, '')} */\n`), `${s.file} carries its own code`);
  }
});

test('inline script: attributes other than the execution ones are kept as written', () => {
  const html = assemble(
    '<script id="main" data-role="sketch" crossorigin="anonymous" src="sketch.js" referrerpolicy="no-referrer"></script>',
    { 'sketch.js': 'window.ran = 1;' },
  );
  const [script] = embeddedScripts(html);
  assert.equal(script.attrs.get('id'), 'main');
  assert.equal(script.attrs.get('data-role'), 'sketch');
  assert.equal(script.attrs.get('crossorigin'), 'anonymous');
  assert.equal(script.attrs.get('referrerpolicy'), 'no-referrer');
});

test('inline script: external URLs and unknown files are left untouched', () => {
  const html = assemble(
    [
      '<script type="module" src="https://cdn.example.com/lib.js"></script>',
      '<script defer src="missing.js"></script>',
    ].join('\n'),
    { 'other.js': '1;' },
  );
  assert.ok(html.includes('<script type="module" src="https://cdn.example.com/lib.js"></script>'));
  assert.ok(html.includes('<script defer src="missing.js"></script>'));
  assert.equal(embeddedScripts(html).length, 0);
});

test('inline script: HTML-significant sequences and non-ASCII text survive without touching the parser', () => {
  const code = 'var a = "</script><p>x</p>"; var b = "<!--<script>"; // </SCRIPT>\nvar c = "日本語 ✓";';
  const html = assemble('<head></head><body><script src="sketch.js"></script><p id="after">after</p></body>', { 'sketch.js': code });
  const [script] = embeddedScripts(html);
  assert.ok(script.code.startsWith(code), 'decoded code is byte-identical');
  // 埋め込み本体は base64 なので、スクリプト以外の箇所に元の列は現れない (fetch shim の表は < でエスケープ済み)
  assert.ok(!html.includes('<!--<script>'), 'no raw <!--<script> in the document');
  assert.ok(!/<\/script><p>x<\/p>/i.test(html), 'no raw </script> from the file');
  assert.ok(html.includes('<p id="after">after</p>'), 'following DOM untouched');
});

test('inline script: an empty file still yields a loadable data: URL', () => {
  const html = assemble('<script src="empty.js"></script>', { 'empty.js': '' });
  const [script] = embeddedScripts(html);
  assert.equal(script.code, '\n//# sourceURL=empty.js');
});

test('inline script: file names are escaped in the attribute and sanitized in sourceURL', () => {
  const name = 'a&b sketch.js';
  const html = assemble(`<script src="${name}"></script>`, { [name]: '1;' });
  const [script] = embeddedScripts(html);
  assert.equal(script.file, 'a&amp;b sketch.js', 'data-dc-file carries the original name, attribute-escaped');
  assert.match(script.code, /\n\/\/# sourceURL=a&b_sketch\.js$/, 'whitespace cannot end the sourceURL early');
});

test('inline script: a file larger than one encoding chunk round-trips intact', () => {
  // base64 化は 32 KiB ごとに区切るので、区切りをまたぐ多バイト文字が壊れないことを見る
  const code = `/*${'あ'.repeat(30000)}*/\nwindow.done = true;`;
  const html = assemble('<script src="big.js"></script>', { 'big.js': code });
  const [script] = embeddedScripts(html);
  assert.ok(new TextEncoder().encode(code).length > 0x8000 * 2, 'fixture spans several chunks');
  assert.ok(script.code.startsWith(code));
});

test('inline script: integrity is dropped because the embedded body never matches the original hash', () => {
  // 本体には sourceURL を足し、OP では proxy 書き換え後の内容になるので、ハッシュは必ず一致しない。
  // 残すとブラウザは error イベントも出さずに実行を止める (埋め込み前の inline script では無視されていた)
  const html = assemble(
    [
      '<script integrity="sha384-abc" type="module" src="m.js"></script>',
      "<script src='c.js' INTEGRITY='sha256-xyz' defer></script>",
      '<script data-note="integrity=keep" src="n.js" integrity></script>',
    ].join('\n'),
    { 'm.js': '1;', 'c.js': '2;', 'n.js': '3;' },
  );
  const scripts = embeddedScripts(html);
  assert.deepEqual(scripts.map(s => s.file), ['m.js', 'c.js', 'n.js']);
  assert.ok(scripts.every(s => !s.attrs.has('integrity')), 'no integrity attribute survives');
  assert.equal(scripts[0].attrs.get('type'), 'module', 'other attributes before it are kept');
  assert.ok(scripts[1].attrs.has('defer'), 'other attributes after it are kept');
  assert.equal(scripts[2].attrs.get('data-note'), 'integrity=keep', 'attribute values that mention integrity are untouched');
});

test('inline script: integrity on external scripts is left alone', () => {
  const tag = '<script src="https://cdn.example.com/p5.js" integrity="sha384-abc" crossorigin="anonymous"></script>';
  assert.ok(assemble(tag, {}).includes(tag));
});
