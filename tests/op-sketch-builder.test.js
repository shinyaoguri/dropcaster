import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleOpSketchHtml,
  assembleHtmlModeOpSketchHtml,
  planHtmlModeLocalFiles,
} from '../src/core/modules/op-sketch-builder.js';

const PROXY = '/op-cdn';
const FILE_BASE = 'https://deckard.openprocessing.org/user1/visual2/habc/';

// OP の html モード作品 (例: visual 2960706) と同じ形のタブ構成
function htmlModeFixture() {
  return {
    meta: { visualID: 2960706, mode: 'html', engineURL: '', fileBase: FILE_BASE },
    codeTabs: [
      { title: 'mySketch.js', orderID: 0, code: "let s; function preload(){ s = loadShader('vert.glsl','frag.glsl') }" },
      { title: 'vert.glsl', orderID: 1, code: '#version 300 es\nin vec3 aPosition;' },
      { title: 'frag.glsl', orderID: 2, code: 'precision highp float;' },
      { title: 'style.css', orderID: 3, code: 'body { margin: 0; }' },
      {
        title: 'index.html', orderID: 4, code: [
          '<!DOCTYPE html>',
          '<html><head>',
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.8.0/p5.js"></script>',
          '<script src="mySketch.js"></script>',
          '<link rel="stylesheet" type="text/css" href="style.css">',
          '</head><body></body></html>',
        ].join('\n'),
      },
    ],
  };
}

test('html mode: index.html tab becomes the document, tab refs are inlined', () => {
  const html = assembleHtmlModeOpSketchHtml({ ...htmlModeFixture(), options: { assetProxyBaseUrl: PROXY } });

  // タブ参照の <script src> はインライン化され、src 参照は消える
  assert.ok(html.includes("loadShader('vert.glsl','frag.glsl')"), 'JS tab inlined');
  assert.ok(!/src\s*=\s*"mySketch\.js"/.test(html), 'tab script src removed');
  // 外部 CDN の <script src> はそのまま
  assert.ok(html.includes('cdnjs.cloudflare.com/ajax/libs/p5.js/1.8.0/p5.js'), 'external script kept');
  // stylesheet タブは <style> に
  assert.ok(html.includes('<style>') && html.includes('body { margin: 0; }'), 'css tab inlined');
  assert.ok(!/href\s*=\s*"style\.css"/.test(html), 'tab link href removed');
  // GLSL タブは shim の仮想ファイル表に入る
  assert.ok(html.includes('vert.glsl') && html.includes('in vec3 aPosition;'), 'glsl tabs embedded in shim');
  // base href は proxy 書き換え済みの fileBase
  assert.ok(html.includes(`<base href="${PROXY}/user1/visual2/habc/">`), 'base href rewritten to proxy');
});

test('html mode: without a proxy, base href keeps the deckard URL', () => {
  const html = assembleHtmlModeOpSketchHtml({ ...htmlModeFixture(), options: {} });
  assert.ok(html.includes(`<base href="${FILE_BASE}">`));
});

test('html mode: </script> inside an inlined tab cannot break the document', () => {
  const fx = htmlModeFixture();
  fx.codeTabs[0].code = 'const s = "</script><img src=x>";';
  const html = assembleHtmlModeOpSketchHtml({ ...fx, options: {} });
  assert.ok(!html.includes('const s = "</script>'), 'script close tag escaped');
  // shim の JSON 埋め込みも < をエスケープしている
  assert.ok(!/<\/script><img src=x>/.test(html), 'no raw close-tag sequence anywhere');
});

test('html mode: throws when there is no index.html tab', () => {
  const fx = htmlModeFixture();
  fx.codeTabs = fx.codeTabs.filter(t => t.title !== 'index.html');
  assert.throws(() => assembleHtmlModeOpSketchHtml({ ...fx, options: {} }), /index\.html/);
});

// --- planHtmlModeLocalFiles (`dropcaster fetch` の html モード用ローカル書き出し計画) ---

