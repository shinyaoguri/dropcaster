import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeSketch } from '../src/core/modules/sketch-analyzer.js';

// #115: 再 scan で既存の sketches.json の title / description が HTML の新しい値より優先され、
// HTML の変更が反映されなかった。決定した優先順位 (タイトル・説明とも):
//   手動メタデータ > 今回の --fetch-userdata > _op-meta.json > HTML の明示値 > 既存カタログ > 既定値
// scan-sketches.js は module-level で project root を束縛するため、子プロセスで実行する。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = join(repoRoot, 'src/core/scan-sketches.js');

// --fetch-userdata の検証で OpenProcessing へ通信しないよう、子プロセスの fetch を差し替える。
// /api/sketch/123 だけ API の値を返し、それ以外は 404。
const fetchStub = `
globalThis.fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  if (path === '/api/sketch/123') {
    return new Response(JSON.stringify({ visualID: 123, title: 'API title', description: 'API description' }), { status: 200 });
  }
  return new Response(JSON.stringify({ success: false, message: 'not found' }), { status: 404 });
};
`;
const fetchStubImport = `data:text/javascript,${encodeURIComponent(fetchStub)}`;

/**
 * @param {string} projectRoot
 * @param {string[]} [args]
 * @param {{ stubFetch?: boolean }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runScan(projectRoot, args = [], { stubFetch = false } = {}) {
  return new Promise((resolve, reject) => {
    const nodeArgs = stubFetch ? ['--import', fetchStubImport] : [];
    const child = spawn(process.execPath, [...nodeArgs, scanScript, '--write-file', ...args], {
      env: { ...process.env, DROPCASTER_PROJECT_ROOT: projectRoot, DROPCASTER_LANG: 'en' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** @param {string} root @param {string[]} [args] @param {{ stubFetch?: boolean }} [options] */
async function scanOk(root, args = [], options = {}) {
  const { code, stderr } = await runScan(root, args, options);
  assert.equal(code, 0, `scan failed:\n${stderr}`);
  return stderr;
}

/**
 * @param {{ title?: string, description?: string }} meta
 * @returns {string}
 */
function html({ title, description } = {}) {
  const titleTag = title === undefined ? '' : `<title>${title}</title>`;
  const descTag = description === undefined ? '' : `<meta name="description" content="${description}">`;
  return `<!doctype html><html><head>${titleTag}${descTag}</head><body><canvas></canvas></body></html>`;
}

/** @param {string} root @param {string} name @param {string} content */
async function writeIndex(root, name, content) {
  const dir = join(root, 'sketches', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), content, 'utf-8');
}

/** @param {string} root @param {string} name @param {string} file @param {unknown} value */
async function writeJson(root, name, file, value) {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  await writeFile(join(root, 'sketches', name, file), content, 'utf-8');
}

/** @param {string} root @param {object[]} sketches */
async function writeCatalog(root, sketches) {
  await mkdir(join(root, 'public'), { recursive: true });
  await writeFile(join(root, 'public', 'sketches.json'), JSON.stringify(sketches, null, 2), 'utf-8');
}

/** @param {string} root */
async function readCatalog(root) {
  return JSON.parse(await readFile(join(root, 'public', 'sketches.json'), 'utf-8'));
}

/** @param {string} root @param {string} id */
async function entry(root, id) {
  const found = (await readCatalog(root)).find(s => s.id === id);
  assert.ok(found, `${id} entry missing`);
  return found;
}

/** @param {(root: string) => Promise<void>} fn */
async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-scan-meta-'));
  try { await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('re-scan reflects changed HTML title and description', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'demo', html({ title: 'Old title', description: 'Old description' }));
    await scanOk(root);
    assert.equal((await entry(root, 'demo')).title, 'Old title');

    await writeIndex(root, 'demo', html({ title: 'New title', description: 'New description' }));
    await scanOk(root);
    const demo = await entry(root, 'demo');
    assert.equal(demo.title, 'New title');
    assert.equal(demo.description, 'New description');
  });
});

test('re-scan without changes keeps the same title and description', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'demo', html({ title: 'Same title', description: 'Same description' }));
    await scanOk(root);
    const first = await entry(root, 'demo');
    await scanOk(root);
    const second = await entry(root, 'demo');
    assert.equal(second.title, 'Same title');
    assert.equal(second.description, 'Same description');
    assert.deepEqual(second, first);
  });
});

