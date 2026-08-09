// 公開 Gist のファイル群から、iframe 用の HTML 文字列とタイトルを組み立てる。
//
// 想定する主な入力は canvastage が書き出した Gist:
//   _<project-name>.md   タイトル用のダミー (Gist 一覧の見出しを固定するための `_` 接頭辞)
//   index.html           p5 を CDN から読み、style.css / sketch.js を相対参照
//   style.css / sketch.js
//
// ただし canvastage 専用にはしない。**index.html を持つ公開 Gist なら受ける**。
// canvastage 由来かどうかは `_*.md` の有無で分かるので、タイトル復元にだけ使う。
//
// OP と違いアセットの配信元 (deckard CDN) が無いので、proxy 書き換えも <base href> も
// 不要 — 相対参照はすべて Gist 内のファイルとして html-doc-builder が解決する。
// 副作用なし・pure 関数のみ。

import { assembleDocumentFromFiles, findIndexFileName } from './html-doc-builder.js';
import { GistFormatError } from './gist-api-client.js';

/** @typedef {import('./gist-api-client.js').GistData} GistData */

/** canvastage がタイトル用に置くダミーファイル (`_<name>.md`)。 */
const TITLE_FILE_PATTERN = /^_(.*)\.md$/;

/**
 * Gist から srcdoc 用 HTML を組み立てる。
 *
 * @param {object} params
 * @param {GistData} params.gist
 * @returns {string} iframe.srcdoc にそのまま代入できる HTML
 * @throws {GistFormatError} index.html 相当のファイルが無い場合
 */
export function assembleGistSketchHtml({ gist }) {
  const files = sketchFiles(gist);
  if (!findIndexFileName(files)) {
    throw new GistFormatError('gist has no index.html');
  }
  // Gist にはアップロード済みアセットの置き場が無いので <base href> は付けない
  return assembleDocumentFromFiles({ files });
}

/**
 * スケッチ本体のファイルだけを取り出す（タイトル用のダミーは除く）。
 * ダミーを残すと fetch shim の仮想ファイル表に載って srcdoc が無駄に膨らむ。
 *
 * @param {GistData} gist
 * @returns {Map<string, string>}
 */
export function sketchFiles(gist) {
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const [name, content] of gist.files) {
    if (TITLE_FILE_PATTERN.test(name)) continue;
    files.set(name, content);
  }
  return files;
}

/**
 * 作品タイトルを復元する。canvastage 側の resolveProjectName と同じ規則:
 * `_<name>.md` のダミーファイル → description の順に見て、どちらも無ければ空を返す。
 * （description は `<name> — canvastage sketch` の形。em dash 区切り）
 *
 * @param {GistData} gist
 * @returns {string} 復元できなければ空文字（呼び出し側で fallback する）
 */
export function resolveGistTitle(gist) {
  for (const name of gist.files.keys()) {
    const matched = TITLE_FILE_PATTERN.exec(name);
    if (matched && matched[1]) return matched[1];
  }
  const fromDescription = /^(.*?)\s+—\s+canvastage sketch$/.exec(gist.description);
  if (fromDescription && fromDescription[1]) return fromDescription[1].trim();
  return '';
}

/**
 * canvastage が書き出した Gist かどうか（タイトル用ダミー or description で判定）。
 * 表示上の出自ラベルにだけ使い、読み込みの可否には効かせない。
 *
 * @param {GistData} gist
 * @returns {boolean}
 */
export function isCanvastageGist(gist) {
  for (const name of gist.files.keys()) {
    if (TITLE_FILE_PATTERN.test(name)) return true;
  }
  return /canvastage sketch$/.test(gist.description);
}
