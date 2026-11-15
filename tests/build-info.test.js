import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { commitFromResolved, resolveBuildInfo } from '../src/core/build-info.js';

// ツールカラム下端に出す版 (#154)。ギャラリーの node_modules に入った dropcaster から
// ギャラリー側リポジトリの SHA を拾わないこと、GitHub から入れた解決 SHA を拾うことを固定する。

const SHA = '0123456789abcdef0123456789abcdef01234567';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

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
  git(gallery, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'gallery');
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
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x');
    const head = git(repo, 'rev-parse', '--short=7', 'HEAD');
    assert.deepEqual(resolveBuildInfo(repo), { version: '9.9.9', commit: head });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
