// `dropcaster init` が既存プロジェクトのファイルを上書きしないことの回帰テスト (#166)。
// 実際の CLI を子プロセスで起動し、一時ディレクトリ上の結果と終了コードを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'index.js');

// init が書き出すテンプレートファイル (プロジェクトディレクトリからの相対パス)
const TEMPLATE_FILES = [
  'public/icon.svg',
  'dropcaster.config.js',
  'package.json',
  '.gitignore',
  'README.md',
  'sketches/sample-sketch/index.html',
  'sketches/sample-sketch/mySketch.js',
];

/** @param {import('node:test').TestContext} t */
function makeWorkspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dropcaster-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} cwd @param {string} name */
function runInit(cwd, name) {
  const result = spawnSync(process.execPath, [CLI, 'init', name], {
    cwd,
    env: { ...process.env, DROPCASTER_LANG: 'en', NO_COLOR: '1', FORCE_COLOR: '0' },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** @param {string} root @param {string} rel @param {string} content */
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}

/**
 * 利用者が置いた keep 以外のテンプレートファイルが 1 つも作られていないことを確かめる。
 * @param {string} project @param {string[]} keep
 */
function assertNothingWritten(project, keep) {
  for (const rel of TEMPLATE_FILES.filter((p) => !keep.includes(p))) {
    assert.equal(existsSync(join(project, rel)), false, `${rel} は書かれないはず`);
  }
}

test('既存の README と作品ソースがあれば、衝突を一覧して非 0 終了し、何も書かない', (t) => {
  const ws = makeWorkspace(t);
  const project = join(ws, 'exhibit');
  put(project, 'README.md', '# 自作の README\n');
  put(project, 'sketches/sample-sketch/mySketch.js', '// 自作の作品\n');

  const { status, output } = runInit(ws, 'exhibit');

  assert.notEqual(status, 0, output);
  assert.equal(readFileSync(join(project, 'README.md'), 'utf-8'), '# 自作の README\n');
  assert.equal(readFileSync(join(project, 'sketches/sample-sketch/mySketch.js'), 'utf-8'), '// 自作の作品\n');
  assert.match(output, /README\.md/);
  assert.match(output, /sketches\/sample-sketch\/mySketch\.js/);
  assertNothingWritten(project, ['README.md', 'sketches/sample-sketch/mySketch.js']);
});

test('最後に書く mySketch.js だけが衝突しても、前半の icon.svg などは書かれない', (t) => {
  const ws = makeWorkspace(t);
  const project = join(ws, 'exhibit');
  put(project, 'sketches/sample-sketch/mySketch.js', '// 自作の作品\n');

  const { status, output } = runInit(ws, 'exhibit');

  assert.notEqual(status, 0, output);
  assert.equal(readFileSync(join(project, 'sketches/sample-sketch/mySketch.js'), 'utf-8'), '// 自作の作品\n');
  assertNothingWritten(project, ['sketches/sample-sketch/mySketch.js']);
  // 作るのはファイルだけでなくディレクトリも含めて何もしない
  assert.equal(existsSync(join(project, 'public')), false);
});

test('init . でカレントディレクトリの package.json が衝突すれば、内容を保ったまま止まる', (t) => {
  const ws = makeWorkspace(t);
  const original = JSON.stringify({ name: 'mine', dependencies: { p5: '^1.0.0' } });
  put(ws, 'package.json', original);

  const { status, output } = runInit(ws, '.');

  assert.notEqual(status, 0, output);
  assert.equal(readFileSync(join(ws, 'package.json'), 'utf-8'), original);
  assert.match(output, /package\.json/);
  assertNothingWritten(ws, ['package.json']);
});

test('リンク先の無いシンボリックリンクも既存として扱い、リンクを辿って書かない', (t) => {
  const ws = makeWorkspace(t);
  const project = join(ws, 'exhibit');
  mkdirSync(project);
  symlinkSync(join(ws, 'outside.md'), join(project, 'README.md'));

  const { status, output } = runInit(ws, 'exhibit');

  assert.notEqual(status, 0, output);
  assert.equal(existsSync(join(ws, 'outside.md')), false);
  assert.match(output, /README\.md/);
  assertNothingWritten(project, ['README.md']);
});

test('途中のディレクトリのシンボリックリンクは利用者の意図として辿り、リンク先で衝突を検査する', (t) => {
  const ws = makeWorkspace(t);
  const shared = join(ws, 'shared-sketches');
  put(shared, 'sample-sketch/mySketch.js', '// 共有ディレクトリの作品\n');
  const project = join(ws, 'exhibit');
  mkdirSync(project);
  symlinkSync(shared, join(project, 'sketches'));

  const refused = runInit(ws, 'exhibit');

  assert.notEqual(refused.status, 0, refused.output);
  assert.match(refused.output, /sketches\/sample-sketch\/mySketch\.js/);
  assert.equal(readFileSync(join(shared, 'sample-sketch/mySketch.js'), 'utf-8'), '// 共有ディレクトリの作品\n');
  assertNothingWritten(project, ['sketches/sample-sketch/mySketch.js']);

  // 衝突が無くなれば、リンク先の共有ディレクトリにサンプル作品を書く
  rmSync(join(shared, 'sample-sketch'), { recursive: true });
  const created = runInit(ws, 'exhibit');

  assert.equal(created.status, 0, created.output);
  assert.equal(existsSync(join(shared, 'sample-sketch/mySketch.js')), true);
  assert.equal(existsSync(join(project, 'README.md')), true);
});

test('書き込み先の親 (public) が通常ファイルなら、それを残したまま非 0 終了し、何も書かない', (t) => {
  const ws = makeWorkspace(t);
  const project = join(ws, 'exhibit');
  put(project, 'public', 'これはディレクトリではない\n');

  const { status, output } = runInit(ws, 'exhibit');

  assert.notEqual(status, 0, output);
  assert.equal(readFileSync(join(project, 'public'), 'utf-8'), 'これはディレクトリではない\n');
  assertNothingWritten(project, TEMPLATE_FILES.filter((p) => p.startsWith('public/')));
  // 衝突の検査で止まり、sketches/ などのディレクトリも作らない
  assert.equal(existsSync(join(project, 'sketches')), false);
});

test('存在しないディレクトリへの初期化は 7 件を生成して成功する', (t) => {
  const ws = makeWorkspace(t);

  const { status, output } = runInit(ws, 'gallery');

  assert.equal(status, 0, output);
  for (const rel of TEMPLATE_FILES) {
    assert.equal(existsSync(join(ws, 'gallery', rel)), true, `${rel} が生成されるはず`);
  }
  assert.equal(existsSync(join(ws, 'gallery/public/sketches')), true);
  assert.equal(existsSync(join(ws, 'gallery/public/previews')), true);
});

test('空のディレクトリへの初期化は 7 件を生成して成功する', (t) => {
  const ws = makeWorkspace(t);
  mkdirSync(join(ws, 'gallery'));

  const { status, output } = runInit(ws, 'gallery');

  assert.equal(status, 0, output);
  for (const rel of TEMPLATE_FILES) {
    assert.equal(existsSync(join(ws, 'gallery', rel)), true, `${rel} が生成されるはず`);
  }
});

test('.git など 7 件に含まれないファイルしか無いディレクトリには初期化でき、それらは残る', (t) => {
  const ws = makeWorkspace(t);
  const project = join(ws, 'gallery');
  put(project, '.git/HEAD', 'ref: refs/heads/main\n');
  put(project, 'LICENSE', 'MIT\n');
  put(project, 'sketches/my-work/index.html', '<!doctype html>\n');

  const { status, output } = runInit(ws, 'gallery');

  assert.equal(status, 0, output);
  assert.equal(readFileSync(join(project, '.git/HEAD'), 'utf-8'), 'ref: refs/heads/main\n');
  assert.equal(readFileSync(join(project, 'LICENSE'), 'utf-8'), 'MIT\n');
  assert.equal(readFileSync(join(project, 'sketches/my-work/index.html'), 'utf-8'), '<!doctype html>\n');
  for (const rel of TEMPLATE_FILES) {
    assert.equal(existsSync(join(project, rel)), true, `${rel} が生成されるはず`);
  }
});
