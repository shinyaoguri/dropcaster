// OpenProcessing 作品のコード中の `https://deckard.openprocessing.org/...` 絶対 URL を
// 抽出し、Node の native fetch でダウンロードしてローカル相対パスに書き換える。
// `dropcaster fetch` から呼ばれる。
//
// 出力: `${outDir}/assets/<path-relative-to-deckard-host>/<filename>` に保存。
// 戻り値の Map<absUrl, relPath> を使って、呼び出し側でコード中の URL を一括置換する。

import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';

const DECKARD_HOST = 'https://deckard.openprocessing.org/';

/**
 * 指定 codeTabs の中に現れる deckard 絶対 URL を抽出する (重複除去済み配列を返す)。
 * 抽出は素朴な正規表現 (シングルクオート / ダブルクオート で囲まれた絶対 URL を拾う)。
 * テンプレリテラルや動的連結には対応していない (典型的な OP コードでは出現頻度が低いため)。
 */
export function extractDeckardUrls(codeTabs) {
  const urls = new Set();
  const pattern = /https:\/\/deckard\.openprocessing\.org\/[^\s'"`<>]+/g;
  for (const tab of codeTabs || []) {
    const code = tab && tab.code;
    if (typeof code !== 'string') continue;
    const matches = code.match(pattern);
    if (matches) for (const u of matches) urls.add(u);
  }
  return [...urls];
}

/**
 * URL を、outDir 内の保存先 (filePath) と、コードに書く参照 URL (urlPath) の組に変換する。
 * どちらも outDir からの相対で `/` 区切り。
 * 例: https://deckard.openprocessing.org/u1/v2/h3/a%20b.png
 *   → { filePath: 'assets/u1/v2/h3/a b.png', urlPath: 'assets/u1/v2/h3/a%20b.png' }
 *
 * 配信サーバは参照 URL をデコードしてからファイルを探すので、保存名はデコード後の名前にし、
 * 参照はその名前をエンコードし直したものにする (#114)。参照に残る `%XX` は、Vite (sirv) の
 * decodeURI でも decodeURIComponent でも同じ文字に戻るものだけになる。ASCII だけの名前は
 * 保存名・参照とも従来と同じ。
 *
 * デコード後の名前は Unicode の NFC に揃える。macOS は NFC と NFD の名前を同じファイルとして
 * 扱う一方、Vite (dev の public 配信・preview) はディレクトリに実在する名前と文字列で照合する。
 * 同じ名前が NFC と NFD の両方で参照されると、後から保存した側の参照が 404 になる (#114 で実測)。
 *
 * デコードに失敗する名前、デコード後にパス区切り (`/` `\`)・NUL・`.` `..` になる名前は
 * 拒否する (パストラバーサルと意図しないサブディレクトリを防ぐ)。`#` `?` を含む名前も、
 * decodeURI はデコードせず decodeURIComponent はデコードするので、サーバによって参照先が
 * 割れる。どの名前で保存しても全サーバで解決できないので拒否する。拒否した URL は
 * 書き換えずに絶対 URL のまま残る。
 *
 * @param {string} absUrl
 * @returns {{ filePath: string, urlPath: string } | null}
 */
export function assetPathsForUrl(absUrl) {
  if (!absUrl.startsWith(DECKARD_HOST)) return null;
  // URL として解釈してパスを正規化する（`../` や `%2e%2e` はここでドット
  // セグメントとして解決される）。生文字列をそのまま join に渡すと
  // outDir 外への書き込み (パストラバーサル) が成立してしまう。
  let pathname;
  try {
    pathname = new URL(absUrl).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const names = [];
  for (const segment of segments) {
    let name;
    try {
      name = decodeURIComponent(segment).normalize('NFC');
    } catch {
      return null;
    }
    if (name === '.' || name === '..' || /[/\\\0#?]/.test(name)) return null;
    names.push(name);
  }
  return {
    filePath: `assets/${names.join('/')}`,
    urlPath: `assets/${names.map(encodePathSegment).join('/')}`,
  };
}

/**
 * デコード済みのファイル名を、URL のパス 1 セグメントとしてエンコードする。
 * URL の解析と同じ規則 (空白・非 ASCII などを `%XX` に、`@` `+` などはそのまま) に、
 * `%` 自体のエスケープを加える。`/` `\` `#` `?` は呼び出し側で拒否済み。
 * @param {string} name
 */
function encodePathSegment(name) {
  return new URL(`https://h/${name.replace(/%/g, '%25')}`).pathname.slice(1);
}

/**
 * URL を、コード中で参照するローカル相対 URL に変換する (assetPathsForUrl の urlPath)。
 * 例: https://deckard.openprocessing.org/user110137/visual2862331/h.../foo.png
 *   → assets/user110137/visual2862331/h.../foo.png
 * @param {string} absUrl
 * @returns {string | null}
 */
export function localPathForUrl(absUrl) {
  return assetPathsForUrl(absUrl)?.urlPath ?? null;
}

/**
 * 抽出済みの URL を全てダウンロードして outDir/assets/... に保存する。
 * @param {string[]} urls
 * @param {string} outDir
 * @param {object} [opts]
 * @param {(info: { url: string, size: number, localPath: string, error?: string }) => void} [opts.onProgress]
 *   localPath は保存先 (outDir からの相対パス)
 * @returns {Promise<Map<string,string>>}  abs URL -> コードに書くローカル相対 URL の Map
 */
export async function downloadAssets(urls, outDir, opts = {}) {
  const map = new Map();
  for (const url of urls) {
    const paths = assetPathsForUrl(url);
    if (!paths) continue; // deckard 以外・不正パス・どのサーバでも同じファイルを指せない名前は無視
    const { filePath, urlPath: rel } = paths;
    const absPath = resolve(outDir, filePath);
    // 念のための最終防衛: 解決後パスが outDir/assets 配下に収まることを確認
    if (!absPath.startsWith(resolve(outDir, 'assets') + sep)) continue;
    try {
      await mkdir(dirname(absPath), { recursive: true });
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(absPath, buf);
      map.set(url, rel);
      if (opts.onProgress) {
        try { opts.onProgress({ url, size: buf.length, localPath: filePath }); } catch { /* ignore */ }
      }
    } catch (err) {
      // 1 個失敗しても処理は続ける (URL → rel が map に入らないので、書き換え時にスキップされる)
      if (opts.onProgress) {
        try { opts.onProgress({ url, size: 0, localPath: filePath, error: err.message }); } catch { /* ignore */ }
      }
    }
  }
  return map;
}

/**
 * code 文字列内の deckard 絶対 URL を、map にある場合は相対パスに書き換える。
 * map に無い URL はそのまま残す (絶対 URL のままなのでオフライン再生はできない)。
 */
export function rewriteCodeWithAssetMap(code, map) {
  if (!map || map.size === 0 || typeof code !== 'string') return code;
  let out = code;
  for (const [abs, rel] of map.entries()) {
    out = out.split(abs).join(rel);
  }
  return out;
}
