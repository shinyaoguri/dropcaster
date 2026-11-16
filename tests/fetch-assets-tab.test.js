import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #220: html モードの作品に「assets」という名前のタブがあると、アセットの同梱先 assets/ と
// 同じ名前のファイルを書こうとして fetch が失敗していた。
// CLI を子プロセスで実行し、OpenProcessing への取得は tests/fixtures/op-fetch-stub.mjs で
// fixture に差し替える (ネットワークには出ない)。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(repoRoot, 'src/cli/index.js');
const stubModule = join(repoRoot, 'tests/fixtures/op-fetch-stub.mjs');

const ID = '123';
// パスにも「assets」を含むアセット (タブの付け替えで URL が書き換わらないことを見る)
const ASSET_URL = 'https://deckard.openprocessing.org/user1/visual123/habc/assets.png';
const BUNDLED_ASSET = 'assets/user1/visual123/habc/assets.png';

const htmlMeta = {
  visualID: 123, title: 'Assets tab', username: 'someone', mode: 'html', engineURL: '', libraries: [],
};
const ASSETS_TAB_CODE = 'window.palette = ["#000"];';

/** @param {string} tabName @param {string} mainCode */
function htmlTabs(tabName, mainCode) {
  return [
    { orderID: 0, title: 'index.html', code: `<!doctype html><script src="${tabName}"></script><script src="main.js"></script>` },
    { orderID: 1, title: tabName, code: ASSETS_TAB_CODE },
    { orderID: 2, title: 'main.js', code: mainCode },
  ];
}

const MAIN_WITH_ASSET = `const assets = []; assets.push(loadImage('${ASSET_URL}'));`;

/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ meta: object, code: object[] }} sketch
 * @returns {Promise<{ code: number | null, output: string }>}
 */
async function runFetch(root, args, sketch) {
  const fixturePath = join(root, 'op-fixture.json');
  await writeFile(fixturePath, JSON.stringify({
    sketches: { [ID]: sketch },
    assets: { [ASSET_URL]: { body: 'PNG' } },
  }), 'utf-8');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', stubModule, cliEntry, 'fetch', ID, ...args], {
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

/** @param {(root: string, dir: string) => Promise<void>} fn */
async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-fetch-assets-tab-'));
  try {
    await fn(root, join(root, 'sketches', `sketch${ID}`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** @param {string} path */
const read = (path) => readFile(path, 'utf-8');

/** @param {string} out */
function describe(out) {
  return `\n--- output ---\n${out}`;
}

for (const tabName of ['assets', 'Assets']) {
  test(`html mode: a tab named "${tabName}" is saved beside the bundled assets, and fetch succeeds`, async () => {
    await withTempProject(async (root, dir) => {
      const result = await runFetch(root, [], { meta: htmlMeta, code: htmlTabs(tabName, MAIN_WITH_ASSET) });
      assert.equal(result.code, 0, describe(result.output));

      const savedName = `${tabName}_2`;
      assert.deepEqual((await readdir(dir)).sort(), ['_op-meta.json', 'assets', savedName, 'index.html', 'main.js'].sort());
      // アセットは assets/ に入る
      assert.ok((await stat(join(dir, 'assets'))).isDirectory(), 'assets is the asset directory');
      assert.equal(await read(join(dir, BUNDLED_ASSET)), 'PNG');
      // タブは別の名前のファイルになり、参照はその名前を指す
      assert.equal(await read(join(dir, savedName)), ASSETS_TAB_CODE);
      assert.equal(await read(join(dir, 'index.html')),
        `<!doctype html><script src="${savedName}"></script><script src="main.js"></script>`);
      // タブへの参照でない assets (識別子・同梱したアセットのパス) は書き換わらない
      assert.equal(await read(join(dir, 'main.js')), `const assets = []; assets.push(loadImage('${BUNDLED_ASSET}'));`);
      assert.match(result.output, new RegExp(`Tab "${tabName}" was written as "${savedName}"`));
    });
  });
}

test('html mode: with --no-assets, a tab named "assets" is saved under its own name', async () => {
  await withTempProject(async (root, dir) => {
    const result = await runFetch(root, ['--no-assets'], { meta: htmlMeta, code: htmlTabs('assets', MAIN_WITH_ASSET) });
    assert.equal(result.code, 0, describe(result.output));

    assert.deepEqual((await readdir(dir)).sort(), ['_op-meta.json', 'assets', 'index.html', 'main.js']);
    assert.equal(await read(join(dir, 'assets')), ASSETS_TAB_CODE);
    assert.equal(await read(join(dir, 'index.html')),
      '<!doctype html><script src="assets"></script><script src="main.js"></script>');
    assert.equal(await read(join(dir, 'main.js')), MAIN_WITH_ASSET);
    assert.doesNotMatch(result.output, /was written as/);
  });
});

test('html mode: a sketch without assets to bundle keeps a tab named "assets" under its own name', async () => {
  await withTempProject(async (root, dir) => {
    const result = await runFetch(root, [], { meta: htmlMeta, code: htmlTabs('assets', 'const assets = [];') });
    assert.equal(result.code, 0, describe(result.output));

    assert.deepEqual((await readdir(dir)).sort(), ['_op-meta.json', 'assets', 'index.html', 'main.js']);
    assert.equal(await read(join(dir, 'assets')), ASSETS_TAB_CODE);
    assert.equal(await read(join(dir, 'index.html')),
      '<!doctype html><script src="assets"></script><script src="main.js"></script>');
    assert.doesNotMatch(result.output, /was written as/);
  });
});

test('p5js mode: a tab titled "assets" is saved as assets.js beside the bundled assets', async () => {
  await withTempProject(async (root, dir) => {
    const meta = { ...htmlMeta, mode: 'p5js', engineURL: 'https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js' };
    const code = [{ orderID: 0, title: 'assets', code: MAIN_WITH_ASSET }];
    const result = await runFetch(root, [], { meta, code });
    assert.equal(result.code, 0, describe(result.output));

    assert.deepEqual((await readdir(dir)).sort(), ['_op-meta.json', 'assets', 'assets.js', 'index.html']);
    assert.equal(await read(join(dir, BUNDLED_ASSET)), 'PNG');
    assert.equal(await read(join(dir, 'assets.js')), `const assets = []; assets.push(loadImage('${BUNDLED_ASSET}'));`);
    assert.match(await read(join(dir, 'index.html')), /<script src="assets\.js" type="text\/javascript"><\/script>/);
  });
});
