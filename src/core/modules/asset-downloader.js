// OpenProcessing 作品のコード中の `https://deckard.openprocessing.org/...` 絶対 URL を
// 抽出し、Node の native fetch でダウンロードしてローカル相対パスに書き換える。
// `dropcaster fetch` から呼ばれる。
//
// 出力: `${outDir}/assets/<path-relative-to-deckard-host>/<filename>` に保存。
// 戻り値の Map<absUrl, relPath> を使って、呼び出し側でコード中の URL を一括置換する。

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

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
 * URL を outDir 内のローカル相対パスに変換する。
 * 例: https://deckard.openprocessing.org/user110137/visual2862331/h.../foo.png
 *   → assets/user110137/visual2862331/h.../foo.png
 */
export function localPathForUrl(absUrl) {
  if (!absUrl.startsWith(DECKARD_HOST)) return null;
  // host 以降のパス。末尾 / は念のため落とす
  const tail = absUrl.slice(DECKARD_HOST.length).replace(/\?.*$/, '');
  return `assets/${tail}`;
}

/**
 * 抽出済みの URL を全てダウンロードして outDir/assets/... に保存する。
 * @param {string[]} urls
 * @param {string} outDir
 * @param {object} [opts]
 * @param {(info: { url: string, size: number, localPath: string }) => void} [opts.onProgress]
 * @returns {Promise<Map<string,string>>}  abs URL -> ローカル相対パスの Map
 */
export async function downloadAssets(urls, outDir, opts = {}) {
  const map = new Map();
  for (const url of urls) {
    const rel = localPathForUrl(url);
    if (!rel) continue; // deckard 以外は無視
    const absPath = join(outDir, rel);
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
        try { opts.onProgress({ url, size: buf.length, localPath: rel }); } catch { /* ignore */ }
      }
    } catch (err) {
      // 1 個失敗しても処理は続ける (URL → rel が map に入らないので、書き換え時にスキップされる)
      if (opts.onProgress) {
        try { opts.onProgress({ url, size: 0, localPath: rel, error: err.message }); } catch { /* ignore */ }
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
