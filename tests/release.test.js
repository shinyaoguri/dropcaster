import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BASELINE, SECTIONS, SKIP_LABEL, TYPES_NEEDING_FRAGMENT,
  addedFragments, bumpFor, checkPullRequest, latestTag, lintAll, lintFragment, nextRelease, renderNotes,
} from '../scripts/release.js';
import { isolatedGit as git } from './fixtures/isolated-git.js';
import { makeOuterRepo, outerRepoEnvCases, runNode, runNodeInWorktreeHook } from './fixtures/outer-git-env.js';

// 版とノートはタグと changelog.d/ の断片から決める (docs/decisions/0022)。

/** squash merge を模して、断片 (任意) を足すコミットを 1 つ作る。 */
async function commit(repo, title, fragment) {
  if (fragment) {
    await mkdir(join(repo, 'changelog.d'), { recursive: true });
    await writeFile(join(repo, 'changelog.d', fragment), '利用者向けの一文。\n');
    git(repo, 'add', '-A');
  }
  git(repo, 'commit', '-q', '--allow-empty', '-m', title);
}

async function withRepo(fn) {
  const repo = await mkdtemp(join(tmpdir(), 'dropcaster-release-'));
  try {
    git(repo, 'init', '-q');
    await commit(repo, 'chore: 始まり');
    await fn(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

test('bumpFor raises minor for features and breaking changes before 1.0', () => {
  assert.equal(bumpFor(['feat(viewer): 何か'], [], '0.2.3'), '0.3.0');
  assert.equal(bumpFor(['fix(core)!: 形を変える'], [], '0.2.3'), '0.3.0');
  assert.equal(bumpFor(['fix: 直す'], ['breaking'], '0.2.3'), '0.3.0');
  assert.equal(bumpFor(['chore: 整える'], ['feature'], '0.2.3'), '0.3.0');
});

test('bumpFor raises patch when nothing new is added', () => {
  assert.equal(bumpFor(['fix(viewer): 直す', 'docs: 書く'], ['fix'], '0.2.3'), '0.2.4');
  assert.equal(bumpFor(['not a conventional title'], ['perf'], '0.2.3'), '0.2.4');
});

test('bumpFor follows semver after 1.0', () => {
  assert.equal(bumpFor(['feat!: 壊す'], [], '1.4.2'), '2.0.0');
  assert.equal(bumpFor(['feat: 足す'], [], '1.4.2'), '1.5.0');
  assert.equal(bumpFor(['fix: 直す'], [], '1.4.2'), '1.4.3');
});

test('nextRelease counts from the baseline before the first tag', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat(viewer): 版を出す (#1)', 'release.feature.md');
    assert.deepEqual(nextRelease(repo), { tag: 'v0.2.0', previous: null, fragments: ['changelog.d/release.feature.md'] });
    assert.equal(BASELINE, '0.1.0');
  });
});

test('nextRelease releases nothing when no fragment was added since the last tag', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat: 最初 (#1)', 'first.feature.md');
    git(repo, 'tag', 'v0.2.0');
    await commit(repo, 'chore: 断片の要らない変更 (#2)');
    assert.equal(nextRelease(repo), null);
  });
});

test('nextRelease only reads fragments and titles after the latest tag', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat: 最初 (#1)', 'first.feature.md');
    git(repo, 'tag', 'v0.2.0');
    await commit(repo, 'fix(core): 直す (#2)', 'second.fix.md');
    // 既にある断片の書き直しは新しい項目ではない
    await writeFile(join(repo, 'changelog.d', 'first.feature.md'), '書き直し。\n');
    git(repo, 'commit', '-q', '-am', 'docs: 断片の書き直し (#3)');
    assert.deepEqual(nextRelease(repo), { tag: 'v0.2.1', previous: 'v0.2.0', fragments: ['changelog.d/second.fix.md'] });
  });
});

// release.js が呼ぶ git は、親の環境がどのリポジトリを指していても cwd のリポジトリを読む (#253)。

const RELEASE_SCRIPT = join(import.meta.dirname, '..', 'scripts', 'release.js');

/** @param {string} repo @param {Record<string, string>} [env] */
function nextVersion(repo, env) {
  return runNode([RELEASE_SCRIPT, 'next-version'], { cwd: repo, env });
}

