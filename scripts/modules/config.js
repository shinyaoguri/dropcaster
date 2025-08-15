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

// パス関連の定数
export const DEFAULT_DESCRIPTION_SUFFIX = ' スケッチ';
export const DEFAULT_PATH_PREFIX = '../sketches/';
export const PREVIEW_PATH_PREFIX = '../previews/';
export const AVATAR_PATH_PREFIX = '../avatars/';

// スクレイピング関連の設定
export const SCRAPING_CONFIG = {
  // OpenProcessing.orgの設定
  baseUrl: 'https://openprocessing.org',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  
  // タイムアウト設定
  pageLoadTimeout: 30000,
  elementWaitTimeout: 10000,
  elementWaitTimeoutShort: 5000,
  pageWaitTime: 3000,
  
  // リクエスト間隔（レート制限対策）
  requestInterval: 1000,
  
  // アバター画像設定
  avatarDownloadTimeout: 10000,
  avatarDirectory: './public/avatars'
};

// ファイル拡張子マッピング
export const CONTENT_TYPE_EXTENSIONS = {
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg'
};

// デフォルト値
export const DEFAULTS = {
  extension: '.jpg',
  unknownUser: 'Unknown User',
  unknownTitle: 'Unknown Title'
};
