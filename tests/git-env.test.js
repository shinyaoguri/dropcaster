import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envWithoutRepositoryLocation } from '../src/core/git-env.js';

// 実装が git を呼ぶときに落とす環境変数 (#253)。読むリポジトリを差し替えるものだけを落とす。

test('envWithoutRepositoryLocation drops the variables that redirect git to another repository', () => {
  const env = envWithoutRepositoryLocation({
    GIT_DIR: '/outer/.git/worktrees/wt',
    GIT_WORK_TREE: '/outer',
    GIT_COMMON_DIR: '/outer/.git',
    GIT_INDEX_FILE: '/outer/.git/worktrees/wt/index',
    GIT_OBJECT_DIRECTORY: '/outer/.git/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/outer/.git/objects',
    GIT_PREFIX: 'sub/',
    PATH: '/usr/bin',
  });
  assert.deepEqual(env, { PATH: '/usr/bin' });
});

test('envWithoutRepositoryLocation keeps settings injected through the environment', () => {
  // CI のコンテナは safe.directory をこの形で渡すことがある。落とすと git がリポジトリを読まなくなる
  const kept = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: '*',
    GIT_CONFIG_PARAMETERS: "'safe.directory'='*'",
    GIT_CONFIG_GLOBAL: '/home/me/.gitconfig',
    GIT_CEILING_DIRECTORIES: '/home',
    HOME: '/home/me',
  };
  assert.deepEqual(envWithoutRepositoryLocation({ ...kept, GIT_DIR: '/outer/.git' }), kept);
});

test('envWithoutRepositoryLocation matches names without regard to case and leaves its input alone', () => {
  // Windows の環境変数は大文字小文字を区別しない
  const input = { Git_Dir: 'C:\\outer\\.git', Path: 'C:\\bin' };
  assert.deepEqual(envWithoutRepositoryLocation(input), { Path: 'C:\\bin' });
  assert.deepEqual(input, { Git_Dir: 'C:\\outer\\.git', Path: 'C:\\bin' });
});
