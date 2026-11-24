import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { commitFromResolved, resolveBuildInfo, versionFromDescribe, UNRELEASED_VERSION } from '../src/core/build-info.js';
import { isolatedGit as git } from './fixtures/isolated-git.js';
import { makeOuterRepo, outerRepoEnvCases, runNode, runNodeInWorktreeHook } from './fixtures/outer-git-env.js';

// ツールカラム下端に出す版 (#154)。ギャラリーの node_modules に入った dropcaster から
// ギャラリー側リポジトリの SHA を拾わないこと、GitHub から入れた解決 SHA を拾うことを固定する。

const SHA = '0123456789abcdef0123456789abcdef01234567';

/** ギャラリー (git 管理) の node_modules/dropcaster を作る。 */
async function makeGallery(lockEntry) {
  const gallery = await mkdtemp(join(tmpdir(), 'dropcaster-build-info-'));
  const pkgRoot = join(gallery, 'node_modules', 'dropcaster');
  await mkdir(pkgRoot, { recursive: true });
  await writeFile(join(pkgRoot, 'package.json'), JSON.stringify({ name: 'dropcaster', version: '0.1.0' }));
  if (lockEntry) {
    await writeFile(join(gallery, 'node_modules', '.package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/dropcaster': lockEntry } }));
  }
  git(gallery, 'init', '-q');
  git(gallery, 'commit', '-q', '--allow-empty', '-m', 'gallery');
  return { gallery, pkgRoot };
}

test('commitFromResolved takes the short sha from a git dependency', () => {
  assert.equal(commitFromResolved(`git+ssh://git@github.com/shinyaoguri/dropcaster.git#${SHA}`), '0123456');
  assert.equal(commitFromResolved(`git+ssh://git@github.com/o/r.git#${SHA.toUpperCase()}`), '0123456');
});

test('commitFromResolved rejects registry tarballs, refs and non-strings', () => {
  assert.equal(commitFromResolved('https://registry.npmjs.org/dropcaster/-/dropcaster-0.1.0.tgz'), null);
  assert.equal(commitFromResolved('git+ssh://git@github.com/o/r.git#main'), null);
  assert.equal(commitFromResolved(`git+ssh://git@github.com/o/r.git#${SHA.slice(0, 39)}`), null);
  assert.equal(commitFromResolved(undefined), null);
});

test('resolveBuildInfo does not report the gallery repository HEAD as the dropcaster commit', async () => {
  const { gallery, pkgRoot } = await makeGallery(null);
  try {
    assert.deepEqual(resolveBuildInfo(pkgRoot), { version: '0.1.0', commit: null });
  } finally {
    await rm(gallery, { recursive: true, force: true });
  }
});

test('resolveBuildInfo uses the sha npm resolved for a GitHub install', async () => {
  const { gallery, pkgRoot } = await makeGallery({
    version: '0.1.0', resolved: `git+ssh://git@github.com/shinyaoguri/dropcaster.git#${SHA}`,
  });
  try {
    assert.deepEqual(resolveBuildInfo(pkgRoot), { version: '0.1.0', commit: '0123456' });
  } finally {
    await rm(gallery, { recursive: true, force: true });
  }
});

test('resolveBuildInfo uses HEAD when the package root is the git work tree', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'dropcaster-build-info-repo-'));
  try {
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'dropcaster', version: '9.9.9' }));
    git(repo, 'init', '-q');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'x');
    const head = git(repo, 'rev-parse', '--short=7', 'HEAD');
    assert.deepEqual(resolveBuildInfo(repo), { version: '9.9.9', commit: head });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

// 版の正本はタグ (docs/decisions/0022)。package.json の version はリリースで動かない。

test('versionFromDescribe reads the release tag and how far HEAD has moved past it', () => {
  assert.equal(versionFromDescribe('v0.2.0-0-gabc1234'), '0.2.0');
  assert.equal(versionFromDescribe('v0.2.0-3-gabc1234'), '0.2.0+3');
  assert.equal(versionFromDescribe('v1.10.2-12-g0123456789abcdef\n'), '1.10.2+12');
});

test('versionFromDescribe rejects outputs that are not release tags', () => {
  assert.equal(versionFromDescribe('abc1234'), null);
  assert.equal(versionFromDescribe('v0.2-0-gabc1234'), null);
  assert.equal(versionFromDescribe('release-0.2.0-0-gabc1234'), null);
  assert.equal(versionFromDescribe(null), null);
});

