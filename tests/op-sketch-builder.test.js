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

  // タブ参照の <script src> は内容の data: URL に差し替わり、src 参照は消える
  const tab = /<script src="data:text\/javascript;charset=utf-8;base64,([^"]*)" data-dc-file="mySketch\.js"><\/script>/.exec(html);
  assert.ok(tab, 'JS tab embedded');
  assert.ok(Buffer.from(tab[1], 'base64').toString('utf8').includes("loadShader('vert.glsl','frag.glsl')"), 'JS tab content');
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

// #211: 参照を URL として読む。[タブ名, index.html に書く参照] は Issue の表の 6 行
const TAB_REFERENCES = [
  ['lib.js', 'lib.js'],
  ['my lib.js', 'my%20lib.js'],
  ['lib.js', 'lib.js?v=2'],
  ['a#b.js', 'a%23b.js'],
  ['my%20lib.js', 'my%20lib.js'],
  ['a#b.js', 'a#b.js'],
];

test('html mode: a reference written as a URL embeds the tab it points to', () => {
  for (const [tabName, ref] of TAB_REFERENCES) {
    const code = `window.loaded = ${JSON.stringify(tabName)};`;
    const html = assembleHtmlModeOpSketchHtml({
      meta: { mode: 'html', fileBase: FILE_BASE },
      codeTabs: [
        { title: 'index.html', orderID: 0, code: `<html><head><script src="${ref}"></script></head><body></body></html>` },
        { title: tabName, orderID: 1, code },
      ],
      options: { assetProxyBaseUrl: PROXY },
    });
    const tags = [...html.matchAll(/<script src="data:text\/javascript;charset=utf-8;base64,([^"]*)" data-dc-file="([^"]*)"><\/script>/g)];
    assert.equal(tags.length, 1, `tab "${tabName}" referenced as "${ref}" is embedded`);
    assert.equal(tags[0][2], tabName);
    assert.ok(Buffer.from(tags[0][1], 'base64').toString('utf8').startsWith(`${code}\n`), `content of "${tabName}"`);
    assert.ok(!html.includes(`src="${ref}"`), `the reference "${ref}" is replaced`);
  }
});