test('html-mode local plan: tabs become files verbatim, index tab becomes index.html', () => {
  const { codeTabs } = htmlModeFixture();
  const plan = planHtmlModeLocalFiles({ codeTabs });

  const names = plan.files.map(f => f.name).sort();
  assert.deepEqual(names, ['frag.glsl', 'index.html', 'mySketch.js', 'style.css', 'vert.glsl']);
  assert.equal(plan.indexName, 'index.html');
  assert.equal(plan.renames.length, 0);
  // 作者のドキュメントはそのまま (viewer 版と違いインライン化しない)
  const index = plan.files.find(f => f.name === 'index.html');
  assert.ok(index.content.includes('<script src="mySketch.js"></script>'), 'tab script src kept as-is');
  assert.ok(index.content.includes('href="style.css"'), 'stylesheet link kept as-is');
});

test('html-mode local plan: first .html tab is renamed to index.html and references follow', () => {
  const codeTabs = [
    { title: 'main.html', orderID: 0, code: '<html><head><script src="app.js"></script></head></html>' },
    { title: 'app.js', orderID: 1, code: "fetch('main.html')" },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  assert.equal(plan.indexName, 'main.html');
  assert.deepEqual(plan.renames, [{ from: 'main.html', to: 'index.html' }]);
  const app = plan.files.find(f => f.name === 'app.js');
  assert.ok(app.content.includes("fetch('index.html')"), 'reference to renamed document rewritten');
});

test('html-mode local plan: throws when there is no html tab', () => {
  assert.throws(
    () => planHtmlModeLocalFiles({ codeTabs: [{ title: 'a.js', orderID: 0, code: '' }] }),
    /index\.html/,
  );
});

test('html-mode local plan: unsafe and reserved tab names are made safe, references rewritten', () => {
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: '<script src="../evil.js"></script><a href="_op-meta.json">m</a>' },
    { title: '../evil.js', orderID: 1, code: 'x' },
    { title: '_op-meta.json', orderID: 2, code: '{}' },
    { title: '..', orderID: 3, code: 'y' },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  const names = plan.files.map(f => f.name);
  assert.ok(names.includes('.._evil.js'), 'path separator flattened');
  assert.ok(names.includes('_op-meta_2.json'), 'reserved name suffixed');
  assert.ok(names.includes('_tab'), 'dot-only name replaced');
  // どの名前もディレクトリ参照にならない
  for (const n of names) {
    assert.ok(!n.includes('/') && !n.includes('\\') && n !== '..' && n !== '.', `safe name: ${n}`);
  }
  // 参照書き換えが index.html にも効いている
  const index = plan.files.find(f => f.name === 'index.html');
  assert.ok(index.content.includes('src=".._evil.js"'), 'unsafe script ref rewritten');
  assert.ok(index.content.includes('href="_op-meta_2.json"'), 'reserved-name ref rewritten');
});

test('html-mode local plan: duplicate tab names are deduped case-insensitively, ambiguous refs untouched', () => {
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: '<script src="sketch.js"></script>' },
    { title: 'Sketch.js', orderID: 1, code: 'a' },
    { title: 'sketch.js', orderID: 2, code: 'b' },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  const names = plan.files.map(f => f.name);
  assert.ok(names.includes('Sketch.js'), 'first occurrence keeps its name');
  assert.ok(names.includes('sketch_2.js'), 'case-insensitive duplicate suffixed');
  // 'sketch.js' は Sketch.js として存在し続ける (case-insensitive FS) ため、参照は書き換えない
  const index = plan.files.find(f => f.name === 'index.html');
  assert.ok(index.content.includes('src="sketch.js"'), 'ambiguous reference left untouched');
});

test('p5js mode: assembleOpSketchHtml is unchanged by the html-mode addition', () => {
  const html = assembleOpSketchHtml({
    meta: { mode: 'p5js', engineURL: 'https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.js', fileBase: FILE_BASE, libraries: [] },
    codeTabs: [{ title: 'mySketch.js', orderID: 0, code: 'function setup(){ createCanvas(100,100) }' }],
    options: { assetProxyBaseUrl: PROXY, injectCorsShim: false, injectErrorShim: false },
  });
  // 従来どおり: エンジン script + コードを 1 本の <script> に連結 + viewer 側 <style>
  assert.ok(html.includes('p5@1.9.3/lib/p5.js'));
  assert.ok(html.includes('function setup(){ createCanvas(100,100) }'));
  assert.ok(html.includes(`<base href="${PROXY}/user1/visual2/habc/">`));
  assert.ok(html.includes('canvas { display: block;'), 'viewer style still injected in p5js mode');
});
