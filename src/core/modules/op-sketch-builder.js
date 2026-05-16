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

const DECKARD_HOST = 'https://deckard.openprocessing.org/';

/**
 * 指定オプションで HTML を組み立てる。
 * @param {object} params
 * @param {object} params.meta            /api/sketch/{id} のレスポンス
 * @param {Array} params.codeTabs         /api/sketch/{id}/code のレスポンス
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

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
