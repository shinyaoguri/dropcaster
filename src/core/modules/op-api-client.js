// OpenProcessing Public API のクライアント。
// /api/sketch/{id} / /api/sketch/{id}/code / /api/user/{id} を native fetch で叩く。
//
// Browser (viewer の OpenProcessingSource) と Node (CLI の scan / fetch) の両方から
// 同じファイルを import して使う。Browser からの利用に備えて:
//   - process.env を typeof チェック越しに参照
//   - User-Agent は Browser だと禁止ヘッダなので付けない
//   - waitForApiRateLimit と userCache はインスタンス単位 (Browser のシングルセッションには十分)

import { API_CONFIG, DEFAULTS } from './constants.js';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

// Browser コンテキストでは 1 リクエスト 0.5s ペースに自前 throttle (連打を平準化)。
// OP の per-IP 40 req/min 制限 (≒ 1.5s/req) より緩いが、SW キャッシュもあるので普段の操作で
// 当たることはまず無い。CLI (Node) はバッチ scan するので 1.5s を維持。
const DEFAULT_API_INTERVAL_MS = IS_BROWSER ? 500 : 1500;

const API_TOKEN_ENV_NAMES = [
  'OPENPROCESSING_API_TOKEN',
  'OP_API_TOKEN',
  'DROPCASTER_OPENPROCESSING_API_TOKEN',
];

/**
 * OP の per-IP レート制限 (40 req/min) に当たったときに throw される。
 * `retryAfterMs` は Retry-After ヘッダから抽出した待機時間 (ヘッダ無しの場合は 60s デフォルト)。
 * 呼び出し側 (App.ts) はこれを catch して UI に「N 秒後に再試行できます」を出す。
 */
export class OpenProcessingRateLimitError extends Error {
  constructor(retryAfterMs, message) {
    super(message || `OpenProcessing API rate-limited (per-IP). Retry after ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'OpenProcessingRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class OpenProcessingApiClient {
  constructor(options = {}) {
    this.lastApiRequestAt = 0;
    this.userCache = new Map();
    this.apiToken = options.apiToken || findApiToken();
    // options.apiRequestIntervalMs を明示指定したらそれを使う。未指定なら DEFAULT_API_INTERVAL_MS。
    const interval = options.apiRequestIntervalMs !== undefined
      ? Number(options.apiRequestIntervalMs)
      : DEFAULT_API_INTERVAL_MS;
    this.apiRequestIntervalMs = Math.max(interval, 0);
  }

  /** 1 スケッチぶんのメタデータを取得する（{ userId, userName, userUrl, sketchTitle, sketchDescription, sketchId, sketchUrl } か { error, sketchId }）。 */
  async getSketchUserInfo(sketchId) {
    const id = normalizeId(sketchId);
    try {
      const sketch = await this.apiGet(`/sketch/${id}`);
      const userId = normalizeString(sketch.userID ?? sketch.userId ?? sketch.user?.userID ?? sketch.user?.id);
      const user = userId ? await this.getUser(userId) : null;
      return this.toSketchInfo(id, sketch, user);
    } catch (error) {
      return { error: error.message, sketchId: id };
    }
  }

  /** /api/sketch/{id} の生 JSON を返す（visualID, engineURL, mode, libraries, fileBase, ...）。エラーは throw。 */
  async getSketch(sketchId) {
    const id = normalizeId(sketchId);
    return this.apiGet(`/sketch/${id}`);
  }

  /** /api/sketch/{id}/code の生 JSON 配列を返す（[{ codeID, orderID, code, title, ... }]）。エラーは throw。 */
  async getSketchCode(sketchId) {
    const id = normalizeId(sketchId);
    const data = await this.apiGet(`/sketch/${id}/code`);
    if (!Array.isArray(data)) {
      throw new Error('OpenProcessing API: /code response was not an array');
    }
    return data;
  }

  async getUser(userId) {
    const key = normalizeId(userId);
    if (!key) return null;
    if (this.userCache.has(key)) return this.userCache.get(key);
    try {
      const user = await this.apiGet(`/user/${key}`);
      this.userCache.set(key, user);
      return user;
    } catch {
      this.userCache.set(key, null);
      return null;
    }
  }

  async apiGet(path) {
    await this.waitForApiRateLimit();

    const headers = {
      Accept: 'application/json',
    };
    // User-Agent は Browser だと禁止ヘッダ。Node でだけ付ける。
    if (!IS_BROWSER) headers['User-Agent'] = API_CONFIG.userAgent;
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;

    const response = await fetch(`${API_CONFIG.apiBaseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(API_CONFIG.apiRequestTimeout),
    });
    this.lastApiRequestAt = Date.now();

    const status = response.status;

    // 429: per-IP レート制限。専用エラーを throw して上位の UI で countdown を出させる。
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      throw new OpenProcessingRateLimitError(retryAfterMs);
    }