test('release.js reads the tags and history of its cwd when the parent git environment points at another repository', async () => {
  await withRepo(async (tagged) => {
    await commit(tagged, 'feat: 最初 (#1)', 'first.feature.md');
    git(tagged, 'tag', 'v0.2.0');
    await commit(tagged, 'fix(core): 直す (#2)', 'second.fix.md');
    // タグが無いと断片は index から数える (ls-files) ので、別の経路として確かめる
    await withRepo(async (untagged) => {
      await commit(untagged, 'feat: 最初 (#1)', 'first.feature.md');
      const outer = await makeOuterRepo();
      try {
        assert.equal(nextVersion(tagged), 'v0.2.1', 'tagged, no git environment');
        assert.equal(nextVersion(untagged), 'v0.2.0', 'untagged, no git environment');
        for (const [name, env] of outerRepoEnvCases(outer)) {
          assert.equal(nextVersion(tagged, env), 'v0.2.1', `tagged, ${name}`);
          assert.equal(nextVersion(untagged, env), 'v0.2.0', `untagged, ${name}`);
        }
      } finally {
        await rm(outer.dir, { recursive: true, force: true });
      }
    });
  });
});

test('release.js reads the tags and history of its cwd inside a pre-commit hook of a linked worktree', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat: 最初 (#1)', 'first.feature.md');
    git(repo, 'tag', 'v0.2.0');
    await commit(repo, 'fix(core): 直す (#2)', 'second.fix.md');
    const outer = await makeOuterRepo();
    try {
      const { stdout, gitDir } = await runNodeInWorktreeHook(outer, [RELEASE_SCRIPT, 'next-version'], { cwd: repo });
      // この前提が崩れると下の比較が空振りする: git は linked worktree の hook に外側の GIT_DIR を渡す
      assert.match(gitDir, /worktrees/);
      assert.equal(stdout, 'v0.2.1');
    } finally {
      await rm(outer.dir, { recursive: true, force: true });
    }
  });
});

// 実行する人の git 設定で、数える断片とタグが変わらない (#253)。

/** グローバル設定を config の中身にして next-version を走らせる。 */
async function nextVersionWithGlobalConfig(repo, config) {
  const dir = await mkdtemp(join(tmpdir(), 'dropcaster-release-config-'));
  try {
    await writeFile(join(dir, 'gitconfig'), config);
    return nextVersion(repo, { GIT_CONFIG_GLOBAL: join(dir, 'gitconfig') });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('release.js counts a new fragment that resembles a rewritten one when diff.renames is copies', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat: 最初 (#1)', 'first.feature.md');
    git(repo, 'tag', 'v0.2.0');
    // 中身が first.feature.md と同じ断片を足し、同じ範囲で first.feature.md を書き直す
    await commit(repo, 'fix(core): 直す (#2)', 'second.fix.md');
    await writeFile(join(repo, 'changelog.d', 'first.feature.md'), '書き直し。\n');
    git(repo, 'commit', '-q', '-am', 'docs: 断片の書き直し (#3)');
    assert.equal(await nextVersionWithGlobalConfig(repo, ''), 'v0.2.1');
    assert.equal(await nextVersionWithGlobalConfig(repo, '[diff]\n\trenames = copies\n'), 'v0.2.1');
  });
});

test('release.js does not count a renamed fragment as new when diff.renames is false', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat: 最初 (#1)', 'first.feature.md');
    git(repo, 'tag', 'v0.2.0');
    git(repo, 'mv', 'changelog.d/first.feature.md', 'changelog.d/renamed.feature.md');
    await writeFile(join(repo, 'changelog.d', 'second.fix.md'), '別の一文。直した内容を書く。\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'fix(core): 直す (#2)');
    // 改名した feature の断片を数え直すと minor が上がる
    assert.equal(await nextVersionWithGlobalConfig(repo, ''), 'v0.2.1');
    assert.equal(await nextVersionWithGlobalConfig(repo, '[diff]\n\trenames = false\n'), 'v0.2.1');
  });
});

test('release.js finds the latest tag when column.ui is always', async () => {
  await withRepo(async (repo) => {
    await commit(repo, 'feat: 最初 (#1)', 'first.feature.md');
    git(repo, 'tag', 'v0.2.0');
    await commit(repo, 'feat: 次 (#2)', 'second.feature.md');
    git(repo, 'tag', 'v0.3.0');
    await commit(repo, 'fix(core): 直す (#3)', 'third.fix.md');
    assert.equal(await nextVersionWithGlobalConfig(repo, ''), 'v0.3.1');
    assert.equal(await nextVersionWithGlobalConfig(repo, '[column]\n\tui = always\n'), 'v0.3.1');
  });
});

test('latestTag picks the highest release tag numerically and ignores other tags', async () => {
  await withRepo(async (repo) => {
    git(repo, 'tag', 'v0.9.0');
    git(repo, 'tag', 'v0.10.0');
    git(repo, 'tag', 'poc-3d');
    git(repo, 'tag', 'v1.0.0-rc.1');
    assert.equal(latestTag(repo), 'v0.10.0');
  });
});

