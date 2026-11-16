import { execFileSync } from 'child_process';
import { devNull } from 'os';

// テストが一時ディレクトリに作るリポジトリで git を呼ぶ入口。
// 実行する人の git 設定 (署名・hook・テンプレートなど) で結果が変わらないよう、環境ごと切り離す (#223)。
// 呼び出しごとに `-c` を並べる形は、付け忘れた呼び出しだけが設定の影響を受けるので採らない。

/** @returns {NodeJS.ProcessEnv} */
function isolatedEnv() {
  // 親から渡った GIT_* を落とす: GIT_CONFIG_COUNT / GIT_CONFIG_PARAMETERS による設定の注入、
  // GIT_DIR / GIT_INDEX_FILE (git hook の中から走らせたとき)、GIT_TEMPLATE_DIR など
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    // グローバル設定を読まないので、コミットの名義はここで与える
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid',
    // 失敗メッセージに入る git の文言を、実行する人のロケールによらず同じにする
    LC_ALL: 'C',
  };
}

/**
 * @param {string} cwd
 * @param {...string} args
 * @returns {string} 前後の空白を除いた stdout
 */
export function isolatedGit(cwd, ...args) {
  // stderr を pipe で受けると、失敗時に execFileSync が Error の message へ stderr を含める
  return execFileSync('git', args, { cwd, env: isolatedEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}
