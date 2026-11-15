import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, stat, utimes } from 'node:fs/promises';
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
 * @typedef {{ sketch: SketchFixture, assets?: Record<string, { body?: string, status?: number }>, failWrite?: string, failRename?: string, removeStagingAtAsset?: number }} Scenario
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
        DC_FAIL_RENAME_FROM: scenario.failRename ?? '',
        DC_REMOVE_STAGING_AT_ASSET: String(scenario.removeStagingAtAsset ?? ''),
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

const OLD_OP_META = JSON.stringify({ visualID: ID, title: 'old version' });

/**
 * 既存の (旧版の) 作品を置く。手で置いたファイルを含める
 * @param {string} root
 * @param {{ opMeta?: boolean }} [options] opMeta: 以前の fetch で取り込んだ作品として _op-meta.json を置く
 */
async function writeOldSketch(root, { opMeta = false } = {}) {
  const dir = join(root, 'sketches', `sketch${ID}`);
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>old version</title>', 'utf-8');
  await writeFile(join(dir, 'mySketch.js'), '// old version', 'utf-8');
  await writeFile(join(dir, 'assets', 'old.png'), 'PNG old', 'utf-8');
  if (opMeta) await writeFile(join(dir, '_op-meta.json'), OLD_OP_META, 'utf-8');
  return dir;
}

/**
 * @param {string} dir
 * @param {{ opMeta?: boolean, previous?: boolean }} [options] previous: 退避した旧版 (印のファイルを除いて比べる)
 */
async function assertOldSketchIntact(dir, { opMeta = false, previous = false } = {}) {
  assert.equal(await readFile(join(dir, 'index.html'), 'utf-8'), '<!doctype html><title>old version</title>');
  assert.equal(await readFile(join(dir, 'mySketch.js'), 'utf-8'), '// old version');
  assert.equal(await readFile(join(dir, 'assets', 'old.png'), 'utf-8'), 'PNG old');
  if (opMeta) assert.equal(await readFile(join(dir, '_op-meta.json'), 'utf-8'), OLD_OP_META);
  const entries = (await readdir(dir)).filter((name) => !(previous && name === '.dc-replacement.json')).sort();
  assert.deepEqual(entries, opMeta
    ? ['_op-meta.json', 'assets', 'index.html', 'mySketch.js']
    : ['assets', 'index.html', 'mySketch.js']);
}

/**
 * ディレクトリとその中身の更新時刻を過去にずらす (中断した fetch が前に残した作業用ディレクトリ)
 * @param {string} path
 * @param {Date} time
 */
async function age(path, time) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) await age(join(path, entry.name), time);
  await utimes(path, time, time);
}

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

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
    assert.match(result.output, /next fetch/, 'the user is told that a later fetch removes it');

    // 差し替え済みの印があるので、消せるようになれば次の fetch の開始時に片付く
    await chmod(join(root, 'sketches', residue[0], 'locked'), 0o755);
    const next = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(next.code, 0, describe(next.output));
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

// 反証で見つかった点: アセットの失敗・空の code・sketches/ の残骸・旧版を戻せなかったときの表示

