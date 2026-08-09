// OpenProcessing の作品メタとコードから、iframe 用の HTML 文字列を組み立てる。
// Browser からは viewer の OpenProcessingSource が srcdoc 用に呼び、
// Node からは CLI の `dropcaster fetch` が ローカルファイル形式の組み立てに呼ぶ
// 想定で共有する。副作用なし・pure 関数のみ。
//
// 入力:
//   meta      : /api/sketch/{id} のレスポンス（visualID, engineURL, mode, libraries, fileBase, ...）
//   codeTabs  : /api/sketch/{id}/code のレスポンス配列 ({ orderID, code, ... })
//   options   : {
//     assetProxyBaseUrl    same-origin proxy のベース URL（指定すれば deckard.* を全部書き換える）
//     injectCorsShim       true なら <img>/<audio>/<video> に crossOrigin='anonymous' を立てる shim を入れる
//                          (proxy 経由なら同一オリジンになるので shim 不要。直配信なら ON 推奨)
//     injectErrorShim      true なら iframe 内の window.onerror / console を parent に postMessage で転送
//                          (PoC では useful, 本番ビルドでは off にしてもよい)
//   }
//
// 出力: 完成した HTML 文字列。iframe.srcdoc にそのまま代入できる。

import { assembleDocumentFromFiles, findIndexFileName, escapeAttr } from './html-doc-builder.js';

const DECKARD_HOST = 'https://deckard.openprocessing.org/';

// 型は隣の op-sketch-builder.d.ts が正本（JSDoc からはこの typedef 経由で参照する）
/** @typedef {import('./op-sketch-builder.js').OpSketchMeta} OpSketchMeta */
/** @typedef {import('./op-sketch-builder.js').OpCodeTab} OpCodeTab */

/**
 * 指定オプションで HTML を組み立てる。
 * @param {object} params
 * @param {OpSketchMeta} params.meta      /api/sketch/{id} のレスポンス
 * @param {OpCodeTab[]} params.codeTabs   /api/sketch/{id}/code のレスポンス
 * @param {object} [params.options]
 * @param {string} [params.options.assetProxyBaseUrl]
 * @param {boolean} [params.options.injectCorsShim=true]
 * @param {boolean} [params.options.injectErrorShim=false]
 * @returns {string}
 */
