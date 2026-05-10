import axios from 'axios';
import { spawn } from 'child_process';
import { SCRAPING_CONFIG, DEFAULTS } from './config.js';

const API_TOKEN_ENV_NAMES = [
  'OPENPROCESSING_API_TOKEN',
  'OP_API_TOKEN',
  'DROPCASTER_OPENPROCESSING_API_TOKEN'
];

export class OpenProcessingScraper {
  constructor(options = {}) {
    this.lastExternalBrowserOpenAt = 0;
    this.lastApiRequestAt = 0;
    this.userCache = new Map();
    this.options = {
      externalBrowser: Boolean(options.externalBrowser),
      apiToken: options.apiToken || findApiToken(),
      apiRequestIntervalMs: Math.max(
        Number(options.apiRequestIntervalMs || SCRAPING_CONFIG.apiRequestIntervalMs || 1500),
        0
      ),
      externalBrowserIntervalMs: Math.max(
        Number(options.externalBrowserIntervalMs || SCRAPING_CONFIG.externalBrowserIntervalMs || 1000),
        1000
      )
    };
  }

  async init() {
    if (this.options.externalBrowser) {
      console.error('🌐 External browser mode: OSの既定ブラウザでOpenProcessingを開きます');
      console.error('   Public API取得は行わず、手動メタデータ用の雛形を作成します');
      return;
    }

    console.error('🌐 OpenProcessing Public API mode: /api/sketch と /api/user からメタデータを取得します');
    if (this.options.apiToken) {
      console.error('🔑 OpenProcessing API token: Authorization headerを使用します');
    } else {
      console.error('🔓 OpenProcessing API token: 未設定です。公開データのみtokenなしで取得します');
      console.error(`   tokenが必要な場合は ${API_TOKEN_ENV_NAMES[0]} に設定してください`);
    }
  }

  async close() {
    // Public API mode does not keep browser or socket resources open.
  }

  async getSketchUserInfo(sketchId) {
    const normalizedSketchId = normalizeId(sketchId);
    const sketchUrl = `${SCRAPING_CONFIG.baseUrl}/sketch/${normalizedSketchId}`;

    if (this.options.externalBrowser) {
      await this.waitForExternalBrowserInterval(sketchId);
      await openExternalBrowser(sketchUrl);
      this.lastExternalBrowserOpenAt = Date.now();
      return {
        error: 'Opened in external browser. Fill dropcaster.meta.json manually.',
        sketchId
      };
    }

    try {
      console.error(`🔍 [${normalizedSketchId}] Public APIからスケッチ情報を取得中...`);
      const sketch = await this.apiGet(`/sketch/${normalizedSketchId}`);
      const userId = normalizeString(sketch.userID ?? sketch.userId ?? sketch.user?.userID ?? sketch.user?.id);
      const user = userId ? await this.getUser(userId) : null;
      const sketchInfo = this.toSketchInfo(normalizedSketchId, sketch, user);

      console.error(
        `✅ [${normalizedSketchId}] API取得完了: "${sketchInfo.sketchTitle}" by ${sketchInfo.userName}`
      );

      return sketchInfo;
    } catch (error) {
      console.error(`❌ [${normalizedSketchId}] Public API取得エラー:`, error.message);
      return { error: error.message, sketchId: normalizedSketchId };
    }
  }

  async getUser(userId) {
    const key = normalizeId(userId);
    if (!key) return null;
    if (this.userCache.has(key)) {
      return this.userCache.get(key);
    }

    try {
      console.error(`👤 [user ${key}] Public APIからユーザー情報を取得中...`);
      const user = await this.apiGet(`/user/${key}`);
      this.userCache.set(key, user);
      return user;
    } catch (error) {
      console.error(`⚠️ [user ${key}] ユーザー情報の取得に失敗: ${error.message}`);
      this.userCache.set(key, null);
      return null;
    }
  }

