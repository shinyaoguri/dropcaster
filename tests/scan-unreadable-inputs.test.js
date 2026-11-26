import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// #275: 読めない・壊れた入力 (作品のメタデータ・リンク先の無い index.html・既存の sketches.json) を
// scan が「無い」として扱い、警告だけ (または何も言わず) で成功終了して、カタログの内容を黙って変えていた。
// また、全件 scan で index.html の無くなった作品の public のコピーが残り続けていた。
// scan-sketches.js は module-level で project root を束縛するため、子プロセスで実行する。

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanScript = join(repoRoot, 'src/core/scan-sketches.js');
const cliEntry = join(repoRoot, 'src/cli/index.js');

const cannotUsePermissions = process.platform === 'win32' || process.getuid?.() === 0;
const permissionSkip = cannotUsePermissions ? 'file permissions are not enforced for this user / platform' : false;
const symlinkSkip = process.platform === 'win32' ? 'creating a symlink needs extra privileges on Windows' : false;

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
  return dir;
}

const catalogPath = (/** @type {string} */ root) => join(root, 'public', 'sketches.json');

/** @param {string} root */
async function readCatalog(root) {
  return JSON.parse(await readFile(catalogPath(root), 'utf-8'));
}

/** @param {Array<{ id: string, [key: string]: any }>} list */
function byId(list) {
  return [...list].sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {string} path */
async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** @param {(root: string) => Promise<void>} fn */
async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dc-scan-unreadable-'));
  try {
    await fn(root);
  } finally {
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
    else if (!entry.isSymbolicLink()) await chmod(path, 0o644).catch(() => {});
  }
}

/** @param {string} out */
function describe(out) {
  return `\n--- output ---\n${out}`;
}

/**
 * 作品 a (手動メタデータあり)・b を公開済みのギャラリーを作り、最初のカタログを返す。
 * @param {string} root
 */
async function publishTwo(root) {
  const a = await writeSketch(root, 'a', 'A');
  await writeFile(join(a, 'dropcaster.meta.json'), JSON.stringify({ title: 'Manual A', tags: ['x', 'y'] }), 'utf-8');
  await writeSketch(root, 'b', 'B');
  const first = await run(root, []);
  assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
  const catalog = await readCatalog(root);
  const entryA = catalog.find((s) => s.id === 'a');
  assert.equal(entryA.title, 'Manual A', 'precondition: manual metadata is applied');
  assert.deepEqual(entryA.tags, ['x', 'y']);
  return catalog;
}

const fullAndSingle = [[], ['--sketch', 'a']];
/** @param {string[]} args */
const labelOf = (args) => (args.length > 0 ? args.join(' ') : 'full scan');

// 完了条件 1: 壊れた・読めないメタデータは解析の失敗 (前回の項目を残して exit 1、作品とファイルを表示)
/** @type {[string, (dir: string) => Promise<void>, RegExp][]} */
const brokenMetadataCases = [
  ['dropcaster.meta.json with broken JSON',
    (dir) => writeFile(join(dir, 'dropcaster.meta.json'), '{"title":"Manual A",', 'utf-8'),
    /Failed to analyze a: dropcaster\.meta\.json is not valid JSON/],
  ['dropcaster.meta.json that is not an object',
    (dir) => writeFile(join(dir, 'dropcaster.meta.json'), '["Manual A"]', 'utf-8'),
    /Failed to analyze a: dropcaster\.meta\.json must contain a JSON object/],
  ['dropcaster.meta.json that is a directory',
    async (dir) => {
      await rm(join(dir, 'dropcaster.meta.json'));
      await mkdir(join(dir, 'dropcaster.meta.json'));
    },
    /Failed to analyze a: Could not read dropcaster\.meta\.json: EISDIR/],
  ['_op-meta.json with broken JSON',
    (dir) => writeFile(join(dir, '_op-meta.json'), '{ not json', 'utf-8'),
    /Failed to analyze a: _op-meta\.json is not valid JSON/],
];