test('html mode: a stylesheet reference with a query embeds the tab', () => {
  const html = assembleHtmlModeOpSketchHtml({
    meta: { mode: 'html', fileBase: FILE_BASE },
    codeTabs: [
      { title: 'index.html', orderID: 0, code: '<html><head><link rel="stylesheet" href="style.css?v=2"></head></html>' },
      { title: 'style.css', orderID: 1, code: 'body { margin: 0; }' },
    ],
    options: {},
  });
  assert.match(html, /<style>\nbody \{ margin: 0; \}\n<\/style>/);
  assert.ok(!/<link\b/i.test(html), 'the link is gone');
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

// --- #220: アセット用ディレクトリ (assets/) と同じ名前のタブ ---
// fetch はアセットを同梱するとき、その保存先の名前を assetDirName で渡す。

test('html-mode local plan: a tab named like the asset directory is renamed, references to it follow', () => {
  const codeTabs = [
    {
      title: 'index.html', orderID: 0, code: [
        '<script src="assets"></script>',
        "<link rel=\"stylesheet\" href='./assets'>",
        '<script src="main.js"></script>',
      ].join('\n'),
    },
    { title: 'assets', orderID: 1, code: 'window.palette = ["#000"];' },
    {
      title: 'main.js', orderID: 2, code: [
        "loadStrings('assets', done);",
        'fetch("./assets").then(done);',
        "loadShader('vert.glsl', `assets`);",
        "xhr.open('GET', 'assets');",
        "img.src = 'assets';",
      ].join('\n'),
    },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });

  assert.deepEqual(plan.files.map(f => f.name), ['index.html', 'assets_2', 'main.js']);
  assert.deepEqual(plan.renames, [{ from: 'assets', to: 'assets_2' }]);
  assert.equal(plan.files[0].content, [
    '<script src="assets_2"></script>',
    "<link rel=\"stylesheet\" href='./assets_2'>",
    '<script src="main.js"></script>',
  ].join('\n'));
  assert.equal(plan.files[1].content, 'window.palette = ["#000"];');
  assert.equal(plan.files[2].content, [
    "loadStrings('assets_2', done);",
    'fetch("./assets_2").then(done);',
    "loadShader('vert.glsl', `assets_2`);",
    "xhr.open('GET', 'assets_2');",
    "img.src = 'assets_2';",
  ].join('\n'));
});

test('html-mode local plan: renaming the "assets" tab leaves every other "assets" in the code as written', () => {
  // どれもタブへの参照ではない: アセットのパス・deckard の URL・識別子・コメント・id / class・データのキー
  const index = [
    '<script src="main.js"></script>',
    '<div id="assets" class="assets" data-kind=\'assets\'>assets</div>',
    '<a href="assets/readme.txt">assets</a>',
  ].join('\n');
  const main = [
    '// assets: textures are loaded below',
    'const assets = { list: [] };',
    "assets.list.push(loadImage('https://deckard.openprocessing.org/user1/visual2/habc/assets/tex.png'));",
    "loadImage('https://deckard.openprocessing.org/user1/visual2/habc/assets');",
    "loadImage('assets/local.png');",
    "fetch('assets' + '/data.json');",
    "fetch('my-assets');",
    "fetch(base + 'assets');",
    "if (img.src === 'assets') skip();",
    "const kind = config['assets'] === 'assets' ? \"assets\" : `assets`;",
    'function loadAssets() { return window.assets; }',
    "console.log('assets', myassets, assets_count);",
    // open( の最初の引数は URL ではない (キャッシュ・データベース・ダイアログの名前)
    "caches.open('assets'); indexedDB.open(\"assets\", 1); dialog.open('assets');",
  ].join('\n');
  const data = '{ "assets": ["a.png"], "kind": "assets" }';
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: index },
    { title: 'assets', orderID: 1, code: 'x' },
    { title: 'main.js', orderID: 2, code: main },
    { title: 'data.json', orderID: 3, code: data },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });

  assert.deepEqual(plan.files.map(f => f.name), ['index.html', 'assets_2', 'main.js', 'data.json']);
  assert.equal(plan.files[0].content, index);
  assert.equal(plan.files[2].content, main);
  assert.equal(plan.files[3].content, data);
});

test('html-mode local plan: the renamed "assets" tab does not take the name of another tab', () => {
  // 連番が後ろのタブの名前 (assets_2) を先に取ると、<script src="assets_2"> まで付け替えたタブを指す
  const index = '<script src="assets"></script><script src="assets_2"></script>';
  for (const order of [['assets', 'assets_2'], ['assets_2', 'assets']]) {
    const codeTabs = [
      { title: 'index.html', orderID: 0, code: index },
      ...order.map((title, i) => ({ title, orderID: i + 1, code: `// ${title}` })),
    ];
    const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });
    const saved = Object.fromEntries(plan.files.map(f => [f.name, f.content]));

    assert.deepEqual(plan.renames, [{ from: 'assets', to: 'assets_3' }], order.join(' → '));
    assert.equal(saved['index.html'], '<script src="assets_3"></script><script src="assets_2"></script>');
    assert.equal(saved.assets_3, '// assets');
    assert.equal(saved.assets_2, '// assets_2');
  }
});

test('html-mode local plan: attribute names in upper case are followed too', () => {
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: '<SCRIPT SRC="assets"></SCRIPT><LINK REL="stylesheet" HREF=\'./assets\'>' },
    { title: 'assets', orderID: 1, code: 'x' },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });

  assert.equal(plan.files[0].content, '<SCRIPT SRC="assets_2"></SCRIPT><LINK REL="stylesheet" HREF=\'./assets_2\'>');
});

test('html-mode local plan: the asset directory name is matched case-insensitively', () => {
  for (const [tabName, savedName] of [['Assets', 'Assets_2'], ['ASSETS', 'ASSETS_2']]) {
    const codeTabs = [
      { title: 'index.html', orderID: 0, code: `<script src="${tabName}"></script>` },
      { title: tabName, orderID: 1, code: 'x' },
    ];
    const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });

    assert.deepEqual(plan.files.map(f => f.name), ['index.html', savedName]);
    assert.deepEqual(plan.renames, [{ from: tabName, to: savedName }]);
    assert.equal(plan.files[0].content, `<script src="${savedName}"></script>`);
  }
});

