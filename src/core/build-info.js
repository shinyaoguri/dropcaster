// viewer に埋め込む「いま動いている dropcaster の版」をビルド時に求める。
//
// vite の define で import.meta.env.DROPCASTER_BUILD に入れ、マッピング画面のツールカラム下端に
// 表示する (#154)。このリポジトリでの開発・ホスト版のデプロイと、ギャラリーの node_modules に
// 入ったパッケージの両方から呼ばれるので、commit は次の順で探す:
//   1. パッケージのルートがそのまま git の作業ツリーなら HEAD の短縮 SHA
//   2. npm の hidden lockfile (node_modules/.package-lock.json) に GitHub から入れた解決 SHA があればそれ
// node_modules 配下で素朴に `git rev-parse HEAD` を呼ぶとギャラリー側リポジトリの SHA を拾ってしまうので、
// 1 は作業ツリーのルートがパッケージのルートと一致するときだけ採る。
//
// version は git のタグが正本 (docs/decisions/0022)。リリースはファイルを変えずタグと GitHub Release
// だけで版を表すので、package.json の version は UNRELEASED_VERSION のまま動かない。
//   1. パッケージのルートが作業ツリーで `v<major>.<minor>.<patch>` のタグが辿れれば、それ (先へ進んでいれば `+<コミット数>`)
//   2. それ以外は package.json の version。UNRELEASED_VERSION なら「版不明」として null
// GitHub から入れたギャラリーはタグを知る手段が無いので 2 に落ち、表示はコミットだけになる。
import { readFileSync, realpathSync } from 'fs';
import { execFileSync } from 'child_process';
import { basename, dirname, join } from 'path';
import { envWithoutRepositoryLocation } from './git-env.js';

/**
 * @typedef {object} BuildInfo
 * @property {string | null} version 版 (例 `0.2.0`、タグより先なら `0.2.0+3`)。分からなければ null
 * @property {string | null} commit 短縮 commit SHA。分からなければ null
 */

const SHORT_SHA_LENGTH = 7;

/** package.json に置く「リリースされた版ではない」印。版の正本はタグ。 */
export const UNRELEASED_VERSION = '0.0.0-dev';

/** リリースのタグ。scripts/release.js が打つ形と同じ。 */
export const RELEASE_TAG_GLOB = 'v[0-9]*.[0-9]*.[0-9]*';

/**
 * `git describe --tags --long` の出力 (例 `v0.2.0-3-gabc1234`) から版を求める。
 * @param {unknown} describe
 * @returns {string | null}
 */
export function versionFromDescribe(describe) {
  if (typeof describe !== 'string') return null;
  const match = /^v(\d+\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/.exec(describe.trim());
  if (!match) return null;
  return match[2] === '0' ? match[1] : `${match[1]}+${match[2]}`;
}

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
    // 親の GIT_DIR などを引き継ぐと、dir ではなく外側のリポジトリを読む (#253)
    const env = envWithoutRepositoryLocation();
    return execFileSync('git', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
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
 * パッケージのルートがそのまま git の作業ツリーのときだけ true。
 * @param {string} packageRoot
 */
function isOwnWorkTree(packageRoot) {
  const toplevel = git(packageRoot, ['rev-parse', '--show-toplevel']);
  return Boolean(toplevel) && canonical(toplevel) === canonical(packageRoot);
}

/**
 * @param {string} packageRoot
 * @returns {string | null}
 */
function commitFromGit(packageRoot) {
  return git(packageRoot, ['rev-parse', `--short=${SHORT_SHA_LENGTH}`, 'HEAD']);
}

/**
 * @param {string} packageRoot
 * @returns {string | null}
 */
function versionFromGit(packageRoot) {
  return versionFromDescribe(git(packageRoot, ['describe', '--tags', '--long', '--match', RELEASE_TAG_GLOB, 'HEAD']));
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
  const ownWorkTree = isOwnWorkTree(packageRoot);
  const commit = (ownWorkTree ? commitFromGit(packageRoot) : null) ?? commitFromHiddenLockfile(packageRoot, pkg.name);
  const declared = String(pkg.version);
  const version = (ownWorkTree ? versionFromGit(packageRoot) : null)
    ?? (declared === UNRELEASED_VERSION ? null : declared);
  return { version, commit };
}