for (const [label, breakIt, message] of brokenMetadataCases) {
  test(`${label}: the scan fails, names the sketch and file, and keeps the previous entry (full scan and --sketch)`, async () => {
    await withTempProject(async (root) => {
      const before = await publishTwo(root);
      await breakIt(join(root, 'sketches', 'a'));

      for (const args of fullAndSingle) {
        const result = await run(root, args);
        const name = labelOf(args);
        assert.equal(result.code, 1, `${name}: scan must fail with exit code 1${describe(result.stderr)}`);
        assert.match(result.stderr, message, name);
        assert.match(result.stderr, /Keeping the previously published copy and catalog entry of a/, name);
        assert.match(result.stderr, /1 sketch\(es\) could not be analyzed: a/, name);
        assert.deepEqual(byId(await readCatalog(root)), byId(before), `${name}: title / tags of a are not replaced`);
        assert.equal(await readFile(join(root, 'public', 'sketches', 'a', 'index.html'), 'utf-8'), htmlOf('A'), name);
      }
    });
  });
}

test('unreadable dropcaster.meta.json (permissions) fails the scan', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const before = await publishTwo(root);
    await chmod(join(root, 'sketches', 'a', 'dropcaster.meta.json'), 0o000);

    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze a: Could not read dropcaster\.meta\.json: (EACCES|EPERM)/);
    assert.deepEqual(byId(await readCatalog(root)), byId(before));
  });
});

test('dropcaster.meta.json that is a broken symlink fails the scan instead of being treated as absent', { skip: symlinkSkip }, async () => {
  await withTempProject(async (root) => {
    const before = await publishTwo(root);
    const metaPath = join(root, 'sketches', 'a', 'dropcaster.meta.json');
    await rm(metaPath);
    await symlink('nowhere.json', metaPath);

    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze a: Could not read dropcaster\.meta\.json: dropcaster\.meta\.json is a broken symbolic link \(target not found: nowhere\.json\)/);
    assert.deepEqual(byId(await readCatalog(root)), byId(before));
  });
});

test('a new sketch with broken metadata is not cataloged and the scan exits 1', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = await writeSketch(root, 'bad', 'bad');
    await writeFile(join(bad, 'dropcaster.meta.json'), '{', 'utf-8');

    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze bad: dropcaster\.meta\.json is not valid JSON/);
    assert.match(result.stderr, /bad is not added to public\/sketches\.json/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

test('sketches without metadata files still scan successfully', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'plain', 'Plain');
    const result = await run(root, []);
    assert.equal(result.code, 0, `scan failed${describe(result.stderr)}`);
    assert.doesNotMatch(result.stderr, /Failed to analyze|Warning: Could not load/);
    assert.deepEqual((await readCatalog(root)).map((s) => [s.id, s.title]), [['plain', 'Plain']]);
  });
});

test('after the metadata is fixed, a rescan succeeds and applies it', async () => {
  await withTempProject(async (root) => {
    await publishTwo(root);
    const metaPath = join(root, 'sketches', 'a', 'dropcaster.meta.json');
    await writeFile(metaPath, '{', 'utf-8');
    assert.equal((await run(root, [])).code, 1);

    await writeFile(metaPath, JSON.stringify({ title: 'Manual A2', tags: ['z'] }), 'utf-8');
    const fixed = await run(root, []);
    assert.equal(fixed.code, 0, `rescan failed${describe(fixed.stderr)}`);
    const entryA = (await readCatalog(root)).find((s) => s.id === 'a');
    assert.equal(entryA.title, 'Manual A2');
    assert.deepEqual(entryA.tags, ['z']);
  });
});

