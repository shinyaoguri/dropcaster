import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { assembleHtmlModeOpSketchHtml } from '../src/core/modules/op-sketch-builder.js';

// #211: html モードの作品は、viewer で開いても、fetch して配信しても、参照が同じタブを読む。
// 名前に # や % を含むタブは、書き出したファイルを参照が指さなかった (`a#b.js` → `a`、
// `my%20lib.js` → `my lib.js`)。
// CLI を子プロセスで実行し (OpenProcessing への取得は tests/fixtures/op-fetch-stub.mjs で差し替える)、
// 書き出したディレクトリを `dropcaster preview` と同じ Vite の preview で配信して、index.html に
// 書かれた参照を URL として取得する。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(repoRoot, 'src/cli/index.js');
const stubModule = join(repoRoot, 'tests/fixtures/op-fetch-stub.mjs');

const ID = '211';
const META = { visualID: 211, title: 'URL characters in tab names', username: 'someone', mode: 'html', engineURL: '', libraries: [] };

// index.html が読む順に、参照と、その参照で読まれるべきタブの中身
const LOADED = [
  { tag: '<script src="a#b.js"></script>', body: 'window.hashTab = 1;' },
  { tag: '<script src="my%20lib.js"></script>', body: 'window.percentTab = 1;' },
  { tag: '<script src="enc%23oded.js"></script>', body: 'window.encodedReference = 1;' },
  { tag: '<script src="plain.js?v=2"></script>', body: 'window.plainTab = 1;' },
  { tag: '<link rel="stylesheet" href="50%.css">', body: 'body { margin: 0; }' },
];

const TABS = [
  { title: 'index.html', code: `<!doctype html>\n<html><head>\n${LOADED.map(l => l.tag).join('\n')}\n</head><body></body></html>` },
  { title: 'a#b.js', code: 'window.hashTab = 1;' },
  // 参照 `a#b.js` を URL として読むと a、`my%20lib.js` を読むと `my lib.js`。
  // 書かれたままの名前のタブがあるので、どちらも読まれてはいけない
  { title: 'a', code: 'window.wrongTabForHash = 1;' },
  { title: 'my%20lib.js', code: 'window.percentTab = 1;' },
  { title: 'my lib.js', code: 'window.wrongTabForPercent = 1;' },
  { title: 'enc#oded.js', code: 'window.encodedReference = 1;' },
  { title: 'plain.js', code: 'window.plainTab = 1;' },
  { title: '50%.css', code: 'body { margin: 0; }' },
].map((tab, orderID) => ({ orderID, ...tab }));

/**
 * @param {string} root
 * @returns {Promise<{ code: number | null, output: string }>}
 */
async function runFetch(root) {
  const fixturePath = join(root, 'op-fixture.json');
  await writeFile(fixturePath, JSON.stringify({ sketches: { [ID]: { meta: META, code: TABS } } }), 'utf-8');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', stubModule, cliEntry, 'fetch', ID], {
      cwd: root,
      env: { ...process.env, DROPCASTER_LANG: 'en', DC_OP_FIXTURE: fixturePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('html mode: tabs named with # or % are read by the references as written, once fetched and served', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-fetch-tab-url-chars-'));
  let server;
  try {
    const result = await runFetch(root);
    assert.equal(result.code, 0, `\n--- output ---\n${result.output}`);
    const dir = join(root, 'sketches', `sketch${ID}`);

    // appType: 'mpa' は、無いファイルに index.html を返さないため (取り違えを 200 にしない)
    server = await preview({
      root, configFile: false, logLevel: 'silent', appType: 'mpa',
      build: { outDir: dir },
      preview: { port: 0, host: '127.0.0.1' },
    });
    const base = server.resolvedUrls?.local[0];
    assert.ok(base, 'preview server has a local URL');

    const index = await readFile(join(dir, 'index.html'), 'utf-8');
    const refs = [...index.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(m => m[1]);
    assert.equal(refs.length, LOADED.length, `references in the saved index.html:\n${index}`);
    const served = [];
    for (const ref of refs) {
      const res = await fetch(new URL(ref, base)); // ブラウザと同じく、参照を文書の URL から解決する
      served.push(res.ok ? await res.text() : `HTTP ${res.status} for ${ref}`);
    }
    assert.deepEqual(served, LOADED.map(l => l.body), `saved: ${(await readdir(dir)).join(', ')}\n${index}`);

    // 付け替えは警告される (読み込めているかを利用者が確かめられるように)
    assert.match(result.output, /Tab "a#b\.js" was written as "a_b\.js"/);
    assert.match(result.output, /Tab "my%20lib\.js" was written as "my_20lib\.js"/);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('html mode: the viewer embeds the same tabs for the same references', () => {
  const html = assembleHtmlModeOpSketchHtml({ meta: { ...META, fileBase: 'https://deckard.openprocessing.org/user1/visual211/habc/' }, codeTabs: TABS });
  const scripts = [...html.matchAll(/<script src="data:text\/javascript;charset=utf-8;base64,([^"]*)" data-dc-file="[^"]*"><\/script>/g)]
    .map(m => Buffer.from(m[1], 'base64').toString('utf8').replace(/\n\/\/# sourceURL=.*$/, ''));
  const styles = [...html.matchAll(/<style>\n([\s\S]*?)\n<\/style>/g)].map(m => m[1]);
  assert.deepEqual([...scripts, ...styles], LOADED.map(l => l.body));
});
