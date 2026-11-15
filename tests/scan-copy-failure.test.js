import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, utimes, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyPublicFiles } from '../src/cli/utils/files.js';

// #174: 作品のコピーに失敗した scan が成功終了し、配信できない作品をカタログに載せていた。
// scan-sketches.js は module-level で project root を束縛するため、子プロセスで実行する。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = join(repoRoot, 'src/core/scan-sketches.js');
const cliEntry = join(repoRoot, 'src/cli/index.js');
// ファイルシステムの失敗を起こすスタブ (DC_FAIL_RENAME_FROM など)。fetch のテストと共用
const stubModule = join(repoRoot, 'tests/fixtures/op-fetch-stub.mjs');

// 読めないファイルでコピーを途中で失敗させる。root は権限を無視するので確かめられない。
const cannotUsePermissions = process.platform === 'win32' || process.getuid?.() === 0;
const permissionSkip = cannotUsePermissions ? 'file permissions are not enforced for this user / platform' : false;

/**
 * @param {string} projectRoot
 * @param {string[]} args
 * @param {{ cli?: boolean, failRename?: string }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function run(projectRoot, args, { cli = false, failRename } = {}) {
  return new Promise((resolve, reject) => {
    const script = cli ? [cliEntry, 'scan', ...args] : [scanScript, '--write-file', ...args];
    const command = failRename ? ['--import', stubModule, ...script] : script;
    const child = spawn(process.execPath, command, {
      cwd: projectRoot,
      env: {
        ...process.env,
        DROPCASTER_PROJECT_ROOT: projectRoot,
        DROPCASTER_LANG: 'en',
        // プレビュー生成 (--reset が有効にする) を環境に依らず省く: Chromium が見つからない状態にする
        PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, 'no-browsers'),
        DC_FAIL_RENAME_FROM: failRename ?? '',
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
    // 読めなくしたファイル・書けなくしたディレクトリが残っていても後始末できるよう、権限を戻してから消す
    await chmod(join(root, 'sketches', 'bad', 'data.txt'), 0o644).catch(() => {});
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
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 1, `CLI must fail with exit code 1${describe(output)}`);
    assert.match(output, /ready/);
    assert.match(output, /ENOTDIR/);
    // 失敗は日常的な経路なので、Node の未処理 rejection のスタックを出さない
    assert.doesNotMatch(output, /Error: Scan failed|at ChildProcess|node:internal/);
    assert.equal(output.match(/📋 Scanned/g)?.length, 1, `the summary line must appear once${describe(output)}`);
    // 子プロセスの警告は進捗の表示で出し、失敗時の詳細では繰り返さない
    assert.equal(output.match(/Warning: Failed to cleanup removed sketches/g)?.length, 1,
      `the warning must appear once${describe(output)}`);
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

// 「最新」とみなすのは public 側が配信できるコピー (ディレクトリで index.html がある) のときだけ
test('a regular file at public/sketches/<name> newer than the sketch is replaced, not treated as up to date', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'ready', 'ready');
    await mkdir(join(root, 'public', 'sketches'), { recursive: true });
    const stray = join(root, 'public', 'sketches', 'ready');
    await writeFile(stray, 'not a sketch', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    await utimes(stray, future, future);

    const result = await run(root, []);
    assert.equal(result.code, 0, describe(result.stderr));
    assert.doesNotMatch(result.stderr, /ready is up to date/);
    assert.equal(await readFile(join(stray, 'index.html'), 'utf-8'), '<!doctype html><title>ready</title><canvas></canvas>');
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['ready']);
  });
});

test('a newer leftover directory without index.html is recopied, not treated as up to date', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'ready', 'ready');
    // 修正前の rm → cp が途中で失敗したときに残った残骸と同じ形
    const leftover = join(root, 'public', 'sketches', 'ready');
    await mkdir(leftover, { recursive: true });
    await writeFile(join(leftover, 'data.txt'), 'data of ready', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(leftover, 'data.txt'), future, future);
    await utimes(leftover, future, future);

    const result = await run(root, []);
    assert.equal(result.code, 0, describe(result.stderr));
    assert.doesNotMatch(result.stderr, /ready is up to date/);
    assert.equal(await readFile(join(leftover, 'index.html'), 'utf-8'), '<!doctype html><title>ready</title><canvas></canvas>');
  });
});

test('a previous catalog entry is not kept when the public copy left behind has no index.html', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    await rm(join(root, 'public', 'sketches', 'bad', 'index.html'));
    await chmod(join(bad, 'data.txt'), 0o000);
    const result = await run(root, []);
    assert.notEqual(result.code, 0, `scan must fail${describe(result.stderr)}`);
    assert.doesNotMatch(result.stderr, /Keeping the previously published copy/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

test('when only removing the previous copy fails, the update is published with a visible warning and the leftover is retried by later scans', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const ready = await writeSketch(root, 'ready', 'ready-v1');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    // 旧版の中に書き込めないディレクトリを置き、差し替え後の旧版の削除だけを失敗させる
    const locked = join(root, 'public', 'sketches', 'ready', 'locked');
    await mkdir(locked);
    await writeFile(join(locked, 'old.txt'), 'old', 'utf-8');
    await chmod(locked, 0o555);
    await writeFile(join(ready, 'index.html'), '<!doctype html><title>ready-v2</title><canvas></canvas>', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(ready, 'index.html'), future, future);

    // 既定の dropcaster scan (進捗だけを拾う表示) でも警告が利用者に見える
    const second = await run(root, ['--no-previews'], { cli: true });
    const secondOutput = second.stdout + second.stderr;
    assert.equal(second.code, 0, `the new copy is in place, so the scan succeeds${describe(secondOutput)}`);
    assert.match(secondOutput, /could not remove the previous copy of ready at \S*\.dc-previous-[0-9a-f]{16}/);
    assert.doesNotMatch(secondOutput, /Keeping the previously published copy/);
    // title は既存の項目から引き継がれる (既存の仕様) ので、今回の解析結果かは lastModified で見る
    assert.equal((await readCatalog(root)).find((s) => s.id === 'ready')?.lastModified, future.toISOString(),
      'the catalog entry must come from this scan, not the previous one');
    assert.equal(await readFile(join(root, 'public', 'sketches', 'ready', 'index.html'), 'utf-8'),
      '<!doctype html><title>ready-v2</title><canvas></canvas>');
    const publicEntries = await readdir(join(root, 'public', 'sketches'));
    const residue = publicEntries.filter((name) => name !== 'ready');
    assert.equal(residue.length, 1, `expected one leftover: ${publicEntries.join(', ')}`);
    assert.match(residue[0], /^\.dc-previous-[0-9a-f]{16}$/);

    // 消せないあいだは、次の scan が削除を試みて警告する (作品の削除としては扱わない)
    const third = await run(root, []);
    assert.equal(third.code, 0, describe(third.stderr));
    assert.doesNotMatch(third.stderr, /Removed deleted sketch/);
    assert.match(third.stderr, new RegExp(`Warning: could not remove leftover ${residue[0]}`));
    assert.ok(await exists(join(root, 'public', 'sketches', residue[0])));

    // build は残骸を dist に持ち込まないが、利用者のドットディレクトリはそのまま運ぶ
    await mkdir(join(root, 'public', '.well-known'), { recursive: true });
    await writeFile(join(root, 'public', '.well-known', 'security.txt'), 'contact', 'utf-8');
    await copyPublicFiles(join(root, 'public'), join(root, 'dist'));
    assert.deepEqual(await readdir(join(root, 'dist', 'sketches')), ['ready']);
    assert.equal(await readFile(join(root, 'dist', '.well-known', 'security.txt'), 'utf-8'), 'contact');

    // 消せるようになれば、次の全件 scan で片付く
    await chmod(join(root, 'public', 'sketches', residue[0], 'locked'), 0o755);
    const fourth = await run(root, []);
    assert.equal(fourth.code, 0, describe(fourth.stderr));
    assert.deepEqual(await readdir(join(root, 'public', 'sketches')), ['ready']);
  });
});

test('when the previous copy cannot be put back after a failed swap, scan names where it is and does not claim to keep it', async () => {
  await withTempProject(async (root) => {
    const ready = await writeSketch(root, 'ready', 'ready-v1');
    const first = await run(root, []);
    assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);

    await writeFile(join(ready, 'index.html'), '<!doctype html><title>ready-v2</title><canvas></canvas>', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(ready, 'index.html'), future, future);

    // staging を所定の名前へ移すのも、退避した旧版を戻すのも失敗させる
    const second = await run(root, [], { failRename: '^\\.dc-(staging|previous)-' });
    assert.notEqual(second.code, 0, `scan must fail${describe(second.stderr)}`);
    // 旧版の場所を伝える。public 側は sketches/ から作り直せるので、同じ全件 scan の掃除で消えてよい
    assert.match(second.stderr, /Failed to copy ready[^\n]*\.dc-previous-[0-9a-f]{16}/,
      `the message must name where the previous copy is${describe(second.stderr)}`);
    assert.doesNotMatch(second.stderr, /Keeping the previously published copy/);
    assert.match(second.stderr, /ready is not added to public\/sketches\.json/);
    assert.deepEqual(await readCatalog(root), []);

    // 原因が無くなれば、次の全件 scan でコピーし直し、public 側の残骸 (再生成できる) も片付ける
    const third = await run(root, []);
    assert.equal(third.code, 0, describe(third.stderr));
    assert.deepEqual(await readdir(join(root, 'public', 'sketches')), ['ready']);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['ready']);
  });
});

test('replacement work directories in sketches/ are not cataloged as sketches', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'ready', 'ready');
    await writeSketch(root, '.dc-staging-0123456789abcdef', 'staging');

    const result = await run(root, []);
    assert.equal(result.code, 0, describe(result.stderr));
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['ready']);
    assert.deepEqual(await readdir(join(root, 'public', 'sketches')), ['ready']);
  });
});

test('a full scan removes replacement work directories left in public/sketches without treating them as sketches', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'ready', 'ready');
    const work = join(root, 'public', 'sketches', '.dc-staging-0123456789abcdef');
    await mkdir(work, { recursive: true });
    await writeFile(join(work, 'index.html'), 'in progress', 'utf-8');

    const result = await run(root, []);
    assert.equal(result.code, 0, describe(result.stderr));
    assert.doesNotMatch(result.stderr, /Removed deleted sketch: \.dc-/);
    assert.equal(await exists(work), false, 'the leftover must be removed');
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['ready']);
  });
});

// 修正前の rm → cp が途中で失敗し、index.html だけ先に入った残骸も「最新」とみなさない
test('a newer copy that has index.html but misses other files of the sketch is recopied', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 's1', 's1');
    const partial = join(root, 'public', 'sketches', 's1');
    await mkdir(partial, { recursive: true });
    await writeFile(join(partial, 'index.html'), '<!doctype html><title>s1</title><canvas></canvas>', 'utf-8');
    const future = new Date(Date.now() + 60_000);
    await utimes(join(partial, 'index.html'), future, future);
    await utimes(partial, future, future);

    const result = await run(root, []);
    assert.equal(result.code, 0, describe(result.stderr));
    assert.doesNotMatch(result.stderr, /s1 is up to date/);
    assert.equal(await readFile(join(partial, 'data.txt'), 'utf-8'), 'data of s1');
  });
});

test('an unchanged rescan stays up to date with nested files and excluded metadata files', async () => {
  await withTempProject(async (root) => {
    const dir = await writeSketch(root, 'nested', 'nested');
    await mkdir(join(dir, 'assets', 'img'), { recursive: true });
    await writeFile(join(dir, 'assets', 'img', 'a.txt'), 'a', 'utf-8');
    // public へはコピーしないファイル (手動メタデータ) があっても「最新」の判定を崩さない
    await writeFile(join(dir, 'dropcaster.meta.json'), JSON.stringify({ title: 'Nested' }), 'utf-8');

    const first = await run(root, []);
    assert.equal(first.code, 0, describe(first.stderr));
    assert.equal(await exists(join(root, 'public', 'sketches', 'nested', 'dropcaster.meta.json')), false);
    const second = await run(root, []);
    assert.equal(second.code, 0, describe(second.stderr));
    assert.match(second.stderr, /✓ nested is up to date/);
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