const assetUnavailable = { [ASSET_URL]: { status: 503 } };
const escapedAssetUrl = ASSET_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('--overwrite keeps the existing sketch when an asset download fails (HTTP 503)', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: p5Code }, assets: assetUnavailable });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, new RegExp(`${escapedAssetUrl}: HTTP 503`));
    assert.match(result.output, /left unchanged/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('--overwrite keeps the existing sketch when writing an asset fails, and names the final path', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);

    const result = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: p5Code }, failWrite: 'tex.png' });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, /ENOSPC/);
    assert.match(result.output, /sketches\/sketch123\/assets\/user1\/visual123\/habc\/tex\.png/,
      `the message must name the sketch path${describe(result.output)}`);
    assert.doesNotMatch(result.output, /\.dc-staging-/, 'the staging path is an implementation detail');
    assert.match(result.output, /left unchanged/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('a new fetch keeps going when assets fail, leaving the CDN URL (HTTP 503 and ENOSPC)', async () => {
  await withTempProject(async (root) => {
    const dir = join(root, 'sketches', `sketch${ID}`);
    const unavailable = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code }, assets: assetUnavailable });
    assert.equal(unavailable.code, 0, describe(unavailable.output));
    assert.match(unavailable.output, /HTTP 503/);
    assert.match(await readFile(join(dir, 'mySketch.js'), 'utf-8'), new RegExp(`'${escapedAssetUrl}'`));
    await rm(dir, { recursive: true });

    const noSpace = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code }, failWrite: 'tex.png' });
    assert.equal(noSpace.code, 0, describe(noSpace.output));
    assert.match(noSpace.output, /ENOSPC/);
    assert.doesNotMatch(noSpace.output, /\.dc-staging-/, 'the warning must name the sketch path, not the staging path');
    assert.match(await readFile(join(dir, 'mySketch.js'), 'utf-8'), new RegExp(`'${escapedAssetUrl}'`));
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('a sketch without code tabs is rejected before anything is written (new and --overwrite)', async () => {
  await withTempProject(async (root) => {
    const created = await runFetch(root, [], { sketch: { meta: p5Meta, code: [] } });
    assert.equal(created.code, 1, describe(created.output));
    assert.match(created.output, /has no code/);
    assert.equal(await exists(join(root, 'sketches', `sketch${ID}`)), false);

    const dir = await writeOldSketch(root);
    const overwritten = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: [] } });
    assert.equal(overwritten.code, 1, describe(overwritten.output));
    assert.match(overwritten.output, /has no code/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('a sketch whose tabs are all empty is rejected like one without tabs (new and --overwrite)', async () => {
  await withTempProject(async (root) => {
    const emptyTabs = [
      { orderID: 0, title: 'mySketch', code: '' },
      { orderID: 1, title: 'helpers', code: null },
      { orderID: 2, title: 'blank', code: '  \n' },
    ];
    const created = await runFetch(root, [], { sketch: { meta: p5Meta, code: emptyTabs } });
    assert.equal(created.code, 1, describe(created.output));
    assert.match(created.output, /has no code/);
    assert.equal(await exists(join(root, 'sketches', `sketch${ID}`)), false);

    const dir = await writeOldSketch(root);
    const overwritten = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: emptyTabs } });
    assert.equal(overwritten.code, 1, describe(overwritten.output));
    assert.match(overwritten.output, /has no code/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});

test('fetch removes old staging and replaced old versions in sketches/, but keeps anything that may be the only copy', async () => {
  await withTempProject(async (root) => {
    const sketches = join(root, 'sketches');
    /** @param {string} name @param {string} reason @param {string} [target] */
    const marker = (name, reason, target = 'sketch456') => JSON.stringify({ previous: name, target, reason });
    const oldStaging = join(sketches, '.dc-staging-0123456789abcdef');
    // 並行して走っている別の fetch の staging (更新されたばかり)
    const activeStaging = join(sketches, '.dc-staging-fedcba9876543210');
    const replaced = join(sketches, '.dc-previous-aaaaaaaaaaaaaaaa');
    const notRestored = join(sketches, '.dc-previous-bbbbbbbbbbbbbbbb');
    const unmarked = join(sketches, '.dc-previous-cccccccccccccccc');
    const staleMarker = join(sketches, '.dc-previous-dddddddddddddddd');
    const userDot = join(sketches, '.notes');
    for (const dir of [oldStaging, activeStaging, replaced, notRestored, unmarked, staleMarker, userDot]) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(join(oldStaging, 'index.html'), 'half written', 'utf-8');
    await age(oldStaging, TWO_HOURS_AGO);
    await writeFile(join(activeStaging, 'index.html'), 'being written', 'utf-8');
    await writeFile(join(replaced, '.dc-replacement.json'), marker('.dc-previous-aaaaaaaaaaaaaaaa', 'replaced'), 'utf-8');
    await writeFile(join(notRestored, '.dc-replacement.json'),
      marker('.dc-previous-bbbbbbbbbbbbbbbb', 'not-restored', 'sketch789'), 'utf-8');
    await writeFile(join(notRestored, 'index.html'), 'only copy', 'utf-8');
    // 印が無い旧版は、差し替えの途中で止まった唯一の版かもしれない。_op-meta.json の作品が今あっても消さない
    await mkdir(join(sketches, 'sketch456'));
    await writeFile(join(unmarked, '_op-meta.json'), JSON.stringify({ visualID: '456' }), 'utf-8');
    // 別の退避で書かれた印 (利用者が旧版を戻した後、また退避された) は信用しない
    await writeFile(join(staleMarker, '.dc-replacement.json'), marker('.dc-previous-0000000000000000', 'replaced'), 'utf-8');
    await writeFile(join(staleMarker, 'index.html'), 'stale marker', 'utf-8');

    const result = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(result.code, 0, describe(result.output));
    assert.equal(await exists(oldStaging), false, 'staging left by an interrupted fetch long ago is removed');
    assert.equal(await readFile(join(activeStaging, 'index.html'), 'utf-8'), 'being written',
      'a recently updated staging may belong to a fetch that is still running');
    assert.equal(await exists(replaced), false, 'an old version whose replacement completed is removed');
    assert.equal(await readFile(join(notRestored, 'index.html'), 'utf-8'), 'only copy');
    assert.equal(await readFile(join(unmarked, '_op-meta.json'), 'utf-8'), JSON.stringify({ visualID: '456' }));
    assert.equal(await readFile(join(staleMarker, 'index.html'), 'utf-8'), 'stale marker');
    assert.ok(await exists(userDot), 'user dot directories are not touched');
    assert.match(result.output, /\S*\.dc-previous-bbbbbbbbbbbbbbbb could not be moved back to \S*sketch789/);
    assert.match(result.output, /\S*\.dc-previous-cccccccccccccccc/);
    assert.match(result.output, /\S*\.dc-previous-dddddddddddddddd/);
  });
});

test('fetch warns and continues when a leftover work directory cannot be removed', { skip: permissionSkip }, async () => {
  await withTempProject(async (root) => {
    const staging = join(root, 'sketches', '.dc-staging-0123456789abcdef');
    await mkdir(join(staging, 'locked'), { recursive: true });
    await writeFile(join(staging, 'locked', 'file.txt'), 'x', 'utf-8');
    await age(staging, TWO_HOURS_AGO);
    await chmod(join(staging, 'locked'), 0o555);

    const result = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(result.code, 0, describe(result.output));
    assert.match(result.output, /could not remove leftover \S*\.dc-staging-0123456789abcdef/);
    assert.ok(await exists(join(root, 'sketches', `sketch${ID}`, 'index.html')));
  });
});

test('when the old version cannot be put back after a failed swap, fetch names where it is and later fetches keep it', async () => {
  await withTempProject(async (root) => {
    // 以前の fetch で取り込んだ作品 (_op-meta.json がある)
    const dir = await writeOldSketch(root, { opMeta: true });

    // staging を所定の名前へ移すのも、退避した旧版を戻すのも失敗させる
    const result = await runFetch(root, ['--overwrite'], {
      sketch: { meta: p5Meta, code: p5Code },
      failRename: '^\\.dc-(staging|previous)-',
    });
    assert.equal(result.code, 1, describe(result.output));
    assert.doesNotMatch(result.output, /left unchanged/, 'the old version is no longer at its place');
    const residue = await readdir(join(root, 'sketches'));
    assert.equal(residue.length, 1, `expected the old version only: ${residue.join(', ')}`);
    assert.match(residue[0], /^\.dc-previous-[0-9a-f]{16}$/);
    assert.match(result.output, new RegExp(residue[0]), `the message must name where the old version is${describe(result.output)}`);
    assert.equal(await exists(dir), false);
    const previous = join(root, 'sketches', residue[0]);
    await assertOldSketchIntact(previous, { opMeta: true, previous: true });

    // 次の fetch (ここでは検証で失敗するもの) の開始時の掃除で、唯一の旧版を消さない
    const next = await runFetch(root, [], { sketch: { meta: p5Meta, code: [] } });
    assert.equal(next.code, 1, describe(next.output));
    await assertOldSketchIntact(previous, { opMeta: true, previous: true });

    // 同じ作品を取り込み直して sketch123 ができても、戻せなかった旧版は置き換え済みとみなさない
    const refetched = await runFetch(root, [], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(refetched.code, 0, describe(refetched.output));
    const later = await runFetch(root, ['--overwrite'], { sketch: { meta: p5Meta, code: p5Code } });
    assert.equal(later.code, 0, describe(later.output));
    assert.match(later.output, new RegExp(`${residue[0]} could not be moved back`), describe(later.output));
    await assertOldSketchIntact(previous, { opMeta: true, previous: true });
  });
});

// 反証で見つかった点: 並行して走る別の fetch が、開始時の掃除で書き出し中の staging を消した場合

const SECOND_ASSET_URL = ASSET_URL.replace('tex.png', 'tex2.png');
const twoAssets = { [ASSET_URL]: { body: 'PNG new' }, [SECOND_ASSET_URL]: { body: 'PNG new 2' } };
const p5CodeWithTwoAssets = [
  { orderID: 0, title: 'mySketch', code: `loadImage('${ASSET_URL}'); loadImage('${SECOND_ASSET_URL}'); // new version` },
];

test('a new fetch fails, without leaving a sketch, when its staging is removed while writing', async () => {
  await withTempProject(async (root) => {
    const result = await runFetch(root, [], {
      sketch: { meta: p5Meta, code: p5CodeWithTwoAssets }, assets: twoAssets, removeStagingAtAsset: 2,
    });
    assert.equal(result.code, 1, `a sketch that refers to missing local assets must not be written${describe(result.output)}`);
    assert.match(result.output, /assets\/user1\/visual123\/habc\/tex\.png/, `the missing file is named${describe(result.output)}`);
    assert.equal(await exists(join(root, 'sketches', `sketch${ID}`)), false);
    await assertSketchesDirHolds(root, []);
  });
});

test('--overwrite keeps the existing sketch when its staging is removed while writing', async () => {
  await withTempProject(async (root) => {
    const dir = await writeOldSketch(root);
    const result = await runFetch(root, ['--overwrite'], {
      sketch: { meta: p5Meta, code: p5CodeWithTwoAssets }, assets: twoAssets, removeStagingAtAsset: 2,
    });
    assert.equal(result.code, 1, describe(result.output));
    assert.match(result.output, /left unchanged/);
    await assertOldSketchIntact(dir);
    await assertSketchesDirHolds(root, [`sketch${ID}`]);
  });
});
