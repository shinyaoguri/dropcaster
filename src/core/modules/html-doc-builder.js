// 「ファイル名 → 内容」の仮想ファイル表から、iframe.srcdoc 用の 1 枚の HTML を組み立てる。
//
// 元は OpenProcessing の html モード専用ロジックだったが、入力の形が
// 「マルチファイル構成のスケッチ」でありさえすれば取り込み元に依存しない
// (OP の code タブでも、Gist のファイル群でも同じ)。srcdoc には実ファイルが
// 存在しないため、相対参照は次の 2 段階で解決する:
//
//   1. index.html 内の <script src> / <link rel=stylesheet href> が仮想ファイル名を
//      指していれば内容をインライン展開する (パーサ起点のロードは実行時に横取り
//      できないため、組み立て時に解決する)
//   2. それ以外のファイル (GLSL 等) は fetch / XMLHttpRequest を包む shim を
//      <head> 先頭に注入し、実行時のファイル名一致リクエストへメモリ上の内容で
//      応答する (p5 の loadShader('vert.glsl') などがこの経路)
//
// 作者のドキュメント構造を尊重するため、<style> やその他の shim (CORS / エラー転送) は
// 注入しない。副作用なし・pure 関数のみ。

/**
 * 仮想ファイル表から srcdoc 用 HTML を組み立てる。
 *
 * @param {object} params
 * @param {Map<string, string>} params.files ファイル名 → 内容。index にあたるファイルも含める
 * @param {string} [params.baseHref] アップロード済みアセットの解決先 (<base href>)。空なら付けない
 * @returns {string} iframe.srcdoc にそのまま代入できる HTML
 * @throws {Error} index.html 相当のファイルが見つからない場合
 */
export function assembleDocumentFromFiles({ files, baseHref = '' }) {
  const virtualFiles = new Map(files);

  const indexName = findIndexFileName(virtualFiles);
  if (!indexName) {
    throw new Error('no index.html found in files');
  }
  let doc = virtualFiles.get(indexName);
  virtualFiles.delete(indexName); // ドキュメント自身は仮想ファイル表に載せない

  doc = inlineFileScripts(doc, virtualFiles);
  doc = inlineFileStylesheets(doc, virtualFiles);

  const headInject =
    (baseHref ? `<base href="${escapeAttr(baseHref)}">\n` : '') +
    `<script>\n${buildFileFetchShim(virtualFiles)}\n<\/script>`;
  return injectIntoHead(doc, headInject);
}

/**
 * index.html（大文字小文字無視）→ 無ければ最初の .html/.htm を返す。
 * キーの列挙順に依存するので、呼び出し側は元の並び順を保った Map を渡すこと。
 *
 * @param {Map<string, unknown>} files
 * @returns {string | null}
 */
export function findIndexFileName(files) {
  for (const name of files.keys()) {
    if (name.toLowerCase() === 'index.html') return name;
  }
  for (const name of files.keys()) {
    if (/\.html?$/i.test(name)) return name;
  }
  return null;
}

/**
 * `<script src="ファイル名">` を内容のインライン <script> に置き換える。
 * @param {string} doc
 * @param {Map<string, string>} files
 * @returns {string}
 */
function inlineFileScripts(doc, files) {
  return doc.replace(
    /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (whole, _pre, _q, src, _post) => {
      const name = normalizeFileRef(src);
      if (!files.has(name)) return whole; // 外部 URL や CDN 参照はそのまま
      return `<script>\n${escapeInlineScript(files.get(name))}\n</script>`;
    },
  );
}

/**
 * `<link rel="stylesheet" href="ファイル名">` をインライン <style> に置き換える。
 * @param {string} doc
 * @param {Map<string, string>} files
 * @returns {string}
 */