test('html-mode local plan: "Assets" and "assets" tabs both move away from the asset directory', () => {
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: '<script src="Assets"></script><script src="assets"></script>' },
    { title: 'Assets', orderID: 1, code: 'a' },
    { title: 'assets', orderID: 2, code: 'b' },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });

  // 2 つ目は assets_2 だと 1 つ目の Assets_2 と大文字小文字違いで重なるので、次の番号になる
  assert.deepEqual(plan.files.map(f => f.name), ['index.html', 'Assets_2', 'assets_3']);
  assert.equal(plan.files[0].content, '<script src="Assets_2"></script><script src="assets_3"></script>');
});

test('html-mode local plan: without an asset directory, a tab named "assets" is kept as it is', () => {
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: '<script src="assets"></script>' },
    { title: 'assets', orderID: 1, code: "fetch('assets');" },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  assert.deepEqual(plan.files, [
    { name: 'index.html', content: '<script src="assets"></script>' },
    { name: 'assets', content: "fetch('assets');" },
  ]);
  assert.deepEqual(plan.renames, []);
});

// --- #211: URL で意味を持つ # と % を含むタブ名 ---
// 名前に # や % が残ると、書かれたままの参照は別の名前のファイルを探す (`a#b.js` → `a`、
// `my%20lib.js` → `my lib.js`)。保存名から外し、参照を保存名に揃える。

test('html-mode local plan: tabs named with # or % are saved under URL-safe names, references as written follow', () => {
  const codeTabs = [
    {
      title: 'index.html', orderID: 0, code: [
        '<script src="a#b.js"></script>',
        "<script src='./my%20lib.js'></script>",
        '<link rel="stylesheet" href="50%.css">',
        '<script src="main.js"></script>',
      ].join('\n'),
    },
    { title: 'a#b.js', orderID: 1, code: 'window.hash = 1;' },
    { title: 'my%20lib.js', orderID: 2, code: 'window.percent = 1;' },
    { title: '50%.css', orderID: 3, code: 'body { width: 50%; }' },
    { title: 'main.js', orderID: 4, code: "loadStrings('a#b.js'); fetch(\"my%20lib.js?v=2\");" },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  assert.deepEqual(plan.files.map(f => f.name), ['index.html', 'a_b.js', 'my_20lib.js', '50_.css', 'main.js']);
  assert.deepEqual(plan.renames, [
    { from: 'a#b.js', to: 'a_b.js' },
    { from: 'my%20lib.js', to: 'my_20lib.js' },
    { from: '50%.css', to: '50_.css' },
  ]);
  assert.equal(plan.files[0].content, [
    '<script src="a_b.js"></script>',
    "<script src='./my_20lib.js'></script>",
    '<link rel="stylesheet" href="50_.css">',
    '<script src="main.js"></script>',
  ].join('\n'));
  // タブの中身は変わらない (CSS の 50% はタブ名ではない)
  assert.equal(plan.files[1].content, 'window.hash = 1;');
  assert.equal(plan.files[2].content, 'window.percent = 1;');
  assert.equal(plan.files[3].content, 'body { width: 50%; }');
  assert.equal(plan.files[4].content, "loadStrings('a_b.js'); fetch(\"my_20lib.js?v=2\");");
});

test('html-mode local plan: references that percent-encode a renamed tab name follow it too', () => {
  // viewer では `a%23b.js` がタブ `a#b.js` を指す。fetch 後も同じタブを指す
  const index = [
    '<script src="a%23b.js"></script>',
    '<script src="./a%23b.js?v=2#top"></script>',
    '<script src="100%25.js"></script>',
    '<script src="my%20file%231.js"></script>',
    '<script src="my file%231.js"></script>',
    '<script src="caf%c3%a9%23.js"></script>',
    '<script src="caf%C3%A9%23.js"></script>',
    '<script src="café%23.js"></script>',
  ].join('\n');
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: index },
    { title: 'a#b.js', orderID: 1, code: '1;' },
    { title: '100%.js', orderID: 2, code: '2;' },
    { title: 'my file#1.js', orderID: 3, code: '3;' },
    { title: 'café#.js', orderID: 4, code: '4;' },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  assert.deepEqual(plan.files.map(f => f.name), ['index.html', 'a_b.js', '100_.js', 'my file_1.js', 'café_.js']);
  assert.equal(plan.files[0].content, [
    '<script src="a_b.js"></script>',
    '<script src="./a_b.js?v=2#top"></script>',
    '<script src="100_.js"></script>',
    '<script src="my file_1.js"></script>',
    '<script src="my file_1.js"></script>',
    '<script src="café_.js"></script>',
    '<script src="café_.js"></script>',
    '<script src="café_.js"></script>',
  ].join('\n'));
});

