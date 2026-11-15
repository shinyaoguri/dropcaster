import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, utimes, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #174: 作品のコピーに失敗した scan が成功終了し、配信できない作品をカタログに載せていた。
// scan-sketches.js は module-level で project root を束縛するため、子プロセスで実行する。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = join(repoRoot, 'src/core/scan-sketches.js');
const cliEntry = join(repoRoot, 'src/cli/index.js');

// 読めないファイルでコピーを途中で失敗させる。root は権限を無視するので確かめられない。
const cannotUsePermissions = process.platform === 'win32' || process.getuid?.() === 0;
const permissionSkip = cannotUsePermissions ? 'file permissions are not enforced for this user / platform' : false;

/**
 * @param {string} projectRoot
 * @param {string[]} args
 * @param {{ cli?: boolean }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function run(projectRoot, args, { cli = false } = {}) {
  return new Promise((resolve, reject) => {
    const command = cli ? [cliEntry, 'scan', ...args] : [scanScript, '--write-file', ...args];
    const child = spawn(process.execPath, command, {
      cwd: projectRoot,
      env: {
        ...process.env,
        DROPCASTER_PROJECT_ROOT: projectRoot,
        DROPCASTER_LANG: 'en',
        // プレビュー生成 (--reset が有効にする) を環境に依らず省く: Chromium が見つからない状態にする
        PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, 'no-browsers'),
      },
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

/** @param {string} root @param {string} name @param {string} marker */
async function writeSketch(root, name, marker) {
  const dir = join(root, 'sketches', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), `<!doctype html><title>${marker}</title><canvas></canvas>`, 'utf-8');
  await writeFile(join(dir, 'data.txt'), `data of ${marker}`, 'utf-8');
  return dir;
}

/** @param {string} root */
async function readCatalog(root) {
  return JSON.parse(await readFile(join(root, 'public', 'sketches.json'), 'utf-8'));
}

/** @param {string} path */
async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** @param {(root: string) => Promise<void>} fn */
async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-scan-copy-'));
  try {
    await fn(root);
  } finally {
    // 読めなくしたファイルが残っていても後始末できるよう、権限を戻してから消す
    await chmod(join(root, 'sketches', 'bad', 'data.txt'), 0o644).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

/** @param {string} out */
function describe(out) {
  return `\n--- output ---\n${out}`;
}

test('scan exits non-zero and names the sketch and cause when public/sketches cannot hold the copy', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'ready', 'ready');
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'public', 'sketches'), 'not a directory', 'utf-8');

    const result = await run(root, []);
    assert.notEqual(result.code, 0, `scan must fail${describe(result.stderr)}`);
    assert.match(result.stderr, /ready/);
    assert.match(result.stderr, /ENOTDIR/);
    assert.deepEqual(await readCatalog(root), [], 'a sketch without its public copy must not be cataloged');
  });
});

test('dropcaster scan (CLI) exits non-zero when a sketch copy fails', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'ready', 'ready');
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'public', 'sketches'), 'not a directory', 'utf-8');

    const result = await run(root, ['--no-previews'], { cli: true });
    assert.notEqual(result.code, 0, `CLI must fail${describe(result.stdout + result.stderr)}`);
    assert.match(result.stdout + result.stderr, /ready/);
  });
});

test('when 1 of 2 sketches fails to copy, the other is cataloged and copied and the failed one is not', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'data.txt'), 0o000);

    const result = await run(root, []);
    assert.notEqual(result.code, 0, `scan must fail${describe(result.stderr)}`);
    assert.match(result.stderr, /bad/);
    assert.match(result.stderr, /EACCES|EPERM/);

    const catalog = await readCatalog(root);
    assert.deepEqual(catalog.map((s) => s.id), ['good']);
    assert.equal(await readFile(join(root, 'public', 'sketches', 'good', 'index.html'), 'utf-8'),
      '<!doctype html><title>good</title><canvas></canvas>');
    assert.equal(await exists(join(root, 'public', 'sketches', 'bad')), false, 'no partial copy of the failed sketch');
    assert.deepEqual((await readdir(join(root, 'public', 'sketches'))).sort(), ['good'], 'no staging residue');
  });
});

