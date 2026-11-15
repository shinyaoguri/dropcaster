// viewer に埋め込む「いま動いている dropcaster の版」をビルド時に求める。
//
// vite の define で import.meta.env.DROPCASTER_BUILD に入れ、マッピング画面のツールカラム下端に
// 表示する (#154)。このリポジトリでの開発・ホスト版のデプロイと、ギャラリーの node_modules に
// 入ったパッケージの両方から呼ばれるので、commit は次の順で探す:
//   1. パッケージのルートがそのまま git の作業ツリーなら HEAD の短縮 SHA
//   2. npm の hidden lockfile (node_modules/.package-lock.json) に GitHub から入れた解決 SHA があればそれ
// node_modules 配下で素朴に `git rev-parse HEAD` を呼ぶとギャラリー側リポジトリの SHA を拾ってしまうので、
// 1 は作業ツリーのルートがパッケージのルートと一致するときだけ採る。
import { readFileSync, realpathSync } from 'fs';
import { execFileSync } from 'child_process';
import { basename, dirname, join } from 'path';

/**
 * @typedef {object} BuildInfo
 * @property {string} version package.json の version
 * @property {string | null} commit 短縮 commit SHA。分からなければ null
 */

const SHORT_SHA_LENGTH = 7;

/**
 * lockfile の `resolved` (例: `git+ssh://git@github.com/o/r.git#<40 桁の sha>`) から短縮 SHA を取り出す。
 * @param {unknown} resolved
 * @returns {string | null}
 */
export function commitFromResolved(resolved) {
  if (typeof resolved !== 'string') return null;
  const match = /#([0-9a-f]{40})$/i.exec(resolved);
  return match ? match[1].slice(0, SHORT_SHA_LENGTH).toLowerCase() : null;
}

/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string | null}
 */
function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null; // git が無い・作業ツリーでない
  }
}

/** @param {string} path */
function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * @param {string} packageRoot
 * @returns {string | null}
 */
function commitFromGit(packageRoot) {
  const toplevel = git(packageRoot, ['rev-parse', '--show-toplevel']);
  if (!toplevel || canonical(toplevel) !== canonical(packageRoot)) return null;
  return git(packageRoot, ['rev-parse', `--short=${SHORT_SHA_LENGTH}`, 'HEAD']);
}

/**
 * @param {string} packageRoot
 * @param {string} name
 * @returns {string | null}
 */
function commitFromHiddenLockfile(packageRoot, name) {
  const nodeModules = dirname(packageRoot);
  if (basename(nodeModules) !== 'node_modules') return null;
  try {
    const lock = JSON.parse(readFileSync(join(nodeModules, '.package-lock.json'), 'utf-8'));
    return commitFromResolved(lock?.packages?.[`node_modules/${name}`]?.resolved);
  } catch {
    return null;
  }
}

/**
 * @param {string} packageRoot dropcaster パッケージのルート (package.json のあるディレクトリ)
 * @returns {BuildInfo}
 */
export function resolveBuildInfo(packageRoot) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
  const commit = commitFromGit(packageRoot) ?? commitFromHiddenLockfile(packageRoot, pkg.name);
  return { version: String(pkg.version), commit };
}