test('existing catalog title and description are kept when HTML has none', async () => {
  await withTempProject(async (root) => {
    // p5js モードで fetch した作品の index.html のように、<title> も description も無い
    await writeIndex(root, 'demo', html());
    await writeCatalog(root, [
      { id: 'demo', title: 'Kept title', description: 'Kept description', path: 'sketches/demo/' },
    ]);
    await scanOk(root);
    const demo = await entry(root, 'demo');
    assert.equal(demo.title, 'Kept title');
    assert.equal(demo.description, 'Kept description');
  });
});

test('manual metadata wins over HTML and the existing catalog', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'demo', html({ title: 'HTML title', description: 'HTML description' }));
    await writeJson(root, 'demo', 'dropcaster.meta.json', { title: 'Manual title', description: 'Manual description' });
    await writeCatalog(root, [
      { id: 'demo', title: 'Catalog title', description: 'Catalog description', path: 'sketches/demo/' },
    ]);
    await scanOk(root);
    let demo = await entry(root, 'demo');
    assert.equal(demo.title, 'Manual title');
    assert.equal(demo.description, 'Manual description');

    // HTML を変えても手動メタデータが勝ち続ける
    await writeIndex(root, 'demo', html({ title: 'Changed HTML title', description: 'Changed HTML description' }));
    await scanOk(root);
    demo = await entry(root, 'demo');
    assert.equal(demo.title, 'Manual title');
    assert.equal(demo.description, 'Manual description');
  });
});

test('_op-meta.json wins over a generic HTML title and the existing catalog', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'sketch123', html({ title: 'p5.js Sketch', description: 'HTML description' }));
    await writeJson(root, 'sketch123', '_op-meta.json', { visualID: '123', title: 'OP title', description: 'OP description' });
    await writeCatalog(root, [
      { id: 'sketch123', title: 'Catalog title', description: 'Catalog description', path: 'sketches/sketch123/' },
    ]);
    await scanOk(root);
    const sketch = await entry(root, 'sketch123');
    assert.equal(sketch.title, 'OP title');
    assert.equal(sketch.description, 'OP description');
  });
});

test('empty _op-meta.json values fall through to the HTML values', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'sketch123', html({ title: 'New HTML title', description: 'New HTML description' }));
    await writeJson(root, 'sketch123', '_op-meta.json', { visualID: '123', title: '', description: '  ' });
    await writeCatalog(root, [
      { id: 'sketch123', title: 'Old HTML title', description: 'Old HTML description', path: 'sketches/sketch123/' },
    ]);
    await scanOk(root);
    const sketch = await entry(root, 'sketch123');
    assert.equal(sketch.title, 'New HTML title');
    assert.equal(sketch.description, 'New HTML description');
  });
});

test('unreadable _op-meta.json is ignored with a warning and HTML values are used', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'sketch123', html({ title: 'HTML title', description: 'HTML description' }));
    await writeJson(root, 'sketch123', '_op-meta.json', '{ not json');
    const stderr = await scanOk(root);
    const sketch = await entry(root, 'sketch123');
    assert.equal(sketch.title, 'HTML title');
    assert.equal(sketch.description, 'HTML description');
    assert.match(stderr, /_op-meta\.json/);
  });
});

test('--fetch-userdata values win over _op-meta.json and HTML, manual metadata still wins', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'sketch123', html({ title: 'HTML title', description: 'HTML description' }));
    await writeJson(root, 'sketch123', '_op-meta.json', { visualID: '123', title: 'OP title', description: 'OP description' });
    await scanOk(root, ['--fetch-userdata', '--api-request-interval-ms', '0'], { stubFetch: true });
    let sketch = await entry(root, 'sketch123');
    assert.equal(sketch.title, 'API title');
    assert.equal(sketch.description, 'API description');

    await writeJson(root, 'sketch123', 'dropcaster.meta.json', { title: 'Manual title' });
    await scanOk(root, ['--fetch-userdata', '--api-request-interval-ms', '0'], { stubFetch: true });
    sketch = await entry(root, 'sketch123');
    assert.equal(sketch.title, 'Manual title');
    assert.equal(sketch.description, 'API description');
  });
});

