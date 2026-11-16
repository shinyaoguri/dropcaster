import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isolatedGit } from './fixtures/isolated-git.js';

// テストが一時リポジトリで呼ぶ git は、実行する人の git 設定で結果が変わらない (#223)。
// 壊れた設定は、コミット署名を有効にして存在しない鍵を指す形で作る。

const BROKEN_SIGNING = [
  ['commit.gpgsign', 'true'],
  ['gpg.format', 'ssh'],
  ['user.signingkey', '/nonexistent/key.pub'],
];

/**
 * 環境変数を差し替えて fn を実行し、元に戻す。
 * @template T
 * @param {Record<string, string>} vars
 * @param {() => T} fn
 */
function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => /** @type {const} */ ([key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** @param {(dir: string) => Promise<void>} fn */
async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dropcaster-isolated-git-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** @param {string} repo */
function commitInFreshRepo(repo) {
  isolatedGit(repo, 'init', '-q');
  isolatedGit(repo, 'commit', '-q', '--allow-empty', '-m', 'x');
  return isolatedGit(repo, 'rev-parse', '--short=7', 'HEAD');
}

test('isolatedGit commits when the environment injects a broken signing setup', async () => {
  await withTempDir(async (repo) => {
    /** @type {Record<string, string>} */
    const injected = { GIT_CONFIG_COUNT: String(BROKEN_SIGNING.length) };
    BROKEN_SIGNING.forEach(([key, value], i) => {
      injected[`GIT_CONFIG_KEY_${i}`] = key;
      injected[`GIT_CONFIG_VALUE_${i}`] = value;
    });
    assert.match(withEnv(injected, () => commitInFreshRepo(repo)), /^[0-9a-f]{7}$/);
  });
});

test('isolatedGit commits when the global config has a broken signing setup and a failing hook', async () => {
  await withTempDir(async (home) => {
    const hooks = join(home, 'hooks');
    const repo = join(home, 'repo');
    await mkdir(hooks);
    await mkdir(repo);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    for (const [key, value] of [...BROKEN_SIGNING, ['core.hooksPath', hooks]]) {
      isolatedGit(home, 'config', '--file', join(home, '.gitconfig'), key, value);
    }
    const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'xdg') };
    assert.match(withEnv(env, () => commitInFreshRepo(repo)), /^[0-9a-f]{7}$/);
  });
});

test('isolatedGit puts the stderr of a failed git command in the error message', async () => {
  await withTempDir(async (repo) => {
    isolatedGit(repo, 'init', '-q');
    // コミットの無いリポジトリの HEAD は解決できない
    assert.throws(() => isolatedGit(repo, 'rev-parse', '--verify', 'HEAD'), /fatal: Needed a single revision/);
  });
});
