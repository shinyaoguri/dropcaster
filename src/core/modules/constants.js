// プレビュー GIF 生成のオプション
export const PREVIEW_OPTIONS = {
  width: 1000,
  height: 1000,
  duration: 3000,            // キャプチャ尺（ms）
  fps: 30,                   // キャプチャ fps
  quality: 80,
  maxColors: 128,            // GIF パレット色数（256 → 128 で軽量化）
  scaleFilter: 'fast_bilinear', // ffmpeg スケーリングフィルタ
};

// パス関連の定数（sketches.json は viewer ルートからの相対パスで持つ）
export const DEFAULT_DESCRIPTION_SUFFIX = ' スケッチ';
export const DEFAULT_PATH_PREFIX = 'sketches/';
export const PREVIEW_PATH_PREFIX = 'previews/';

// 各スケッチディレクトリに置ける手動メタデータ（一カ所で定義）
export const MANUAL_METADATA_FILE = 'dropcaster.meta.json';
export const MANUAL_METADATA_TEMPLATE_FILE = 'dropcaster.meta.example.json';

// OpenProcessing Public API クライアントの設定
export const API_CONFIG = {
  baseUrl: 'https://openprocessing.org',
  apiBaseUrl: 'https://openprocessing.org/api',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  apiRequestTimeout: 30000,
  apiRequestIntervalMs: 1500, // レート制限対策：API リクエスト間隔の下限（ms）
};

// GitHub Gist クライアントの設定（canvastage が書き出した公開 Gist を読む）
export const GIST_CONFIG = {
  baseUrl: 'https://gist.github.com',
  apiBaseUrl: 'https://api.github.com',
  apiVersion: '2022-11-28',
  apiRequestTimeout: 30000,
};

// デフォルト値
export const DEFAULTS = {
  unknownUser: 'Unknown User',
  unknownTitle: 'Unknown Title',
};
