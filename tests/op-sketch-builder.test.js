import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleOpSketchHtml,
  assembleHtmlModeOpSketchHtml,
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