    const text = await response.text();
    // 一旦 JSON へパースを試みる（失敗したら text のまま）。エラーボディも JSON のことが多いので
    // 4xx/5xx の前にやっておく。
    let data;
    try { data = JSON.parse(text); }
    catch { data = text; }

    if (status >= 400) throw new Error(formatApiError({ status, data }));
    if (typeof data === 'string') {
      if (data.includes('Attention Required') || data.includes('Cloudflare')) {
        throw new Error('Cloudflare response returned from Public API endpoint');
      }
      throw new Error(`OpenProcessing API returned non-JSON response (${status})`);
    }
    if (!data || typeof data !== 'object') {
      throw new Error(`OpenProcessing API returned an empty response (${status})`);
    }
    if (data.success === false) {
      throw new Error(data.message || data.error || 'OpenProcessing API request failed');
    }

    return data.object && Object.keys(data).length <= 4 ? data.object : data;
  }

  async waitForApiRateLimit() {
    if (!this.lastApiRequestAt || this.apiRequestIntervalMs <= 0) return;
    const remaining = this.apiRequestIntervalMs - (Date.now() - this.lastApiRequestAt);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }

  toSketchInfo(requestedSketchId, sketch, user) {
    const visualId = normalizeString(sketch.visualID ?? sketch.visualId ?? sketch.id) || requestedSketchId;
    // OP の URL ハンドル (@xxxxx の xxxxx)。これを userId として扱う。
    const handle = normalizeString(
      user?.username ?? sketch.username ?? sketch.user?.username
    );
    // 表示名 (アカウントの fullname)。userName として扱う。fullname が無ければハンドルを fallback。
    const displayName = normalizeString(
      user?.fullname ?? user?.fullName ?? user?.name ??
      sketch.fullname ?? sketch.userFullname ??
      sketch.user?.fullname
    );
    // 旧データ移行用 / handle 不明時の fallback URL に使う数値 ID。
    const numericUserId = normalizeString(
      user?.userID ?? user?.userId ?? user?.id ?? sketch.userID ?? sketch.userId ?? sketch.user?.userID
    );
    const userUrl = handle
      ? `${API_CONFIG.baseUrl}/@${handle}`
      : numericUserId ? `${API_CONFIG.baseUrl}/user/${numericUserId}/` : '';
    return {
      userId: handle,
      userName: displayName || handle || DEFAULTS.unknownUser,
      userUrl,
      sketchTitle: normalizeString(sketch.title) || DEFAULTS.unknownTitle,
      sketchDescription: normalizeString(sketch.description),
      sketchId: visualId,
      sketchUrl: `${API_CONFIG.baseUrl}/sketch/${visualId}`,
    };
  }
}

/**
 * スケッチ ID の配列を順に取得する。各要素は getSketchUserInfo の戻り値（成功 or { error, sketchId }）。
 * レート制限は client 内の waitForApiRateLimit が担うので、ここでは追加の sleep をしない。
 * options.onProgress({ index, total, sketchId, result }) が指定されていれば 1 件ごとに呼ぶ（進捗表示用）。
 */
export async function fetchUserDataForSketches(sketchIds, options = {}) {
  const client = new OpenProcessingApiClient(options);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const total = sketchIds.length;
  const results = [];
  for (let i = 0; i < total; i++) {
    const sketchId = sketchIds[i];
    let result;
    try {
      result = await client.getSketchUserInfo(sketchId);
    } catch (error) {
      result = { error: error.message, sketchId };
    }
    results.push(result);
    if (onProgress) {
      try { onProgress({ index: i + 1, total, sketchId, result }); }
      catch { /* 進捗 callback 内のエラーは握りつぶす（取得処理は止めない） */ }
    }
  }
  return results;
}

function findApiToken() {
  if (IS_BROWSER) return null;
  // process が無い実行環境（古い bundler 等）でも壊れないように typeof で防御
  if (typeof process === 'undefined' || !process.env) return null;
  for (const name of API_TOKEN_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function normalizeId(value) {
  return normalizeString(value).replace(/^sketch/i, '');
}

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Retry-After ヘッダを ms に変換する。秒の整数値、または HTTP-date のいずれかを許容。
 * 解釈できなければ 60s デフォルト。
 */
function parseRetryAfterMs(retryAfter) {
  if (!retryAfter) return 60_000;
  const trimmed = String(retryAfter).trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10) * 1000);
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return 60_000;
}

function formatApiError(response) {
  const data = response.data;
  if (data && typeof data === 'object') {
    return data.message || data.error || data.statusText || `OpenProcessing API error (${response.status})`;
  }
  if (typeof data === 'string' && data.trim()) {
    return `OpenProcessing API error (${response.status}): ${data.replace(/\s+/g, ' ').slice(0, 160)}`;
  }
  return `OpenProcessing API error (${response.status})`;
}
