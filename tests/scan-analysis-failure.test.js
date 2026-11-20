import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #213: 作品の index.html が読めない scan が成功終了し、前回のカタログ項目を黙って落としていた。
// scan-sketches.js は module-level で project root を束縛するため、子プロセスで実行する。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = join(repoRoot, 'src/core/scan-sketches.js');
const cliEntry = join(repoRoot, 'src/cli/index.js');

// 読めない index.html で解析を失敗させる。root は権限を無視するので確かめられない。
const cannotUsePermissions = process.platform === 'win32' || process.getuid?.() === 0;
const permissionSkip = cannotUsePermissions ? 'file permissions are not enforced for this user / platform' : false;

/**
 * @param {string} projectRoot
 * @param {string[]} args
 * @param {{ cli?: boolean, writeFile?: boolean }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function run(projectRoot, args, { cli = false, writeFile: writeFileOutput = true } = {}) {
  return new Promise((resolve, reject) => {
    const script = cli
      ? [cliEntry, 'scan', ...args]
      : [scanScript, ...(writeFileOutput ? ['--write-file'] : []), ...args];
    const child = spawn(process.execPath, script, {
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

/** @param {string} marker */
function htmlOf(marker) {
  return `<!doctype html><title>${marker}</title><canvas></canvas>`;
}

/** @param {string} root @param {string} name @param {string} marker */
async function writeSketch(root, name, marker) {
  const dir = join(root, 'sketches', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), htmlOf(marker), 'utf-8');
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
  const root = await mkdtemp(join(tmpdir(), 'dc-scan-analysis-'));
  try {
    await fn(root);
  } finally {
    // 読めなくした index.html・入れなくした作品ディレクトリの権限を戻してから消す
    await restorePermissions(root);
    await rm(root, { recursive: true, force: true });
  }
}

/** @param {string} dir */
async function restorePermissions(dir) {
  await chmod(dir, 0o755).catch(() => {});
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await restorePermissions(path);
    else await chmod(path, 0o644).catch(() => {});
  }
}

/** @param {string} out */
function describe(out) {
  return `\n--- output ---\n${out}`;
}

const analysisSummary = /1 sketch\(es\) could not be analyzed: bad/;

// 完了条件 1: 作品名と原因を表示して exit 1
test('scan exits 1 and names the sketch and cause when index.html cannot be read', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'index.html'), 0o000);

    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze bad: (EACCES|EPERM)/);
    assert.match(result.stderr, /bad is not added to public\/sketches\.json/);
    assert.match(result.stderr, analysisSummary);
    assert.deepEqual(await readCatalog(root), [], 'a sketch that was never published must not be cataloged');
    assert.equal(await exists(join(root, 'public', 'sketches', 'bad')), false, 'nothing is copied for the failed sketch');
  });
});

test('scan exits 1 when the sketch directory itself cannot be entered', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(bad, 0o000);

    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze bad: (EACCES|EPERM)/);
    assert.match(result.stderr, analysisSummary);
    assert.deepEqual(await readCatalog(root), []);
  });
});

test('dropcaster scan (CLI) exits 1 and shows the sketch and cause when index.html cannot be read', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'index.html'), 0o000);

    const result = await run(root, ['--no-previews'], { cli: true });
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 1, `CLI must fail with exit code 1${describe(output)}`);
    assert.match(output, /Failed to analyze bad: (EACCES|EPERM)/);
    assert.match(output, analysisSummary);
    assert.doesNotMatch(output, /Error: Scan failed|at ChildProcess|node:internal/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

// 完了条件 2: 前回載っていて、配信できるコピーが残っていれば前回の項目を残す
test('a previously published sketch keeps its catalog entry and public copy when its analysis fails', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad-v1');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
    const before = (await readCatalog(root)).find((s) => s.id === 'bad');
    assert.equal(before.title, 'bad-v1');

    await chmod(join(bad, 'index.html'), 0o000);
    const second = await run(root, []);
    assert.equal(second.code, 1, `scan must fail with exit code 1${describe(second.stderr)}`);
    assert.match(second.stderr, /Failed to analyze bad: (EACCES|EPERM)/);
    assert.match(second.stderr, /Keeping the previously published copy and catalog entry of bad/);

    const catalog = await readCatalog(root);
    assert.deepEqual(catalog.map((s) => s.id).sort(), ['bad', 'good']);
    assert.deepEqual(catalog.find((s) => s.id === 'bad'), before, 'old catalog entry is kept as is');
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'index.html'), 'utf-8'), htmlOf('bad-v1'));
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'data.txt'), 'utf-8'), 'data of bad-v1');
  });
});

test('a previous catalog entry is not kept when no servable public copy is left', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    await rm(join(root, 'public', 'sketches', 'bad', 'index.html'));
    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.doesNotMatch(result.stderr, /Keeping the previously published copy/);
    assert.match(result.stderr, /bad is not added to public\/sketches\.json/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

test('--reset: a cataloged sketch whose public copy was removed and whose analysis fails is dropped', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, ['--reset']);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, analysisSummary);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good'],
      'the old entry would point at a public copy that --reset removed');
  });
});

