// 実装が自分で git を呼ぶときの環境 (#253)。
//
// dropcaster の git 呼び出しは「cwd に渡したディレクトリのリポジトリ」を読む約束で書かれている
// (版の表示の build-info.js、リリースの scripts/release.js)。ところが git は、リポジトリの場所を
// 環境変数で差し替えられると cwd からの探索をやめる。linked worktree の git hook の中では git 自身が
// GIT_DIR と GIT_INDEX_FILE を絶対パスで立てるので、そこから `dropcaster build` や `npm test` を
// 走らせると、親の環境のまま呼んだ git は hook を起こした外側のリポジトリを読む。
//
// 落とすのは「どのリポジトリ・作業ツリー・index・オブジェクト置き場を読むか」を差し替える変数だけ。
// `git rev-parse --local-env-vars` が挙げるもの (git 2.43.0 で確認) のうち、設定を注入する
// GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT は残す。git 自身が別のリポジトリで子プロセスを動かすとき
// (submodule) と同じ切り分けで、CI のコンテナが safe.directory をこの形で渡していることがある。
// 設定で出力が変わるコマンドは、呼び出し側が引数で形を固定する (scripts/release.js)。
const REPOSITORY_LOCATION_VARIABLES = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_GRAFT_FILE',
  'GIT_SHALLOW_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
]);

/**
 * git が cwd からリポジトリを探し直すよう、リポジトリの場所を差し替える変数を除いた環境を返す。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export function envWithoutRepositoryLocation(env = process.env) {
  // Windows の環境変数は大文字小文字を区別しないので、名前は大文字に揃えて比べる
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !REPOSITORY_LOCATION_VARIABLES.has(name.toUpperCase())),
  );
}