  async apiGet(path) {
    await this.waitForApiRateLimit();

    const url = `${SCRAPING_CONFIG.apiBaseUrl}${path}`;
    const headers = {
      Accept: 'application/json',
      'User-Agent': SCRAPING_CONFIG.userAgent
    };

    if (this.options.apiToken) {
      headers.Authorization = `Bearer ${this.options.apiToken}`;
    }

    const response = await axios.get(url, {
      headers,
      timeout: SCRAPING_CONFIG.apiRequestTimeout,
      responseType: 'json',
      transformResponse: [
        (data) => {
          if (typeof data !== 'string' || data.length === 0) return data;
          try {
            return JSON.parse(data);
          } catch {
            return data;
          }
        }
      ],
      validateStatus: () => true
    });
    this.lastApiRequestAt = Date.now();

    if (response.status >= 400) {
      throw new Error(formatApiError(response));
    }

    if (typeof response.data === 'string') {
      if (response.data.includes('Attention Required') || response.data.includes('Cloudflare')) {
        throw new Error('Cloudflare response returned from Public API endpoint');
      }
      throw new Error(`OpenProcessing API returned non-JSON response (${response.status})`);
    }

    if (!response.data || typeof response.data !== 'object') {
      throw new Error(`OpenProcessing API returned an empty response (${response.status})`);
    }

    if (response.data.success === false) {
      throw new Error(response.data.message || response.data.error || 'OpenProcessing API request failed');
    }

    return response.data.object && Object.keys(response.data).length <= 4
      ? response.data.object
      : response.data;
  }

  async waitForApiRateLimit() {
    if (!this.lastApiRequestAt || this.options.apiRequestIntervalMs <= 0) {
      return;
    }

    const elapsed = Date.now() - this.lastApiRequestAt;
    const remaining = this.options.apiRequestIntervalMs - elapsed;
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }

  toSketchInfo(requestedSketchId, sketch, user) {
    const visualId = normalizeString(sketch.visualID ?? sketch.visualId ?? sketch.id) || requestedSketchId;
    const userId = normalizeString(user?.userID ?? user?.userId ?? user?.id ?? sketch.userID ?? sketch.userId ?? sketch.user?.userID);
    const userName = normalizeString(
      user?.fullname ??
      user?.fullName ??
      user?.name ??
      user?.username ??
      sketch.fullname ??
      sketch.userFullname ??
      sketch.username ??
      sketch.user?.fullname ??
      sketch.user?.username
    ) || DEFAULTS.unknownUser;
    return {
      userId,
      userName,
      userUrl: userId ? `${SCRAPING_CONFIG.baseUrl}/user/${userId}/` : '',
      sketchTitle: normalizeString(sketch.title) || DEFAULTS.unknownTitle,
      sketchId: visualId,
      sketchUrl: `${SCRAPING_CONFIG.baseUrl}/sketch/${visualId}`
    };
  }

  async waitForExternalBrowserInterval(sketchId) {
    if (!this.lastExternalBrowserOpenAt) {
      return;
    }

    const elapsed = Date.now() - this.lastExternalBrowserOpenAt;
    const remaining = this.options.externalBrowserIntervalMs - elapsed;
    if (remaining <= 0) {
      return;
    }

    console.error(`⏱️ [${sketchId}] 次のブラウザ起動まで${remaining}ms待機します`);
    await new Promise(resolve => setTimeout(resolve, remaining));
  }
}

function findApiToken() {
  for (const name of API_TOKEN_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
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
    const oneLine = data.replace(/\s+/g, ' ').slice(0, 160);
    return `OpenProcessing API error (${response.status}): ${oneLine}`;
  }
  return `OpenProcessing API error (${response.status})`;
}

async function openExternalBrowser(url) {
  const command = getOpenCommand(url);
  console.error(`🌐 OpenProcessingを既定ブラウザで開きます: ${url}`);

  if (!command) {
    console.error(`   ブラウザを自動で開けない環境です。手元のブラウザでこのURLを開いてください: ${url}`);
    return;
  }

  await new Promise((resolveOpen) => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (error) => {
      console.error(`   ブラウザ起動に失敗しました: ${error.message}`);
      console.error(`   手元のブラウザでこのURLを開いてください: ${url}`);
      resolveOpen();
    });

    child.on('spawn', () => {
      child.unref();
      resolveOpen();
    });
  });
}

function getOpenCommand(url) {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] };
  }

  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }

  if (process.platform === 'linux') {
    return { command: 'xdg-open', args: [url] };
  }

  return null;
}
