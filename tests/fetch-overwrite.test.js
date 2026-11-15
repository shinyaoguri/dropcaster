import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #167: fetch --overwrite が取得内容の検証前に既存作品を消していた。
// CLI を子プロセスで実行し、OpenProcessing への取得は tests/fixtures/op-fetch-stub.mjs で
// fixture に差し替える (ネットワークには出ない)。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(repoRoot, 'src/cli/index.js');
const stubModule = join(repoRoot, 'tests/fixtures/op-fetch-stub.mjs');

const permissionSkip = process.platform === 'win32' || process.getuid?.() === 0
  ? 'file permissions are not enforced for this user / platform'
  : false;

const ID = '123';
const ASSET_URL = 'https://deckard.openprocessing.org/user1/visual123/habc/tex.png';

const p5Meta = {
  visualID: 123, title: 'New version', username: 'someone', mode: 'p5js',
  engineURL: 'https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js', libraries: [],
};
const p5Code = [
  { orderID: 0, title: 'mySketch', code: `let img;\nfunction preload() { img = loadImage('${ASSET_URL}'); }\n// new version` },
];
const htmlMeta = { ...p5Meta, mode: 'html' };
// index タブの無い html モード作品 (Issue の再現例)
const htmlWithoutIndex = [{ orderID: 0, title: 'main.js', code: 'console.log("no index");' }];

/**
 * @typedef {{ meta?: object | null, code?: object[] | null, status?: number }} SketchFixture
 * @typedef {{ sketch: SketchFixture, assets?: Record<string, { body?: string, status?: number }>, failWrite?: string }} Scenario
 */

/**
 * @param {string} root
 * @param {string[]} args
 * @param {Scenario} scenario
 * @returns {Promise<{ code: number | null, output: string }>}
 */
async function runFetch(root, args, scenario) {
  const fixturePath = join(root, 'op-fixture.json');
  await writeFile(fixturePath, JSON.stringify({
    sketches: { [ID]: scenario.sketch },
    assets: scenario.assets ?? { [ASSET_URL]: { body: 'PNG new' } },
  }), 'utf-8');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', stubModule, cliEntry, 'fetch', ID, ...args], {
      cwd: root,
      env: {
        ...process.env,
        DROPCASTER_LANG: 'en',
        DC_OP_FIXTURE: fixturePath,
        DC_FAIL_WRITE_BASENAME: scenario.failWrite ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** @param {(root: string) => Promise<void>} fn */
async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-fetch-overwrite-'));
  try {
    await fn(root);
  } finally {
    await unlockDirectories(root);
    await rm(root, { recursive: true, force: true });
  }
}

/** @param {string} dir */
async function unlockDirectories(dir) {
  await chmod(dir, 0o755).catch(() => {});
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) await unlockDirectories(join(dir, entry.name));
  }
}

/** 既存の (旧版の) 作品を置く。手で置いたファイルを含める */
async function writeOldSketch(root) {
  const dir = join(root, 'sketches', `sketch${ID}`);
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>old version</title>', 'utf-8');
  await writeFile(join(dir, 'mySketch.js'), '// old version', 'utf-8');
  await writeFile(join(dir, 'assets', 'old.png'), 'PNG old', 'utf-8');
  return dir;
}

/** @param {string} dir */
async function assertOldSketchIntact(dir) {
  assert.equal(await readFile(join(dir, 'index.html'), 'utf-8'), '<!doctype html><title>old version</title>');
  assert.equal(await readFile(join(dir, 'mySketch.js'), 'utf-8'), '// old version');
  assert.equal(await readFile(join(dir, 'assets', 'old.png'), 'utf-8'), 'PNG old');
  assert.deepEqual((await readdir(dir)).sort(), ['assets', 'index.html', 'mySketch.js']);
}

/** sketches/ に作品以外 (作業用ディレクトリなど) が残っていないこと */
async function assertSketchesDirHolds(root, expected) {
  assert.deepEqual((await readdir(join(root, 'sketches'))).sort(), expected, 'no staging residue in sketches/');
}

/** @param {string} path */
async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** @param {string} out */
function describe(out) {
  return `\n--- output ---\n${out}`;
}

