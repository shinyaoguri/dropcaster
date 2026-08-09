// GitHub Gist API のクライアント。公開 Gist を匿名で 1 リクエスト取得する。
//
// canvastage (https://github.com/shinyaoguri/canvastage) が「Share to GitHub Gist」で
// 書き出したスケッチを dropcaster へ読み込むための経路。GET /gists/{id} は
// ファイル内容まで含めて返すので、OP のように meta と code の 2 本を叩く必要はない。
//
// Browser (viewer の GistSource) と Node (テスト) の両方から import される想定:
//   - api.github.com は Access-Control-Allow-Origin: * なので proxy は不要
//   - User-Agent は Browser だと禁止ヘッダなので付けない
//
// 認証は付けない。未認証のレート制限は 60 req/時・IP 単位で、投影用に作品を開く
// 頻度なら十分。枯渇時は GistRateLimitError にして UI 側で待ち時間を出す。

import { GIST_CONFIG } from './constants.js';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * GitHub API の未認証レート制限 (60 req/時・IP 単位) に当たったときに throw される。
 * `retryAfterMs` は x-ratelimit-reset (epoch 秒) から算出した待機時間。
 * 呼び出し側 (App.ts) はこれを catch して UI に countdown を出す。
 */
export class GistRateLimitError extends Error {
  /**
   * @param {number} retryAfterMs
   * @param {string} [message]
   */
  constructor(retryAfterMs, message) {
    super(message || `GitHub API rate-limited (per-IP). Retry after ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'GistRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Gist は取得できたが dropcaster が扱える形（index.html を含む）でなかった場合に throw される。
 * 「見つからない」とは区別して、UI で別の案内を出せるようにする。
 */
export class GistFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'GistFormatError';
  }
}

/** Gist が存在しない / 非公開 / 削除済みの場合に throw される。 */
export class GistNotFoundError extends Error {
  /** @param {string} gistId */
  constructor(gistId) {
    super(`Gist not found (or not public): ${gistId}`);
    this.name = 'GistNotFoundError';
  }
}

/**
 * 公開 Gist を取得して、扱いやすい形に正規化して返す。
 *
 * @param {string} gistId 32 桁 hex の Gist ID
 * @returns {Promise<import('./gist-api-client.js').GistData>}
 * @throws {GistNotFoundError|GistRateLimitError|GistFormatError|Error}
 */
export async function fetchGist(gistId) {
  const id = normalizeGistId(gistId);
  if (!id) throw new Error(`invalid gist id: "${gistId}"`);

  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GIST_CONFIG.apiVersion,
  };
  // User-Agent は Browser だと禁止ヘッダ。Node でだけ付ける (GitHub API は UA 必須)。
  if (!IS_BROWSER) headers['User-Agent'] = 'dropcaster';

  const response = await fetch(`${GIST_CONFIG.apiBaseUrl}/gists/${id}`, {
    headers,
    signal: AbortSignal.timeout(GIST_CONFIG.apiRequestTimeout),
  });

  if (response.status === 404) throw new GistNotFoundError(id);
  if (isRateLimited(response)) {
    throw new GistRateLimitError(rateLimitRetryAfterMs(response.headers.get('x-ratelimit-reset')));
  }
  if (!response.ok) {
    throw new Error(await formatApiError(response));
  }

  /** @type {unknown} */
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('GitHub API returned a non-JSON response');
  }
  return normalizeGist(id, data);
}

/**
 * 403 / 429 のうち、レート制限枯渇によるものかを判定する。
 * GitHub は制限超過を 403 で返し、x-ratelimit-remaining: 0 を添える
 * (secondary rate limit は 429)。権限エラーの 403 と混ぜないためヘッダで見分ける。
 *
 * @param {Response} response
 * @returns {boolean}
 */
function isRateLimited(response) {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return response.headers.get('x-ratelimit-remaining') === '0';
}

/**
 * x-ratelimit-reset (epoch 秒) を待機時間 (ms) に変換する。
 * 解釈できない / 過去の値なら 60s デフォルト。
 *
 * @param {string | null} resetHeader
 * @returns {number}
 */
function rateLimitRetryAfterMs(resetHeader) {
  const epochSec = parseInt(String(resetHeader ?? ''), 10);
  if (!Number.isFinite(epochSec)) return 60_000;
  const remaining = epochSec * 1000 - Date.now();
  return remaining > 0 ? remaining : 60_000;
}

/**
 * API レスポンスを { id, description, ownerLogin, ownerUrl, htmlUrl, updatedAt, files } に正規化する。
 * truncated なファイル (1MB 超) は内容が欠けるので受け付けない。
 *
 * @param {string} id
 * @param {unknown} data
 * @returns {import('./gist-api-client.js').GistData}
 */
function normalizeGist(id, data) {
  const gist = /** @type {Record<string, any>} */ (data);
  if (!gist || typeof gist !== 'object' || !gist.files || typeof gist.files !== 'object') {
    throw new GistFormatError('GitHub API response had no files');
  }

  /** @type {Map<string, string>} */
  const files = new Map();
  for (const file of Object.values(gist.files)) {
    if (!file || typeof file !== 'object') continue;
    const name = normalizeString(file.filename);
    if (!name) continue;
    if (file.truncated) {
      throw new GistFormatError(`file is too large to load: ${name}`);
    }
    files.set(name, String(file.content ?? ''));
  }
  if (files.size === 0) {
    throw new GistFormatError('gist has no files');
  }

  const ownerLogin = normalizeString(gist.owner?.login);
  return {
    id: normalizeString(gist.id) || id,
    description: normalizeString(gist.description),
    ownerLogin,
    ownerUrl: ownerLogin ? `${GIST_CONFIG.baseUrl}/${ownerLogin}` : '',
    htmlUrl: normalizeString(gist.html_url) || `${GIST_CONFIG.baseUrl}/${id}`,
    updatedAt: normalizeString(gist.updated_at) || normalizeString(gist.created_at),
    files,
  };
}

/**
 * Gist ID を正規化する。hex 以外が混ざっていれば空文字を返す。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeGistId(value) {
  const id = normalizeString(value).toLowerCase();
  return /^[0-9a-f]{20,}$/.test(id) ? id : '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function formatApiError(response) {
  let message = '';
  try {
    const data = await response.json();
    message = normalizeString(/** @type {Record<string, unknown>} */ (data)?.message);
  } catch { /* JSON でなければメッセージ無しで扱う */ }
  return message
    ? `GitHub API error (${response.status}): ${message}`
    : `GitHub API error (${response.status})`;
}
