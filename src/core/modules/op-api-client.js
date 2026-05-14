// OpenProcessing Public API のクライアント。
// /api/sketch/{id} と /api/user/{id} を Node の native fetch で叩き、
// スケッチ ID の配列 → タイトル・ユーザー名・ユーザー URL などのメタデータを返す。

import { API_CONFIG, DEFAULTS } from './constants.js';

const API_TOKEN_ENV_NAMES = [
  'OPENPROCESSING_API_TOKEN',
  'OP_API_TOKEN',
  'DROPCASTER_OPENPROCESSING_API_TOKEN',
];

export class OpenProcessingApiClient {
  constructor(options = {}) {
    this.lastApiRequestAt = 0;
    this.userCache = new Map();
    this.apiToken = options.apiToken || findApiToken();
    this.apiRequestIntervalMs = Math.max(
      Number(options.apiRequestIntervalMs || API_CONFIG.apiRequestIntervalMs || 1500),
      0
    );
  }

  /** 1 スケッチぶんのメタデータを取得する（{ userId, userName, userUrl, sketchTitle, sketchId, sketchUrl } か { error, sketchId }）。 */
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
      'User-Agent': API_CONFIG.userAgent,
    };
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;

    const response = await fetch(`${API_CONFIG.apiBaseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(API_CONFIG.apiRequestTimeout),
    });
    this.lastApiRequestAt = Date.now();

    const status = response.status;
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
    const userId = normalizeString(
      user?.userID ?? user?.userId ?? user?.id ?? sketch.userID ?? sketch.userId ?? sketch.user?.userID
    );
    const userName = normalizeString(
      user?.fullname ?? user?.fullName ?? user?.name ?? user?.username ??
      sketch.fullname ?? sketch.userFullname ?? sketch.username ??
      sketch.user?.fullname ?? sketch.user?.username
    ) || DEFAULTS.unknownUser;
    return {
      userId,
      userName,
      userUrl: userId ? `${API_CONFIG.baseUrl}/user/${userId}/` : '',
      sketchTitle: normalizeString(sketch.title) || DEFAULTS.unknownTitle,
      sketchId: visualId,
      sketchUrl: `${API_CONFIG.baseUrl}/sketch/${visualId}`,
    };
  }
}

/**
 * スケッチ ID の配列を順に取得する。各要素は getSketchUserInfo の戻り値（成功 or { error, sketchId }）。
 * レート制限は client 内の waitForApiRateLimit が担うので、ここでは追加の sleep をしない。
 */
export async function fetchUserDataForSketches(sketchIds, options = {}) {
  const client = new OpenProcessingApiClient(options);
  const results = [];
  for (const sketchId of sketchIds) {
    try {
      results.push(await client.getSketchUserInfo(sketchId));
    } catch (error) {
      results.push({ error: error.message, sketchId });
    }
  }
  return results;
}

function findApiToken() {
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