test('addedFragments skips the README and nested directories', async () => {
  await withRepo(async (repo) => {
    await mkdir(join(repo, 'changelog.d', 'archive'), { recursive: true });
    await writeFile(join(repo, 'changelog.d', 'README.md'), '# 説明\n');
    await writeFile(join(repo, 'changelog.d', 'archive', 'old.fix.md'), '古い。\n');
    await commit(repo, 'feat: 足す', 'new.feature.md');
    assert.deepEqual(addedFragments(repo, null), ['changelog.d/new.feature.md']);
  });
});

test('lintFragment accepts a well-formed fragment', () => {
  assert.deepEqual(lintFragment('weekly-release.feature.md', '版を週 1 回出す。[詳細](https://example.com/a)\n'), []);
});

test('lintFragment names each malformed part', () => {
  assert.equal(lintFragment('Weekly_Release.feature.md', 'x').length, 1);
  assert.match(lintFragment('a.feat.md', 'x')[0], /分類「feat」は無い/);
  assert.match(lintFragment('a.fix.md', '<!-- だけ -->\n')[0], /本文が空/);
  assert.match(lintFragment('a.fix.md', '[README](../README.md) を見る')[0], /絶対 URL/);
  assert.match(lintFragment('a.fix.md', '![絵](shot.png)')[0], /絶対 URL/);
  assert.match(lintFragment('a.fix.md', '[文字][ref]')[0], /参照形式/);
});

test('lintAll reports every broken fragment in the directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dropcaster-release-lint-'));
  try {
    await mkdir(join(dir, 'changelog.d'));
    await writeFile(join(dir, 'changelog.d', 'README.md'), '');
    await writeFile(join(dir, 'changelog.d', 'ok.fix.md'), '直した。\n');
    await writeFile(join(dir, 'changelog.d', 'empty.fix.md'), '');
    await writeFile(join(dir, 'changelog.d', 'bad.txt'), '直した。\n');
    assert.equal(lintAll(dir).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the fragments committed in this repository pass lint', () => {
  assert.deepEqual(lintAll(join(import.meta.dirname, '..')), []);
});

test('renderNotes groups fragments by section order and keeps multi-paragraph bodies in one item', () => {
  const notes = renderNotes([
    { category: 'fix', body: '<!-- 注釈 -->\n直した。\n\n詳しくは続き。' },
    { category: 'feature', body: '足した。' },
  ], { repository: 'o/r', previous: 'v0.2.0', tag: 'v0.3.0' });
  assert.equal(notes, [
    '## 新機能', '', '- 足した。', '',
    '## 修正', '', '- 直した。', '', '  詳しくは続き。', '',
    '**差分**: https://github.com/o/r/compare/v0.2.0...v0.3.0', '',
  ].join('\n'));
});

test('renderNotes omits the compare link for the first release', () => {
  assert.doesNotMatch(renderNotes([{ category: 'fix', body: '直した。' }], { repository: 'o/r', previous: null, tag: 'v0.2.0' }), /compare/);
});

test('checkPullRequest requires a fragment for user-visible types', () => {
  for (const type of TYPES_NEEDING_FRAGMENT) {
    assert.equal(checkPullRequest({ title: `${type}(viewer): 変える`, files: ['src/a.js'], labels: [] }).ok, false);
  }
  assert.equal(checkPullRequest({ title: 'refactor(core)!: 形を変える', files: ['src/a.js'], labels: [] }).ok, false);
});

test('checkPullRequest passes with a fragment, the skip label, or a type that needs none', () => {
  assert.equal(checkPullRequest({ title: 'feat: 足す', files: ['src/a.js', 'changelog.d/add.feature.md'], labels: [] }).ok, true);
  assert.equal(checkPullRequest({ title: 'fix: 直す', files: ['src/a.js'], labels: [SKIP_LABEL] }).ok, true);
  assert.equal(checkPullRequest({ title: 'chore: 整える', files: ['src/a.js'], labels: [] }).ok, true);
});

test('checkPullRequest does not count the README or archived fragments', () => {
  assert.equal(checkPullRequest({ title: 'fix: 直す', files: ['changelog.d/README.md'], labels: [] }).ok, false);
  assert.equal(checkPullRequest({ title: 'fix: 直す', files: ['changelog.d/archive/x.fix.md'], labels: [] }).ok, false);
});

test('the bump rule recognises every type the PR title lint allows', async () => {
  const lint = await readFile(new URL('../scripts/check-pr-title.sh', import.meta.url), 'utf-8');
  const allowed = /\^\(([a-z|]+)\)/.exec(lint)?.[1].split('|') ?? [];
  assert.ok(allowed.length > 0);
  for (const type of TYPES_NEEDING_FRAGMENT) assert.ok(allowed.includes(type), `${type} が check-pr-title.sh に無い`);
  assert.deepEqual(SECTIONS.map(([category]) => category), ['breaking', 'feature', 'fix', 'perf', 'docs']);
});
