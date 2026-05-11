// プレビュー生成のオプション（高速化版）
export const PREVIEW_OPTIONS = {
  width: 1000,
  height: 1000,
  duration: 3000,
  fps: 30,
  quality: 80,
  // 高速化オプション
  fastMode: true,     // 高速モード有効
  maxColors: 128,     // パレット色数を削減（256→128）
  scaleFilter: 'fast_bilinear' // 高速スケーリングフィルター
};

// パス関連の定数（sketches.json は viewer ルートからの相対パスで持つ）
export const DEFAULT_DESCRIPTION_SUFFIX = ' スケッチ';
export const DEFAULT_PATH_PREFIX = 'sketches/';
export const PREVIEW_PATH_PREFIX = 'previews/';

// スクレイピング関連の設定
export const SCRAPING_CONFIG = {
  // OpenProcessing.orgの設定
  baseUrl: 'https://openprocessing.org',
  apiBaseUrl: 'https://openprocessing.org/api',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  
  // タイムアウト設定
  pageLoadTimeout: 30000,
  elementWaitTimeout: 10000,
  elementWaitTimeoutShort: 5000,
  pageWaitTime: 3000,
  apiRequestTimeout: 30000,
  
  // リクエスト間隔（レート制限対策）
  requestInterval: 1000,
  apiRequestIntervalMs: 1500,
  externalBrowserIntervalMs: 1000
};

// デフォルト値
export const DEFAULTS = {
  unknownUser: 'Unknown User',
  unknownTitle: 'Unknown Title'
};
