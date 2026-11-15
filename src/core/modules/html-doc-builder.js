// 「ファイル名 → 内容」の仮想ファイル表から、iframe.srcdoc 用の 1 枚の HTML を組み立てる。
//
// 元は OpenProcessing の html モード専用ロジックだったが、入力の形が
// 「マルチファイル構成のスケッチ」でありさえすれば取り込み元に依存しない
// (OP の code タブでも、Gist のファイル群でも同じ)。srcdoc には実ファイルが
// 存在しないため、相対参照は次の 2 段階で解決する:
//
//   1. index.html 内の <script src> / <link rel=stylesheet href> が仮想ファイル名を
//      指していれば内容を埋め込む (パーサ起点のロードは実行時に横取りできないため、
//      組み立て時に解決する)。script は属性 (type="module"・defer・async・nomodule 等)
//      を残したまま src だけを内容の data: URL に差し替えるので、実行の意味と順序は
//      ブラウザが src 付き script として決め、中身が HTML として解析されることもない (#110)。
//      ただし data: URL の module は自分の URL が data: になるため、module 同士の
//      相対 import (`import './util.js'`) は解決できない (対象外。README に明記)
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
 * `<script src="ファイル名">` の src を内容の data: URL に差し替える。
 * src 以外の属性は書かれたまま残し、実行の意味 (module・defer・async・nomodule) と
 * 文書順をブラウザの扱いに任せる。
 * @param {string} doc
 * @param {Map<string, string>} files
 * @returns {string}
 */
function inlineFileScripts(doc, files) {
  return doc.replace(
    /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (whole, pre, _q, src, post) => {
      const name = normalizeFileRef(src);
      if (!files.has(name)) return whole; // 外部 URL や CDN 参照はそのまま
      // integrity は落とす: 埋め込む本体は sourceURL の追記や OP の proxy 書き換えで元のハッシュと
      // 一致せず、残すと error イベントも出さずに実行が止まる (埋め込み前の inline script でも無視されていた)
      const attrs = (/** @type {string} */ text) => dropAttributes(text, SCRIPT_DROPPED_ATTRS);
      return `<script${attrs(pre)}${embeddedScriptAttrs(files.get(name) ?? '', name)}${attrs(post)}></script>`;
    },
  );
}

/** 埋め込んだ script から落とす属性。 */
const SCRIPT_DROPPED_ATTRS = new Set(['integrity']);

/**
 * 開始タグの属性列から、指定した名前の属性を値ごと取り除く。それ以外は書かれたまま残す。
 * 属性を 1 つずつ読み進めるので、別の属性の値に名前が現れても取り除かない。
 * @param {string} attrText 開始タグ内の属性部分 (前後の空白を含んでよい)
 * @param {Set<string>} names 取り除く属性名 (小文字)
 * @returns {string}
 */
function dropAttributes(attrText, names) {
  return attrText.replace(ATTRIBUTE_PATTERN, (attr, name) => (names.has(name.toLowerCase()) ? '' : attr));
}

/**
 * 開始タグの属性列に、指定した名前の属性があるか。
 * @param {string} attrText
 * @param {string} name 属性名 (小文字)
 * @returns {boolean}
 */
function hasAttribute(attrText, name) {
  for (const m of attrText.matchAll(ATTRIBUTE_PATTERN)) {
    if (m[1].toLowerCase() === name) return true;
  }
  return false;
}

/** 開始タグ内の属性 1 つ (名前と、あれば `=` と値)。 */
const ATTRIBUTE_PATTERN = /([^\s"'>\/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/**
 * スクリプトの内容を `<script>` に埋め込むための属性列を返す。
 * src は UTF-8 の base64 data: URL、data-dc-file は元のファイル名 (エラー転送の読み替え用)。
 * 末尾の `//# sourceURL` で DevTools のソース一覧にも元のファイル名で出す。
 * 中身は HTML として解析されないので、`</script>` や `<!--<script>` を含んでもタグは閉じない。
 *
 * @param {string} code
 * @param {string} fileName
 * @returns {string} `src="data:..." data-dc-file="..."`
 */
export function embeddedScriptAttrs(code, fileName) {
  const sourceUrl = String(fileName).replace(/\s/g, '_'); // 空白で sourceURL が途切れないように
  const body = `${String(code ?? '')}\n//# sourceURL=${sourceUrl}`;
  return `src="data:text/javascript;charset=utf-8;base64,${utf8ToBase64(body)}" data-dc-file="${escapeAttr(fileName)}"`;
}

/**
 * 文字列を UTF-8 のバイト列として base64 にする (ブラウザと Node の両方で動く形)。
 * @param {string} text
 * @returns {string}
 */
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode の引数上限を避ける
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * `<link rel="stylesheet" href="ファイル名">` をインライン <style> に置き換える。
 * media・title など style 要素でも意味を持つ属性は引き継ぎ、link だけの属性は落とす。
 * data: URL の <link> にはしない (CSS 内の相対 url() が data: 基準になって壊れるため)。
 * @param {string} doc
 * @param {Map<string, string>} files
 * @returns {string}
 */
function inlineFileStylesheets(doc, files) {
  return doc.replace(/<link\b([^>]*)>/gi, (whole, attrText) => {
    if (!/\brel\s*=\s*(["']?)stylesheet\1/i.test(whole)) return whole;
    const m = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(whole);
    if (!m) return whole;
    const name = normalizeFileRef(m[2]);
    if (!files.has(name)) return whole;
    // disabled の link は適用されない。style には同じ意味の属性が無いので埋め込まずに残す
    if (hasAttribute(attrText, 'disabled')) return whole;
    const kept = dropAttributes(attrText.replace(/\/\s*$/, ''), LINK_ONLY_ATTRS).trim();
    return `<style${kept ? ` ${kept}` : ''}>\n${escapeStyleText(files.get(name) ?? '')}\n</style>`;
  });
}

/**
 * <link> にだけ意味がある (style 要素に移すと意味が変わるか無意味な) 属性。
 * type は style では text/css 以外だと無効になるので、内容が CSS と分かっている以上は落とす。
 */
const LINK_ONLY_ATTRS = new Set([
  'rel', 'href', 'type', 'integrity', 'crossorigin', 'referrerpolicy', 'as', 'hreflang',
  'sizes', 'fetchpriority', 'imagesrcset', 'imagesizes', 'color',
]);

/**
 * <style> の中身 (RAWTEXT) が `</style` で途中終了しないよう、CSS のエスケープ `<\/style` にする。
 * CSS では `\/` は `/` と同じ値なので、文字列やコメント内の意味は変わらない。
 * @param {string} css
 * @returns {string}
 */
function escapeStyleText(css) {
  return String(css).replace(/<\/(style)/gi, '<\\/$1');
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
