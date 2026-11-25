import { execFileSync } from 'child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isolatedEnv, isolatedGit } from './isolated-git.js';

// 実装が自分で呼ぶ git を、「親の環境が別のリポジトリを指している」状態で動かすための道具 (#253)。
// 実装は process.env を読むので、環境を与えた子プロセスの node で走らせる。テストを走らせている
// プロセスの環境と、作業中のリポジトリには触れない。

/**
 * 外側のリポジトリ (タグも断片も無い) と、その linked worktree を作る。
 * @returns {Promise<{ dir: string, repo: string, worktree: string }>} dir を消せば全部消える
 */
export async function makeOuterRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'dropcaster-outer-'));
  const repo = join(dir, 'repo');
  const worktree = join(dir, 'worktree');
  await mkdir(repo);
  isolatedGit(repo, 'init', '-q');
  isolatedGit(repo, 'commit', '-q', '--allow-empty', '-m', 'outer');
  isolatedGit(repo, 'worktree', 'add', '-q', '-b', 'linked', worktree);
  return { dir, repo, worktree };
}

/**
 * 外側のリポジトリを指す環境変数の組。1 つ立つだけで、親の環境のまま呼んだ git の読み先が変わるもの。
 * @param {{ repo: string, worktree: string }} outer
 * @returns {[name: string, env: Record<string, string>][]}
 */
export function outerRepoEnvCases(outer) {
  const gitDir = join(outer.repo, '.git');
  return [
    ['GIT_DIR', { GIT_DIR: gitDir }],
    ['GIT_DIR and GIT_WORK_TREE', { GIT_DIR: gitDir, GIT_WORK_TREE: outer.repo }],
    ['GIT_WORK_TREE', { GIT_WORK_TREE: outer.repo }],
    ['GIT_COMMON_DIR', { GIT_COMMON_DIR: gitDir }],
    ['GIT_OBJECT_DIRECTORY', { GIT_OBJECT_DIRECTORY: join(gitDir, 'objects') }],
    ['GIT_INDEX_FILE', { GIT_INDEX_FILE: join(gitDir, 'worktrees', 'worktree', 'index') }],
  ];
}

/**
 * 実行する人の git 設定から切り離した環境に env を足して、node を走らせる。
 * @param {string[]} args
 * @param {{ cwd: string, env?: Record<string, string> }} options
 * @returns {string} 前後の空白を除いた stdout
 */
export function runNode(args, { cwd, env = {} }) {
  const options = { cwd, env: { ...isolatedEnv(), ...env }, stdio: /** @type {['ignore', 'pipe', 'pipe']} */ (['ignore', 'pipe', 'pipe']) };
  return execFileSync(process.execPath, args, options).toString().trim();
}

/** @param {string} word */
function shellQuote(word) {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * linked worktree の pre-commit hook の中で node を走らせる。git が hook に渡す環境 (GIT_DIR・GIT_INDEX_FILE を
 * 絶対パスで立てる) をそのまま再現する。
 * @param {{ dir: string, repo: string, worktree: string }} outer
 * @param {string[]} args
 * @param {{ cwd: string }} options hook の中で node を走らせるディレクトリ
 * @returns {Promise<{ stdout: string, gitDir: string }>} gitDir は hook が受け取った GIT_DIR
 */
export async function runNodeInWorktreeHook(outer, args, { cwd }) {
  const stdoutFile = join(outer.dir, 'hook-stdout');
  const gitDirFile = join(outer.dir, 'hook-git-dir');
  const hook = join(outer.repo, '.git', 'hooks', 'pre-commit');
  const command = [process.execPath, ...args].map(shellQuote).join(' ');
  await mkdir(join(outer.repo, '.git', 'hooks'), { recursive: true });
  await writeFile(hook, [
    '#!/bin/sh',
    `printf %s "$GIT_DIR" > ${shellQuote(gitDirFile)}`,
    `cd ${shellQuote(cwd)} && ${command} > ${shellQuote(stdoutFile)}`,
    '',
  ].join('\n'));
  await chmod(hook, 0o755);
  // hook が失敗すると commit が失敗し、isolatedGit が stderr を添えて投げる
  isolatedGit(outer.worktree, 'commit', '-q', '--allow-empty', '-m', 'run the hook');
  return {
    stdout: (await readFile(stdoutFile, 'utf-8')).trim(),
    gitDir: await readFile(gitDirFile, 'utf-8'),
  };
}