export function assembleOpSketchHtml({ meta, codeTabs, options = {} }) {
  const {
    assetProxyBaseUrl,
    injectCorsShim = true,
    injectErrorShim = false,
  } = options;

  const code = sortAndJoinCode(codeTabs);
  const codeRewritten = rewriteAssetUrls(code, assetProxyBaseUrl);
  const fileBase = rewriteAssetUrls(meta.fileBase || '', assetProxyBaseUrl);

  const libsHtml = (Array.isArray(meta.libraries) ? meta.libraries : [])
    .map(l => l && l.url ? `<script src="${escapeAttr(l.url)}"><\/script>` : '')
    .filter(Boolean)
    .join('\n');

  const shims = [
    injectErrorShim ? ERROR_SHIM : '',
    injectCorsShim ? CORS_SHIM : '',
  ].filter(Boolean).join('\n');

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<base href="${escapeAttr(fileBase)}">
<style>
  html, body { margin: 0; padding: 0; background: #000; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  canvas { display: block; max-width: 100%; max-height: 100vh; object-fit: contain; }
</style>
${shims ? `<script>\n${shims}\n<\/script>` : ''}
<script src="${escapeAttr(meta.engineURL || '')}"><\/script>
${libsHtml}
</head><body>
<script>
${codeRewritten}
<\/script>
</body></html>`;
}

/**
 * code 中／fileBase 中の deckard.openprocessing.org 絶対 URL を proxy ベースに書き換える。
 * assetProxyBaseUrl が未設定なら元のまま返す（degraded mode）。
 */
export function rewriteAssetUrls(text, assetProxyBaseUrl) {
  if (!assetProxyBaseUrl || !text) return text;
  const base = assetProxyBaseUrl.endsWith('/') ? assetProxyBaseUrl : assetProxyBaseUrl + '/';
  return text.split(DECKARD_HOST).join(base);
}

/**
 * OP の HTML モード (`mode: 'html'`) の作品から srcdoc 用 HTML を組み立てる。
 *
 * HTML モードはマルチファイル構成（index.html + CSS / JS / GLSL 等のタブ）で、
 * p5js モードの「全タブを 1 本の <script> に連結」方式は適用できない。
 * またコードタブは fileBase (deckard CDN) 上にファイルとして存在しない
 * （存在するのはアップロードされたアセットだけ）ため、相対パス参照の解決は
 * html-doc-builder に委ねる（インライン展開 + fetch/XHR shim）。
 *
 * ここが担うのは OP 固有の詰め替えだけ:
 *   - code タブ (title/code) → 仮想ファイル表
 *   - deckard URL の proxy 書き換え（コードと fileBase の両方）
 *   - fileBase → <base href>（アップロード済みアセットの解決先）
 *
 * 作者のドキュメント構造を尊重するため、p5js モードと違い viewer 側の
 * <style> や shim 類（CORS/エラー転送）は注入しない。
 *
 * @param {object} params
 * @param {OpSketchMeta} params.meta  /api/sketch/{id} のレスポンス（fileBase を使う）
 * @param {OpCodeTab[]} params.codeTabs /api/sketch/{id}/code のレスポンス
 * @param {object} [params.options]
 * @param {string} [params.options.assetProxyBaseUrl]
 * @returns {string} iframe.srcdoc にそのまま代入できる HTML
 * @throws {Error} index.html 相当のタブが見つからない場合
 */
export function assembleHtmlModeOpSketchHtml({ meta, codeTabs, options = {} }) {
  const { assetProxyBaseUrl } = options;

  // タブ名 → コード（deckard URL は proxy 書き換え済み）の仮想ファイル表
  const files = new Map();
  for (const tab of Array.isArray(codeTabs) ? codeTabs : []) {
    const name = String(tab?.title ?? '').trim();
    if (!name) continue;
    files.set(name, rewriteAssetUrls(String(tab?.code ?? ''), assetProxyBaseUrl));
  }

  if (!findIndexFileName(files)) {
    throw new Error('html-mode sketch has no index.html tab');
  }

  return assembleDocumentFromFiles({
    files,
    baseHref: rewriteAssetUrls(meta.fileBase || '', assetProxyBaseUrl),
  });
}

/**
 * OP の HTML モード作品を、ローカル sketch ディレクトリのファイル群として
 * 書き出すための計画を立てる。`dropcaster fetch` の html モード経路が使う。
 *
 * viewer 用の assembleHtmlModeOpSketchHtml と違い、ローカルではタブを
 * 実ファイルとして書き出せるため、インライン展開も fetch/XHR shim も不要 —
 * 作者の `<script src="mySketch.js">` や `loadShader('vert.glsl')` は
 * ファイルがそこにあれば素で解決する。この関数はファイル名の決定
 * （安全化・衝突回避）だけを担い、アセット URL の書き換えは呼び出し側が
 * rewriteCodeWithAssetMap で行う。
 *
 * 規則:
 *   - index タブ（findIndexFileName と同じ規則）は常に `index.html` として
 *     書き出す（ローカル sketch 形式で scan が必須とする名前）
 *   - 他のタブは原形保存が基本。パス区切り・制御文字などの危険名と、
 *     予約名（`_op-meta.json`）・大文字小文字無視での衝突だけ付け替える
 *     （大文字小文字を無視するのは case-insensitive なファイルシステム対策）
 *   - 付け替えが起きたら全タブ内容中の旧名参照を新名に置換し、renames で返す。
 *     ただし旧名が最終的なファイル名集合にも残っている場合（同名タブの重複など）
 *     は参照先が曖昧なので書き換えない
 *
 * @param {object} params
 * @param {Array} params.codeTabs   /api/sketch/{id}/code のレスポンス
 * @returns {{ files: Array<{name: string, content: string}>, indexName: string,
 *            renames: Array<{from: string, to: string}> }}
 * @throws {Error} index.html 相当のタブが見つからない場合
 */
export function planHtmlModeLocalFiles({ codeTabs }) {
  const tabs = [];
  const namesForIndexLookup = new Map();
  for (const tab of Array.isArray(codeTabs) ? codeTabs : []) {
    const name = String(tab?.title ?? '').trim();
    if (!name) continue;
    tabs.push({ name, code: String(tab?.code ?? '') });
    if (!namesForIndexLookup.has(name)) namesForIndexLookup.set(name, true);
  }

  const indexName = findIndexFileName(namesForIndexLookup);
  if (!indexName) {
    throw new Error('html-mode sketch has no index.html tab');
  }

  // 生成物と衝突する名前は付け替える (index.html は index タブが確保する)
  const usedLower = new Set(['index.html', '_op-meta.json']);
  const renames = [];
  const files = [];
  let indexAssigned = false;
  for (const tab of tabs) {
    let outName;
    if (!indexAssigned && tab.name === indexName) {
      outName = 'index.html';
      indexAssigned = true;
    } else {
      outName = safeLocalTabName(tab.name);
      if (usedLower.has(outName.toLowerCase())) {
        const { stem, ext } = splitTabExt(outName);
        let suffix = 2;
        do {
          outName = `${stem}_${suffix}${ext}`;
          suffix++;
        } while (usedLower.has(outName.toLowerCase()));
      }
      usedLower.add(outName.toLowerCase());
    }
    if (outName !== tab.name) renames.push({ from: tab.name, to: outName });
    files.push({ name: outName, content: tab.code });
  }

  // 付け替えたタブへの参照 (<script src> や loadShader の引数など) を新名に揃える。
  // 逐次置換だと前の置換結果を後の短い from (例: '..') が再置換して壊すので、
  // 最長マッチ優先の 1 パス同時置換にする。
  const finalNamesLower = new Set(files.map(f => f.name.toLowerCase()));
  const rewritable = renames
    .filter(r => !finalNamesLower.has(r.from.toLowerCase()))
    .sort((a, b) => b.from.length - a.from.length);
  if (rewritable.length > 0) {
    const toByFrom = new Map(rewritable.map(r => [r.from, r.to]));
    const pattern = new RegExp(rewritable.map(r => escapeRegExp(r.from)).join('|'), 'g');
    for (const file of files) {
      file.content = file.content.replace(pattern, m => toByFrom.get(m));
    }
  }

  return { files, indexName, renames };
}

/**
 * タブ名をローカル書き出しに安全なフラットなファイル名へ変換する。
 * 原形保存が基本 — 典型的なタブ名 (mySketch.js, vert.glsl) はそのまま通り、
 * パス区切り・制御文字・Windows で使えない文字だけ '_' に置き換える。
 * '.' / '..' そのものはディレクトリ参照になるので固定名に落とす。
 */
function safeLocalTabName(name) {
  const cleaned = String(name)
    .replace(/[\\/]+/g, '_')
    .replace(/[\x00-\x1f<>:"|?*]+/g, '_');
  if (!cleaned || /^\.+$/.test(cleaned)) return '_tab';
  return cleaned;
}

/** 'foo.min.js' → { stem: 'foo.min', ext: '.js' }。拡張子なしは ext ''。 */
function splitTabExt(name) {
  const m = /^(.+?)(\.[^.]*)?$/.exec(name);
  return { stem: (m && m[1]) || name, ext: (m && m[2]) || '' };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 既存のローカル sketch ディレクトリ形式の index.html を組み立てる。
 * `dropcaster fetch` がローカルに書き出すときに使う (各タブを別ファイルにし
 * <script src="*.js"> で参照、エンジンとライブラリは CDN URL のまま)。
 *
 * @param {object} params
 * @param {string} params.engineURL                    例: https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.js
 * @param {Array<{url: string}>} [params.libraries=[]]
 * @param {string[]} params.scriptFiles                code タブごとに書き出した .js のファイル名 (相対)
 * @returns {string}
 */
export function assembleLocalOpSketchHtml({ engineURL, libraries = [], scriptFiles }) {
  const libScripts = libraries
    .filter(l => l && l.url)
    .map(l => `    <script src="${escapeAttr(l.url)}" type="text/javascript"><\/script>`)
    .join('\n');
  const codeScripts = (scriptFiles || [])
    .map(f => `    <script src="${escapeAttr(f)}" type="text/javascript"><\/script>`)
    .join('\n');

  return `<html>
  <head>
    <meta charset="utf-8">
    <script src="${escapeAttr(engineURL || '')}" type="text/javascript"><\/script>
${libScripts ? libScripts + '\n' : ''}${codeScripts}
  </head>
  <body>
  </body>
</html>
`;
}

/** code タブを orderID 昇順で結合する。orderID が無い／同値でも安定。 */
export function sortAndJoinCode(codeTabs) {
  if (!Array.isArray(codeTabs)) return '';
  return [...codeTabs]
    .map((t, i) => ({ ...t, __i: i }))
    .sort((a, b) => {
      const ao = Number.isFinite(a.orderID) ? a.orderID : a.__i;
      const bo = Number.isFinite(b.orderID) ? b.orderID : b.__i;
      return ao - bo;
    })
    .map(t => (t.code != null ? String(t.code) : ''))
    .join('\n\n');
}

/** code 中に deckard ホスト直 URL が含まれているか（assetProxy 未設定時に degraded を判定するのに使う）。 */
export function hasExternalDeckardAsset(codeTabs) {
  if (!Array.isArray(codeTabs)) return false;
  return codeTabs.some(t => typeof t?.code === 'string' && t.code.includes(DECKARD_HOST));
}

/** iframe 内に注入する CORS shim。<img>/<audio>/<video> に crossOrigin='anonymous' を立てる。 */
const CORS_SHIM = `(function(){
  var origCreate = document.createElement.bind(document);
  document.createElement = function(name){
    var el = origCreate.apply(this, arguments);
    var n = String(name).toLowerCase();
    if (n === 'img' || n === 'audio' || n === 'video') {
      try { el.crossOrigin = 'anonymous'; } catch (e) {}
    }
    return el;
  };
})();`;

/** iframe 内のエラーと console を parent に postMessage で転送する shim。デバッグ用。 */
const ERROR_SHIM = `(function(){
  function post(level, msg, extra){
    try { parent.postMessage(Object.assign({ __dcOp: true, level: level, msg: String(msg) }, extra || {}), '*'); } catch(e) {}
  }
  window.addEventListener('error', function(e){ post('error', e.message || e.error || 'unknown', { file: e.filename, line: e.lineno }); });
  window.addEventListener('unhandledrejection', function(e){ post('rejection', (e.reason && (e.reason.message || e.reason)) || 'rejection'); });
  ['log','warn','error','info'].forEach(function(lv){
    var orig = console[lv].bind(console);
    console[lv] = function(){
      try {
        var args = Array.prototype.slice.call(arguments).map(function(a){
          try { return typeof a === 'string' ? a : JSON.stringify(a); } catch(e) { return String(a); }
        }).join(' ');
        post('console-' + lv, args);
      } catch(e) {}
      orig.apply(console, arguments);
    };
  });
})();`;