test('after the cause is fixed, a rescan succeeds and catalogs the current content', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'index.html'), 0o000);
    const failed = await run(root, []);
    assert.equal(failed.code, 1, `scan must fail with exit code 1${describe(failed.stderr)}`);

    await chmod(join(bad, 'index.html'), 0o644);
    const fixed = await run(root, []);
    assert.equal(fixed.code, 0, `rescan failed${describe(fixed.stderr)}`);
    assert.doesNotMatch(fixed.stderr, /could not be analyzed/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['bad']);
    assert.equal(await readFile(join(root, 'public', 'sketches', 'bad', 'index.html'), 'utf-8'), htmlOf('bad'));
  });
});

// 完了条件 3: --sketch で 1 件だけ scan したときも同じ扱い
test('--sketch: an analysis failure exits 1 and keeps the previous entry while a servable copy exists', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
    const before = await readCatalog(root);

    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, ['--sketch', 'bad']);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze bad: (EACCES|EPERM)/);
    assert.match(result.stderr, /Keeping the previously published copy and catalog entry of bad/);
    assert.match(result.stderr, analysisSummary);
    assert.deepEqual(await readCatalog(root), before, 'the merged catalog is unchanged');
  });
});

test('--sketch: a cataloged sketch without a servable public copy is removed from the catalog when its analysis fails', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
    const goodBefore = (await readCatalog(root)).find((s) => s.id === 'good');

    await rm(join(root, 'public', 'sketches', 'bad'), { recursive: true });
    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, ['--sketch', 'bad']);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /bad is not added to public\/sketches\.json/);
    assert.deepEqual(await readCatalog(root), [goodBefore],
      'the merged catalog must not keep an entry whose public copy is gone');
  });
});

test('--sketch: a new sketch whose analysis fails is not merged into the catalog', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
    const before = await readCatalog(root);

    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, ['--sketch', 'bad']);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, analysisSummary);
    assert.deepEqual(await readCatalog(root), before);
  });
});

// 完了条件 4: index.html が無いディレクトリは警告して飛ばし、失敗に数えない
test('a directory without index.html is skipped with a warning and is not counted as a failure', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    await mkdir(join(root, 'sketches', 'empty'), { recursive: true });
    await writeFile(join(root, 'sketches', 'empty', 'notes.txt'), 'work in progress', 'utf-8');
    // index.html という名前のディレクトリも「index.html が無い」扱い
    await mkdir(join(root, 'sketches', 'dir-entry', 'index.html'), { recursive: true });

    const result = await run(root, []);
    assert.equal(result.code, 0, `a directory without index.html must not fail the scan${describe(result.stderr)}`);
    assert.match(result.stderr, /Warning: empty has no index\.html, skipping/);
    assert.match(result.stderr, /Warning: dir-entry has no index\.html, skipping/);
    assert.doesNotMatch(result.stderr, /could not be analyzed|Failed to analyze/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);

    const single = await run(root, ['--sketch', 'empty']);
    assert.equal(single.code, 0, `--sketch on a directory without index.html must not fail${describe(single.stderr)}`);
    assert.match(single.stderr, /Warning: empty has no index\.html, skipping/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

// 完了条件 5: ほかの作品の結果は変わらない
test('other sketches get the same catalog entries and public copies as without the failing sketch', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'alpha', 'alpha');
    await writeSketch(root, 'zeta', 'zeta');
    const baseline = await run(root, []);
    assert.equal(baseline.code, 0, `baseline scan failed${describe(baseline.stderr)}`);
    const expected = await readCatalog(root);
    assert.deepEqual(expected.map((s) => s.id), ['alpha', 'zeta']);

    // 走査順で 2 件のあいだに入る作品を失敗させる
    const bad = await writeSketch(root, 'bad', 'bad');
    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, ['--force-regenerate']);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /📁 Copied alpha to public directory/);
    assert.match(result.stderr, /📁 Copied zeta to public directory/);
    assert.match(result.stderr, /📋 Scanned 2 sketch\(es\)/);
    assert.deepEqual(await readCatalog(root), expected);
    assert.deepEqual((await readdir(join(root, 'public', 'sketches'))).sort(), ['alpha', 'zeta']);
    assert.equal(await readFile(join(root, 'public', 'sketches', 'zeta', 'index.html'), 'utf-8'), htmlOf('zeta'));
  });
});

// ファイルに書かない経路 (stdout に JSON) でも、JSON は出したうえで終了コードに反映する
test('without --write-file, the catalog JSON still goes to stdout and the exit code is 1', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
    const before = await readCatalog(root);

    await chmod(join(bad, 'index.html'), 0o000);
    const result = await run(root, [], { writeFile: false });
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, analysisSummary);
    assert.deepEqual(JSON.parse(result.stdout), before, 'stdout carries only the JSON, with the previous entry kept');
    assert.deepEqual(await readCatalog(root), before, 'public/sketches.json is not rewritten');
  });
});