test('--overwrite replaces an existing sketch with the fetched contents', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(result.code, 0, describe(result.output));
    assert.match(await readFile(join(dir, 'mySketch.js'), 'utf-8'), /new version/);
    assert.match(await readFile(join(dir, 'mySketch.js'), 'utf-8'), /assets\/user1\/visual123\/habc\/tex\.png/,
      'code refers to the bundled asset');
    assert.equal(await readFile(join(dir, 'assets', 'user1', 'visual123', 'habc', 'tex.png'), 'utf-8'), 'PNG new');
    assert.match(await readFile(join(dir, 'index.html'), 'utf-8'), /mySketch\.js/);
    assert.equal(JSON.parse(await readFile(join(dir, '_op-meta.json'), 'utf-8')).title, 'New version');
    assert.equal(await exists(join(dir, 'assets', 'old.png')), false, 'files of the old version are gone');
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('--overwrite replaces an existing sketch with a valid html-mode sketch', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);
    const code = [
      { orderID: 0, title: 'index.html', code: '<!doctype html><title>new html</title><script src="main.js"></script>' },
      { orderID: 1, title: 'main.js', code: `fetch('${ASSET_URL}');` },
    ];

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: htmlMeta, code } });
    assert.equal(result.code, 0, describe(result.output));
    assert.deepEqual((await readdir(dir)).sort(), ['_op-meta.json', 'assets', 'index.html', 'main.js']);
    assert.match(await readFile(join(dir, 'index.html'), 'utf-8'), /new html/);
    assert.equal(await readFile(join(dir, 'main.js'), 'utf-8'), "fetch('assets/user1/visual123/habc/tex.png');");
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('fetch creates the sketch directory (and sketches/) when nothing exists yet', async () => {
  await withTempProject(async (root) => {
    const result = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(result.code, 0, describe(result.output));
    const dir = join(root, 'sketches', `sketch${ID}`);
    assert.deepEqual((await readdir(dir)).sort(), ['_op-meta.json', 'assets', 'index.html', 'mySketch.js']);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('without --overwrite, an existing sketch is refused and left unchanged', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    const result = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, /Directory already exists/);
    assert.match(result.output, /--overwrite/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('--overwrite keeps the existing sketch when the fetched html-mode sketch has no index tab', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: htmlMeta, code: htmlWithoutIndex } });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, /no index\.html tab/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('--overwrite keeps the existing sketch when the OpenProcessing API request fails', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: null } });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, /Failed to fetch sketch 123/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('--overwrite keeps the existing sketch when writing fails after the assets were downloaded', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    // 最後に書く _op-meta.json で失敗させる: アセットとコードは書き終えた後の失敗
    const result = await runFetch(root, ['--overwrite'], {
      sketch: { meta: p5Meta, code: p5Code },
      failWrite: '_op-meta.json',
    });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, /Downloaded 1\/1 asset/, `the failure must come after the asset download${describe(result.output)}`);
    assert.match(result.output, /ENOSPC/);
    assert.match(result.output, /left unchanged/);
    // 日常的に起こりうる失敗なので、未処理の rejection のスタックを出さない
    assert.doesNotMatch(result.output, /node:internal|at async/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('a failed new fetch leaves no directory, and a retry without --overwrite succeeds', async () => {
  await withTempProject(async (root) => {
    const invalid = await runFetch(root, [], { sketch: { meta: htmlMeta, code: htmlWithoutIndex } });
    assert.equal(invalid.code, 1, describe(invalid.output));
    assert.equal(await exists(join(root, 'sketches', `sketch${ID}`)), false, 'no empty directory after a validation failure');

    const writeFailed = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code }, failWrite: '_op-meta.json' });
    assert.equal(writeFailed.code, 1, describe(writeFailed.output));
    assert.equal(await exists(join(root, 'sketches', `sketch${ID}`)), false, 'no partial directory after a write failure');
    await assertSketchesDirHolds(root, []);

    const retry = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(retry.code, 0, describe(retry.output));
    assert.match(await readFile(join(root, 'sketches', `sketch${ID}`, 'mySketch.js'), 'utf-8'), /new version/);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('when only removing the old version fails, the new version is in place and the leftover is reported', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);
    // 旧版の中に書き込めないディレクトリを置き、差し替え後の旧版の削除だけを失敗させる
    const locked = join(dir, 'locked');
    await mkdir(locked);
    await writeFile(join(locked, 'old.txt'), 'old', 'utf-8');
    await chmod(locked, 0o555);

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(result.code, 0, `the new version is in place, so fetch succeeds${describe(result.output)}`);
    assert.match(await readFile(join(dir, 'mySketch.js'), 'utf-8'), /new version/);
    const residue = (await readdir(join(root, 'sketches'))).filter((name) => name !== `sketch${ID}`);
    assert.equal(residue.length, 1, `expected one leftover: ${residue.join(', ')}`);
    assert.match(residue[0], /^\.dc-previous-[0-9a-f]{16}$/);
    assert.match(result.output, new RegExp(`could not remove the previous version at \\S*${residue[0]}`));
  });
});