test('html-mode local plan: a reference that is both a tab name and an encoding of another points to the tab of that name', () => {
  // viewer と同じ順序: 書かれたままの名前のタブが先、無ければデコードした名前のタブ
  const index = [
    '<script src="a#b.js"></script>',
    '<script src="a%23b.js"></script>',
    '<script src="a%2523b.js"></script>',
  ].join('\n');
  const CONTENT = { 'a#b.js': 'window.tab = "hash";', 'a%23b.js': 'window.tab = "percent";' };
  for (const order of [['a#b.js', 'a%23b.js'], ['a%23b.js', 'a#b.js']]) {
    const codeTabs = [
      { title: 'index.html', orderID: 0, code: index },
      ...order.map((title, i) => ({ title, orderID: i + 1, code: CONTENT[title] })),
    ];
    const plan = planHtmlModeLocalFiles({ codeTabs });
    const saved = Object.fromEntries(plan.files.map(f => [f.name, f.content]));

    assert.deepEqual(Object.keys(saved).sort(), ['a_23b.js', 'a_b.js', 'index.html'], order.join(' → '));
    assert.equal(saved['a_b.js'], 'window.tab = "hash";');
    assert.equal(saved['a_23b.js'], 'window.tab = "percent";');
    assert.equal(saved['index.html'], [
      '<script src="a_b.js"></script>',
      '<script src="a_23b.js"></script>',
      '<script src="a_23b.js"></script>',
    ].join('\n'));
  }
});

test('html-mode local plan: a tab whose name is already URL-safe on disk keeps its name and its encoded references', () => {
  // 空白を含む名前のファイルは、`my%20lib.js` でも `my lib.js` でも配信される。付け替えない
  const index = '<script src="my%20lib.js"></script><script src="my lib.js"></script><script src="lib.js?v=2"></script>';
  const codeTabs = [
    { title: 'index.html', orderID: 0, code: index },
    { title: 'my lib.js', orderID: 1, code: '1;' },
    { title: 'lib.js', orderID: 2, code: '2;' },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs });

  assert.deepEqual(plan.files.map(f => f.name), ['index.html', 'my lib.js', 'lib.js']);
  assert.deepEqual(plan.renames, []);
  assert.equal(plan.files[0].content, index);
});

test('html-mode local plan: a tab renamed for its characters does not take the name another tab already has', () => {
  // `a#b.js` を a_b.js にすると、タブ a_b.js への参照まで付け替えたタブを指す
  const index = '<script src="a#b.js"></script><script src="a_b.js"></script>';
  const CONTENT = { 'a#b.js': 'window.tab = "hash";', 'a_b.js': 'window.tab = "underscore";' };
  for (const order of [['a#b.js', 'a_b.js'], ['a_b.js', 'a#b.js']]) {
    const codeTabs = [
      { title: 'index.html', orderID: 0, code: index },
      ...order.map((title, i) => ({ title, orderID: i + 1, code: CONTENT[title] })),
    ];
    const plan = planHtmlModeLocalFiles({ codeTabs });
    const saved = Object.fromEntries(plan.files.map(f => [f.name, f.content]));

    assert.deepEqual(plan.renames, [{ from: 'a#b.js', to: 'a_b_2.js' }], order.join(' → '));
    assert.equal(saved['a_b.js'], 'window.tab = "underscore";');
    assert.equal(saved['a_b_2.js'], 'window.tab = "hash";');
    assert.equal(saved['index.html'], '<script src="a_b_2.js"></script><script src="a_b.js"></script>');
  }
});