// 完了条件 2: リンク先の無い index.html は解析の失敗 (本当に無いディレクトリは従来どおり警告して飛ばす)
test('an index.html that is a broken symlink fails the scan and keeps the previous entry (full scan and --sketch)', { skip: symlinkSkip }, async () => {
  await withTempProject(async (root) => {
    const before = await publishTwo(root);
    const indexPath = join(root, 'sketches', 'a', 'index.html');
    await rm(indexPath);
    await symlink('nowhere.html', indexPath);

    for (const args of fullAndSingle) {
      const name = labelOf(args);
      const result = await run(root, args);
      assert.equal(result.code, 1, `${name}: scan must fail with exit code 1${describe(result.stderr)}`);
      assert.match(result.stderr, /Failed to analyze a: index\.html is a broken symbolic link \(target not found: nowhere\.html\)/, name);
      assert.doesNotMatch(result.stderr, /a has no index\.html/, name);
      assert.match(result.stderr, /Keeping the previously published copy and catalog entry of a/, name);
      assert.deepEqual(byId(await readCatalog(root)), byId(before), name);
      assert.equal(await readFile(join(root, 'public', 'sketches', 'a', 'index.html'), 'utf-8'), htmlOf('A'),
        `${name}: the public copy of the failed sketch is kept`);
    }
  });
});

test('a new sketch whose index.html is a broken symlink is not cataloged and the scan exits 1', { skip: symlinkSkip }, async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'good', 'good');
    const bad = join(root, 'sketches', 'bad');
    await mkdir(bad, { recursive: true });
    await symlink('nowhere.html', join(bad, 'index.html'));

    const result = await run(root, []);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Failed to analyze bad: index\.html is a broken symbolic link/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['good']);
  });
});

// 完了条件 3: 既存の sketches.json が読めない・壊れているときは、何も書かずに exit 1
/** @type {[string, (path: string) => Promise<void>, RegExp][]} */
const brokenCatalogCases = [
  ['truncated JSON', (path) => writeFile(path, '[{"id":"a"', 'utf-8'), /not valid JSON/],
  ['an empty file', (path) => writeFile(path, '', 'utf-8'), /not valid JSON/],
  ['a JSON object instead of an array', (path) => writeFile(path, '{"id":"a"}', 'utf-8'), /expected a JSON array of sketch entries/],
  ['an array with a non-object entry', (path) => writeFile(path, '[null]', 'utf-8'), /expected a JSON array of sketch entries/],
  ['a directory', async (path) => { await rm(path); await mkdir(path); }, /EISDIR/],
];

for (const [label, breakIt, reason] of brokenCatalogCases) {
  test(`public/sketches.json that is ${label}: the scan exits 1 without changing the catalog or public copies`, async () => {
    await withTempProject(async (root) => {
      await publishTwo(root);
      await breakIt(catalogPath(root));
      const catalogBefore = await stat(catalogPath(root)).then((s) => s.isFile() ? readFile(catalogPath(root), 'utf-8') : 'directory');
      // 新しい作品と、index.html を消した作品: どちらも今回の scan では public に触れないこと
      await writeSketch(root, 'c', 'C');
      await rm(join(root, 'sketches', 'b', 'index.html'));

      for (const args of [[], ['--sketch', 'c'], ['--reset']]) {
        const name = labelOf(args);
        const result = await run(root, args);
        assert.equal(result.code, 1, `${name}: scan must fail with exit code 1${describe(result.stderr)}`);
        assert.match(result.stderr, /Could not read public\/sketches\.json: /, name);
        assert.match(result.stderr, reason, name);
        assert.match(result.stderr, /Nothing was changed/, name);
        assert.doesNotMatch(result.stderr, /Wrote |Scanned |Error scanning sketches/, name);
        const catalogAfter = await stat(catalogPath(root)).then((s) => s.isFile() ? readFile(catalogPath(root), 'utf-8') : 'directory');
        assert.equal(catalogAfter, catalogBefore, `${name}: public/sketches.json is not rewritten`);
        assert.deepEqual((await readdir(join(root, 'public', 'sketches'))).sort(), ['a', 'b'], `${name}: public copies are untouched`);
      }

      const toStdout = await run(root, [], { writeFile: false });
      assert.equal(toStdout.code, 1, `stdout mode: scan must fail with exit code 1${describe(toStdout.stderr)}`);
      assert.equal(toStdout.stdout, '', 'stdout mode: no partial catalog JSON is printed');
    });
  });
}