/** @param {string} version */
async function makeRepo(version) {
  const repo = await mkdtemp(join(tmpdir(), 'dropcaster-build-info-tag-'));
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'dropcaster', version }));
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
  return repo;
}

test('resolveBuildInfo takes the version from the release tag, not package.json', async () => {
  const repo = await makeRepo(UNRELEASED_VERSION);
  try {
    git(repo, 'tag', 'v0.2.0');
    assert.equal(resolveBuildInfo(repo).version, '0.2.0');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'third');
    assert.equal(resolveBuildInfo(repo).version, '0.2.0+2');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resolveBuildInfo ignores tags that are not release versions', async () => {
  const repo = await makeRepo(UNRELEASED_VERSION);
  try {
    git(repo, 'tag', 'poc-3d');
    assert.equal(resolveBuildInfo(repo).version, null);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resolveBuildInfo reports no version for an untagged unreleased package', async () => {
  const { gallery, pkgRoot } = await makeGallery({
    version: UNRELEASED_VERSION, resolved: `git+ssh://git@github.com/shinyaoguri/dropcaster.git#${SHA}`,
  });
  try {
    await writeFile(join(pkgRoot, 'package.json'), JSON.stringify({ name: 'dropcaster', version: UNRELEASED_VERSION }));
    assert.deepEqual(resolveBuildInfo(pkgRoot), { version: null, commit: '0123456' });
  } finally {
    await rm(gallery, { recursive: true, force: true });
  }
});

// 実装が呼ぶ git は、親の環境がどのリポジトリを指していても packageRoot のリポジトリを読む (#253)。
// linked worktree の git hook の中では git が GIT_DIR を絶対パスで立てるので、そこから build や test を
// 走らせると、親の環境のまま呼んだ git は hook を起こした外側のリポジトリを読んでいた。

const BUILD_INFO_PROBE = [
  '--input-type=module', '-e',
  `import { resolveBuildInfo } from ${JSON.stringify(new URL('../src/core/build-info.js', import.meta.url).href)};
   console.log(JSON.stringify(resolveBuildInfo(process.argv[1])));`,
];

/** タグ v0.3.0 の 1 つ先に HEAD があるパッケージのリポジトリ。 */
async function makeTaggedRepo() {
  const repo = await makeRepo(UNRELEASED_VERSION);
  git(repo, 'tag', 'v0.3.0');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
  return { repo, expected: { version: '0.3.0+1', commit: git(repo, 'rev-parse', '--short=7', 'HEAD') } };
}

test('resolveBuildInfo reads the package repository when the parent git environment points at another one', async () => {
  const { repo, expected } = await makeTaggedRepo();
  const outer = await makeOuterRepo();
  try {
    const probe = (env) => JSON.parse(runNode([...BUILD_INFO_PROBE, repo], { cwd: outer.repo, env }));
    assert.deepEqual(probe({}), expected, 'no git environment');
    for (const [name, env] of outerRepoEnvCases(outer)) assert.deepEqual(probe(env), expected, name);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(outer.dir, { recursive: true, force: true });
  }
});

test('resolveBuildInfo reads the package repository inside a pre-commit hook of a linked worktree', async () => {
  const { repo, expected } = await makeTaggedRepo();
  const outer = await makeOuterRepo();
  try {
    const { stdout, gitDir } = await runNodeInWorktreeHook(outer, [...BUILD_INFO_PROBE, repo], { cwd: outer.worktree });
    // この前提が崩れると下の比較が空振りする: git は linked worktree の hook に外側の GIT_DIR を渡す
    assert.match(gitDir, /worktrees/);
    assert.deepEqual(JSON.parse(stdout), expected);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(outer.dir, { recursive: true, force: true });
  }
});

test('resolveBuildInfo does not take the gallery HEAD when GIT_DIR points at the gallery repository', async () => {
  const { gallery, pkgRoot } = await makeGallery({
    version: '0.1.0', resolved: `git+ssh://git@github.com/shinyaoguri/dropcaster.git#${SHA}`,
  });
  try {
    const env = { GIT_DIR: join(gallery, '.git') };
    assert.deepEqual(JSON.parse(runNode([...BUILD_INFO_PROBE, pkgRoot], { cwd: gallery, env })),
      { version: '0.1.0', commit: '0123456' });
  } finally {
    await rm(gallery, { recursive: true, force: true });
  }
});

test('the package itself declares the unreleased marker so tags stay the only source of the version', async () => {
  const pkg = JSON.parse(await (await import('fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf-8'));
  assert.equal(pkg.version, UNRELEASED_VERSION);
});