test('html-mode local plan: a reference to the "assets" tab with a query or a fragment follows the rename', () => {
  const codeTabs = [
    {
      title: 'index.html', orderID: 0, code: [
        '<script src="assets?v=2"></script>',
        "<link rel=\"stylesheet\" href='./assets#top'>",
        '<a href="assets/readme.txt?v=2">assets</a>',
      ].join('\n'),
    },
    { title: 'assets', orderID: 1, code: 'x' },
    { title: 'main.js', orderID: 2, code: "fetch('assets?cache=1'); fetch('assets?' + query); const q = 'assets?v=2';" },
  ];
  const plan = planHtmlModeLocalFiles({ codeTabs, assetDirName: 'assets' });

  assert.equal(plan.files[0].content, [
    '<script src="assets_2?v=2"></script>',
    "<link rel=\"stylesheet\" href='./assets_2#top'>",
    '<a href="assets/readme.txt?v=2">assets</a>',
  ].join('\n'));
  // 連結する文字列と、URL を書く位置に無い文字列は、従来どおり書き換えない
  assert.equal(plan.files[2].content, "fetch('assets_2?cache=1'); fetch('assets?' + query); const q = 'assets?v=2';");
});

test('p5js mode: assembleOpSketchHtml is unchanged by the html-mode addition', () => {
  const html = assembleOpSketchHtml({
    meta: { mode: 'p5js', engineURL: 'https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.js', fileBase: FILE_BASE, libraries: [] },
    codeTabs: [{ title: 'mySketch.js', orderID: 0, code: 'function setup(){ createCanvas(100,100) }' }],
    options: { assetProxyBaseUrl: PROXY, injectCorsShim: false, injectErrorShim: false },
  });
  // 従来どおり: エンジン script + コードを 1 本の <script> に連結 + viewer 側 <style>
  // (連結したコードは #110 から src の data: URL に入る)
  assert.ok(html.includes('p5@1.9.3/lib/p5.js'));
  const src = /<script src="data:text\/javascript;charset=utf-8;base64,([^"]*)" data-dc-file="op-sketch\.js"><\/script>/.exec(html);
  assert.ok(src, 'joined code is one script');
  assert.ok(Buffer.from(src[1], 'base64').toString('utf8').startsWith('function setup(){ createCanvas(100,100) }'));
  assert.ok(html.includes(`<base href="${PROXY}/user1/visual2/habc/">`));
  assert.ok(html.includes('canvas { display: block;'), 'viewer style still injected in p5js mode');
});

test('p5js mode: joined code is embedded as a data: URL so </script> in it cannot end the tag', () => {
  const code = 'window.p5Text = "</script>"; // </SCRIPT> <!--<script>\nwindow.p5Ran = "日本語";';
  const html = assembleOpSketchHtml({
    meta: { mode: 'p5js', engineURL: 'https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.js', fileBase: FILE_BASE, libraries: [] },
    codeTabs: [{ title: 'mySketch', orderID: 0, code }],
    options: { injectCorsShim: false, injectErrorShim: false },
  });
  const tag = /<script\b[^>]*\bdata-dc-file="([^"]*)"[^>]*>/.exec(html);
  assert.ok(tag, 'sketch script carries data-dc-file');
  const src = /\bsrc="data:text\/javascript;charset=utf-8;base64,([^"]*)"/.exec(tag[0]);
  assert.ok(src, 'sketch code is a base64 data: URL');
  assert.ok(Buffer.from(src[1], 'base64').toString('utf8').startsWith(code), 'decoded code is identical');
  assert.ok(!html.includes('</SCRIPT>') && !html.includes('<!--<script>'), 'no raw code reaches the HTML parser');
  // body 内・エンジンの後という位置は従来どおり
  assert.ok(html.indexOf('p5@1.9.3/lib/p5.js') < tag.index && tag.index > html.indexOf('<body>'));
});