test('a previously published sketch keeps its old public copy and catalog entry when its update fails', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad-v1');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
    const before = (await readCatalog(root)).find((s) => s.id === 'bad');
    assert.equal(before.title, 'bad-v1');

    // 更新 (新しい内容 + 読めないファイル)。mtime を進めて「更新あり」と判定させる
    await writeFile(join(bad, 'index.html'), '<!doctype html><title>bad-v2</title><canvas></canvas>', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(bad, 'index.html'), future, future);
    await chmod(join(bad, 'data.txt'), 0o000);

    const second = await run(root, []);
    assert.notEqual(second.code, 0, `scan must fail${describe(second.stderr)}`);
    assert.match(second.stderr, /bad/);

    const catalog = await readCatalog(root);
    assert.deepEqual(catalog.map((s) => s.id).sort(), ['bad', 'good']);
    assert.deepEqual(catalog.find((s) => s.id === 'bad'), before, 'old catalog entry is kept as is');
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'index.html'), 'utf-8'),
      '<!doctype html><title>bad-v1</title><canvas></canvas>', 'old public copy is kept');
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'data.txt'), 'utf-8'), 'data of bad-v1');
    assert.deepEqual((await readdir(join(root, 'public', 'sketches'))).sort(), ['bad', 'good'], 'no staging residue');
  });
});

test('after the cause is fixed, a rescan produces a complete copy and catalogs the sketch', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'data.txt'), 0o000);
    const failed = await run(root, []);
    assert.notEqual(failed.code, 0, `scan must fail${describe(failed.stderr)}`);

    // 原因を解消する。chmod は mtime を変えないので、残骸があれば「最新」と誤判定される条件になる
    await chmod(join(bad, 'data.txt'), 0o644);
    const fixed = await run(root, []);
    assert.equal(fixed.code, 0, `rescan failed${describe(fixed.stderr)}`);
    assert.doesNotMatch(fixed.stderr, /bad is up to date/);
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'data.txt'), 'utf-8'), 'data of bad');
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'index.html'), 'utf-8'),
      '<!doctype html><title>bad</title><canvas></canvas>');
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['bad']);
  });
});

test('--sketch: a failed new sketch is not merged into the catalog and other entries stay', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'data.txt'), 0o000);
    const result = await run(root, ['--sketch', 'bad']);
    assert.notEqual(result.code, 0, `scan must fail${describe(result.stderr)}`);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

test('--sketch: a cataloged sketch without its public copy is removed from the catalog when its copy fails', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    await rm(join(root, 'public', 'sketches', 'bad'), { recursive: true });
    await chmod(join(bad, 'data.txt'), 0o000);
    const result = await run(root, ['--sketch', 'bad']);
    assert.notEqual(result.code, 0, `scan must fail${describe(result.stderr)}`);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good'],
      'the merged catalog must not keep an entry whose public copy is gone');
  });
});

test('--reset: a cataloged sketch whose public copy was removed and whose copy fails is dropped', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    await chmod(join(bad, 'data.txt'), 0o000);
    const result = await run(root, ['--reset']);
    assert.notEqual(result.code, 0, `scan must fail${describe(result.stderr)}`);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good'],
      'the old entry would point at a public copy that --reset removed');
    assert.equal(await exists(join(root, 'public', 'sketches', 'bad')), false);
  });
});

// 正常系: 終了コードと主な出力が変わらないこと
test('normal paths keep exit code 0 and their output (first scan, unchanged rescan, --sketch, --reset)', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'alpha', 'alpha');
    await writeSketch(root, 'beta', 'beta');

    const first = await run(root, []);
    assert.equal(first.code, 0, describe(first.stderr));
    assert.match(first.stderr, /📁 Copied alpha to public directory/);
    assert.match(first.stderr, /📁 Copied beta to public directory/);
    assert.match(first.stderr, /📋 Scanned 2 sketch\(es\)/);

    const unchanged = await run(root, []);
    assert.equal(unchanged.code, 0, describe(unchanged.stderr));
    assert.match(unchanged.stderr, /✓ alpha is up to date/);
    assert.match(unchanged.stderr, /✓ beta is up to date/);
    assert.match(unchanged.stderr, /📋 Scanned 2 sketch\(es\)/);

    const single = await run(root, ['--sketch', 'alpha']);
    assert.equal(single.code, 0, describe(single.stderr));
    assert.match(single.stderr, /✓ alpha is up to date/);
    assert.doesNotMatch(single.stderr, /beta/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['alpha', 'beta']);

    const reset = await run(root, ['--reset']);
    assert.equal(reset.code, 0, describe(reset.stderr));
    assert.match(reset.stderr, /📁 Copied alpha to public directory/);
    assert.match(reset.stderr, /📁 Copied beta to public directory/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['alpha', 'beta']);
    assert.deepEqual((await readdir(join(root, 'public', 'sketches'))).sort(), ['alpha', 'beta']);
  });
});
