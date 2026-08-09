// 入力文字列から「どの取り込み元の、どの作品か」を解決する純粋関数。
//
// viewer の入力欄 (OpIdEntryView) と router が同じ規則を共有する。DOM にも
// 設定にも依存しないので、Node 側からテストできるよう core に置く。
//
// OpenProcessing の作品 ID は 10 進数 (7〜8 桁)、Gist の ID は 16 進数 (20 桁以上) で
// 空間が重ならないため、1 つの入力欄で両方を受けられる。

/** @typedef {import('./sketch-ref.js').SketchRef} SketchRef */

/**
 * OpenProcessing の作品 ID (数値) を抽出する。
 * 数値そのもの、"sketch<id>"、OP の作品 URL を受け付ける。
 * URL は旧形式 (https://openprocessing.org/sketch/<id>) と
 * 新形式 (https://openprocessing.org/@<username>/<id>) の両方に対応。
 *
 * @param {string} raw
 * @returns {string | null} 抽出不能なら null
 */
export function parseOpId(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  // OP の URL から抽出: /sketch/<digits> または /@<username>/<digits>
  const urlMatch = text.match(/openprocessing\.org\/(?:sketch\/|@[^/]+\/)(\d+)/i);
  if (urlMatch) return urlMatch[1];
  // "sketch<id>" 形式
  const prefixMatch = text.match(/^sketch(\d+)$/i);
  if (prefixMatch) return prefixMatch[1];
  // 純粋な数値
  if (/^\d+$/.test(text)) return text;
  return null;
}

/**
 * 公開 Gist の ID (hex) を抽出する。
 * Gist の URL (owner 有無どちらも) と生 ID を受け付ける。
 *
 * @param {string} raw
 * @returns {string | null} 抽出不能なら null
 */
export function parseGistId(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  // gist.github.com の URL から抽出。ID の後ろに revision (/<sha>) が続くこともある
  const urlMatch = text.match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{20,})/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  // 生 ID (canvastage が扱うのは 32 桁 hex)
  if (/^[0-9a-f]{20,}$/i.test(text)) return text.toLowerCase();
  return null;
}

/**
 * 入力文字列を作品参照へ解決する。
 *
 * Gist を先に見る: 20 桁以上の数字だけの入力は OP の ID 桁数ではありえないので、
 * 全桁が数字の Gist ID を OP と誤認しないようにする (逆方向の誤認は起きない —
 * OP の ID や URL は 20 桁以上の hex にマッチしない)。
 *
 * @param {string} raw
 * @returns {SketchRef | null} 抽出不能なら null
 */
export function parseSketchRef(raw) {
  const gistId = parseGistId(raw);
  if (gistId) return { source: 'gist', id: gistId };
  const opId = parseOpId(raw);
  if (opId) return { source: 'op', id: opId };
  return null;
}