test('--sketch re-scan reflects the target HTML change and leaves other entries as they were', async () => {
  await withTempProject(async (root) => {
    await writeIndex(root, 'demo', html({ title: 'Old title', description: 'Old description' }));
    await writeIndex(root, 'other', html({ title: 'Other title', description: 'Other description' }));
    await scanOk(root);

    await writeIndex(root, 'demo', html({ title: 'New title', description: 'New description' }));
    await writeIndex(root, 'other', html({ title: 'Other changed', description: 'Other changed description' }));
    await scanOk(root, ['--sketch', 'demo']);

    const catalog = await readCatalog(root);
    assert.deepEqual(catalog.map(s => s.id).sort(), ['demo', 'other']);
    const demo = await entry(root, 'demo');
    assert.equal(demo.title, 'New title');
    assert.equal(demo.description, 'New description');
    // --sketch は対象だけ走査するので、他の作品は前回の項目のまま
    const other = await entry(root, 'other');
    assert.equal(other.title, 'Other title');
    assert.equal(other.description, 'Other description');
  });
});

test('re-scan reflects a changed multi-line title and a content-first meta description', async () => {
  await withTempProject(async (root) => {
    /** @param {string} title @param {string} description */
    const page = (title, description) =>
      `<!doctype html><html><head>\n<title lang="en">\n  ${title}\n</title>\n` +
      `<meta content="${description}" name="description">\n</head><body></body></html>`;
    await writeIndex(root, 'demo', page('Old title', 'Old description'));
    await scanOk(root);
    await writeIndex(root, 'demo', page('New title', 'New description'));
    await scanOk(root);
    const demo = await entry(root, 'demo');
    assert.equal(demo.title, 'New title');
    assert.equal(demo.description, 'New description');
  });
});

// HTML の読み取りは analyzeSketch を直接呼んで確かめる (scan と同じ関数)
/** @param {string} headHtml */
async function analyzeHead(headHtml) {
  const root = await mkdtemp(join(tmpdir(), 'dc-analyze-'));
  try {
    await writeFile(join(root, 'index.html'), `<!doctype html><html><head>${headHtml}</head><body></body></html>`, 'utf-8');
    const info = await analyzeSketch('demo', root);
    assert.ok(info, 'analyzeSketch returned null');
    return info;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** @type {[string, string, string][]} */
const titleCases = [
  ['plain', '<title>Plain</title>', 'Plain'],
  ['uppercase tag', '<TITLE>Upper</TITLE>', 'Upper'],
  ['attribute on the tag', '<title lang="ja">属性付き</title>', '属性付き'],
  ['line breaks inside', '<title>\n  Multi\n  line\n</title>', 'Multi line'],
  ['HTML entities', '<title>Tom &amp; Jerry &lt;3 &#x2014; &#8212;</title>', 'Tom & Jerry <3 — —'],
  // 知らない名前 (Object のプロパティ名を含む) はそのまま残す
  ['unknown entities', '<title>&unknown; &constructor; &#0;</title>', '&unknown; &constructor; &#0;'],
];
for (const [label, head, expected] of titleCases) {
  test(`HTML title is read: ${label}`, async () => {
    assert.equal((await analyzeHead(head)).title, expected);
  });
}

test('blank HTML title is treated as no value', async () => {
  const info = await analyzeHead('<title>  </title>');
  assert.equal(info.title, 'demo');
  assert.ok(!info.__explicitMetadataFields?.has('title'));
});

/** @type {[string, string, string][]} */
const descriptionCases = [
  ['name then content', '<meta name="description" content="Plain">', 'Plain'],
  ['content then name', '<meta content="Content first" name="description">', 'Content first'],
  ['unquoted values', '<meta name=description content=Unquoted>', 'Unquoted'],
  ['apostrophe inside double quotes', '<meta name="description" content="Don\'t panic">', "Don't panic"],
  ['double quotes inside single quotes', `<meta name='description' content='Say "hi"'>`, 'Say "hi"'],
  ['other attributes, uppercase name and line breaks', '<meta\n  data-x="1"\n  name="Description"\n  content="Across lines"\n/>', 'Across lines'],
  ['greater-than inside the value', '<meta name="description" content="a > b">', 'a > b'],
  ['HTML entities', '<meta name="description" content="&quot;Q&quot; &amp; A">', '"Q" & A'],
];
for (const [label, head, expected] of descriptionCases) {
  test(`HTML meta description is read: ${label}`, async () => {
    assert.equal((await analyzeHead(head)).description, expected);
  });
}

test('other meta tags are not taken as the description', async () => {
  const info = await analyzeHead('<meta name="keywords" content="a, b"><meta property="og:description" content="OG">');
  assert.equal(info.description, 'demo スケッチ');
  assert.deepEqual(info.tags, ['a', 'b']);
});