test('public/sketches.json that is a broken symlink fails the scan instead of being treated as absent', { skip: symlinkSkip }, async () => {
  await withTempProject(async (root) => {
    await publishTwo(root);
    await rm(catalogPath(root));
    await symlink('nowhere.json', catalogPath(root));

    const result = await run(root, ['--sketch', 'a']);
    assert.equal(result.code, 1, `scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, /Could not read public\/sketches\.json: sketches\.json is a broken symbolic link \(target not found: nowhere\.json\)/);
    assert.equal(await exists(join(root, 'public', 'nowhere.json')), false, 'nothing is written through the link');
  });
});

test('dropcaster scan (CLI) exits 1 and shows why public/sketches.json could not be read', async () => {
  await withTempProject(async (root) => {
    await publishTwo(root);
    await writeFile(catalogPath(root), '[{"id":"a"', 'utf-8');

    const result = await run(root, ['--no-previews'], { cli: true });
    const output = result.stdout + result.stderr;
    assert.equal(result.code, 1, `CLI must fail with exit code 1${describe(output)}`);
    assert.match(output, /Could not read public\/sketches\.json: not valid JSON/);
    assert.match(output, /Nothing was changed/);
    assert.doesNotMatch(output, /Error: Scan failed|at ChildProcess|node:internal/);
    assert.equal(await readFile(catalogPath(root), 'utf-8'), '[{"id":"a"');
  });
});

test('a missing public/sketches.json is still created from scratch', async () => {
  await withTempProject(async (root) => {
    await writeSketch(root, 'a', 'A');
    assert.equal(await exists(catalogPath(root)), false);
    const result = await run(root, ['--sketch', 'a']);
    assert.equal(result.code, 0, `scan failed${describe(result.stderr)}`);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['a']);
  });
});

// 完了条件 4: 全件 scan では、index.html の無いディレクトリの公開コピーとプレビューも消す
test('a full scan removes the public copy and preview of a directory that no longer has index.html', async () => {
  await withTempProject(async (root) => {
    await publishTwo(root);
    await mkdir(join(root, 'public', 'previews'), { recursive: true });
    await writeFile(join(root, 'public', 'previews', 'b.gif'), 'GIF89a', 'utf-8');
    await writeFile(join(root, 'sketches', 'b', 'notes.txt'), 'work in progress', 'utf-8');
    await rm(join(root, 'sketches', 'b', 'index.html'));

    const result = await run(root, []);
    assert.equal(result.code, 0, `a directory without index.html must not fail the scan${describe(result.stderr)}`);
    assert.match(result.stderr, /Warning: b has no index\.html, skipping/);
    assert.deepEqual((await readCatalog(root)).map((s) => s.id), ['a']);
    assert.equal(await exists(join(root, 'public', 'sketches', 'b')), false, 'public copy of b is removed');
    assert.equal(await exists(join(root, 'public', 'previews', 'b.gif')), false, 'preview of b is removed');
    assert.equal(await exists(join(root, 'sketches', 'b', 'notes.txt')), true, 'the source directory is not touched');
    assert.equal(await readFile(join(root, 'public', 'sketches', 'a', 'index.html'), 'utf-8'), htmlOf('A'));
  });
});

// 反証で見つかった同じ根本原因: 作品の JS が読めないと、interactiveElements が黙って変わっていた
/**
 * 作品 b (直下の sketch.js でキーボード、<script src="js/main.js"> でタッチ) を a と一緒に公開する。
 * @param {string} root
 */
async function publishWithScripts(root) {
  await writeSketch(root, 'a', 'A');
  const b = join(root, 'sketches', 'b');
  await mkdir(join(b, 'js'), { recursive: true });
  await writeFile(join(b, 'index.html'),
    '<!doctype html><title>B</title><script src="sketch.js"></script><script src="js/main.js"></script><script src="missing.js"></script>', 'utf-8');
  await writeFile(join(b, 'sketch.js'), 'function keyPressed() {}', 'utf-8');
  await writeFile(join(b, 'js', 'main.js'), 'function touchStarted() {}', 'utf-8');
  const first = await run(root, []);
  assert.equal(first.code, 0, `initial scan failed${describe(first.stderr)}`);
  const catalog = await readCatalog(root);
  assert.deepEqual(catalog.find((s) => s.id === 'b').interactiveElements, ['キーボード', 'タッチ'],
    'precondition: both scripts are detected, and the missing script src is ignored');
  return { b, catalog };
}

/**
 * @param {string} root
 * @param {Array<{ id: string }>} before
 * @param {RegExp} message
 * @param {string[][]} [argsList]
 */
async function assertScriptFailure(root, before, message, argsList = [[], ['--sketch', 'b']]) {
  for (const args of argsList) {
    const name = args.length > 0 ? args.join(' ') : 'full scan';
    const result = await run(root, args);
    assert.equal(result.code, 1, `${name}: scan must fail with exit code 1${describe(result.stderr)}`);
    assert.match(result.stderr, message, name);
    assert.match(result.stderr, /Keeping the previously published copy and catalog entry of b/, name);
    assert.match(result.stderr, /1 sketch\(es\) could not be analyzed: b/, name);
    assert.deepEqual(byId(await readCatalog(root)), byId(before), `${name}: interactiveElements of b are not replaced`);
  }
}

test('a sketch script that is a broken symlink fails the scan and keeps the previous entry', { skip: symlinkSkip }, async () => {
  await withTempProject(async (root) => {
    const { b, catalog } = await publishWithScripts(root);
    await rm(join(b, 'sketch.js'));
    await symlink('nowhere.js', join(b, 'sketch.js'));
    await assertScriptFailure(root, catalog,
      /Failed to analyze b: Could not read sketch\.js: sketch\.js is a broken symbolic link \(target not found: nowhere\.js\)/);
  });
});

test('a script referenced by <script src> that is a broken symlink fails the scan', { skip: symlinkSkip }, async () => {
  await withTempProject(async (root) => {
    const { b, catalog } = await publishWithScripts(root);
    await rm(join(b, 'js', 'main.js'));
    await symlink('nowhere.js', join(b, 'js', 'main.js'));
    await assertScriptFailure(root, catalog, /Failed to analyze b: Could not read js\/main\.js: main\.js is a broken symbolic link/);
  });
});

test('an unreadable sketch script (permissions) fails the scan, for top-level and <script src> files', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const { b, catalog } = await publishWithScripts(root);
    await chmod(join(b, 'sketch.js'), 0o000);
    await assertScriptFailure(root, catalog, /Failed to analyze b: Could not read sketch\.js: (EACCES|EPERM)/);

    await chmod(join(b, 'sketch.js'), 0o644);
    await chmod(join(b, 'js', 'main.js'), 0o000);
    await assertScriptFailure(root, catalog, /Failed to analyze b: Could not read js\/main\.js: (EACCES|EPERM)/);
  });
});

test('a sketch directory that cannot be listed fails the scan', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const { b, catalog } = await publishWithScripts(root);
    // 一覧はできないが、名前の分かっているファイル (index.html) は開ける
    await chmod(b, 0o311);
    await assertScriptFailure(root, catalog, /Failed to analyze b: Could not list the sketch directory: (EACCES|EPERM)/, [[]]);
  });
});

test('script references that point at nothing readable as a file are still ignored', async () => {
  await withTempProject(async (root) => {
    const dir = await writeSketch(root, 'refs', 'refs');
    await writeFile(join(dir, 'index.html'),
      '<!doctype html><title>refs</title><script src="missing.js"></script><script src="lib"></script><script src="index.html/x.js"></script><script src="sketch.js?v=2"></script>', 'utf-8');
    await mkdir(join(dir, 'lib'));
    // .js で終わる名前のディレクトリはスクリプトではない
    await mkdir(join(dir, 'vendor.js'));
    await writeFile(join(dir, 'sketch.js'), 'function mousePressed() {}', 'utf-8');

    const result = await run(root, []);
    assert.equal(result.code, 0, `scan failed${describe(result.stderr)}`);
    assert.doesNotMatch(result.stderr, /Failed to analyze|Could not read/);
    assert.deepEqual((await readCatalog(root)).map((s) => [s.id, s.interactiveElements]), [['refs', ['マウス']]]);
  });
});