function inlineFileStylesheets(doc, files) {
  return doc.replace(/<link\b[^>]*>/gi, (whole) => {
    if (!/\brel\s*=\s*(["']?)stylesheet\1/i.test(whole)) return whole;
    const m = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(whole);
    if (!m) return whole;
    const name = normalizeFileRef(m[2]);
    if (!files.has(name)) return whole;
    return `<style>\n${files.get(name)}\n</style>`;
  });
}

/**
 * 相対参照をファイル名に正規化する（`./foo.js` → `foo.js`）。
 * @param {string} ref
 * @returns {string}
 */
function normalizeFileRef(ref) {
  return String(ref ?? '').trim().replace(/^\.\//, '');
}

/**
 * インライン <script> に埋め込むコードの `</script>` でタグが閉じないようにする。
 * @param {string} code
 * @returns {string}
 */
function escapeInlineScript(code) {
  return String(code ?? '').replace(/<\/script/gi, '<\\/script');
}

/**
 * `<head>` 直後（無ければ `<html>` 直後、それも無ければ先頭）に snippet を差し込む。
 * @param {string} doc
 * @param {string} snippet
 * @returns {string}
 */
function injectIntoHead(doc, snippet) {
  const head = /<head\b[^>]*>/i.exec(doc);
  if (head) {
    const at = head.index + head[0].length;
    return `${doc.slice(0, at)}\n${snippet}${doc.slice(at)}`;
  }
  const html = /<html\b[^>]*>/i.exec(doc);
  if (html) {
    const at = html.index + html[0].length;
    return `${doc.slice(0, at)}\n${snippet}${doc.slice(at)}`;
  }
  return `${snippet}\n${doc}`;
}

/**
 * 実行時 fetch / XHR を仮想ファイルの内容で応答する shim を生成する。
 * マッチ規則:
 *   1. リクエスト URL の生文字列（`./` を剥がした形）がファイル名と一致
 *   2. または解決後 URL が document.baseURI のディレクトリ配下で、残りがファイル名と一致
 * どちらにも当たらなければ元の fetch / XHR にそのまま委譲する。
 *
 * @param {Map<string, string>} files
 * @returns {string}
 */
function buildFileFetchShim(files) {
  const json = JSON.stringify(Object.fromEntries(files))
    .replace(/</g, '\\u003c'); // </script> でタグが閉じないように
  return `(function(){
  var FILES = ${json};
  var TYPES = { js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', html: 'text/html', json: 'application/json' };
  function contentType(name){
    var ext = (/\\.([a-z0-9]+)$/i.exec(name) || [])[1];
    return (ext && TYPES[ext.toLowerCase()]) || 'text/plain';
  }
  function lookup(input){
    var url = '';
    try { url = typeof input === 'string' ? input : String((input && input.url) || input || ''); } catch (e) { return null; }
    var raw = url.replace(/^\\.\\//, '');
    if (Object.prototype.hasOwnProperty.call(FILES, raw)) return raw;
    try {
      var resolved = new URL(url, document.baseURI);
      var base = new URL(document.baseURI);
      if (resolved.origin !== base.origin) return null;
      var dir = base.pathname.replace(/[^/]*$/, '');
      if (resolved.pathname.indexOf(dir) !== 0) return null;
      var rel = decodeURIComponent(resolved.pathname.slice(dir.length));
      return Object.prototype.hasOwnProperty.call(FILES, rel) ? rel : null;
    } catch (e) { return null; }
  }
  if (window.fetch) {
    var origFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      var name = lookup(input);
      if (name === null) return origFetch(input, init);
      return Promise.resolve(new Response(FILES[name], {
        status: 200,
        headers: { 'Content-Type': contentType(name) }
      }));
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url){
    this.__dcTabFile = lookup(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(){
    if (this.__dcTabFile == null) return origSend.apply(this, arguments);
    var xhr = this, name = this.__dcTabFile;
    setTimeout(function(){
      try {
        Object.defineProperty(xhr, 'readyState', { value: 4 });
        Object.defineProperty(xhr, 'status', { value: 200 });
        Object.defineProperty(xhr, 'responseText', { value: FILES[name] });
        Object.defineProperty(xhr, 'response', { value: FILES[name] });
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.dispatchEvent(new Event('load'));
        xhr.dispatchEvent(new Event('loadend'));
      } catch (e) { /* ignore */ }
    }, 0);
  };
})();`;
}

/**
 * HTML 属性値として安全な文字列に変換する。
 * @param {unknown} s
 * @returns {string}
 */
export function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
