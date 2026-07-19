// dropcaster viewer のランタイム設定。
//
// 2 つの注入経路がある:
//   - ビルド時: ユーザサイト (dropcaster dev / build) が dropcaster.config.js を
//     読み、vite の define で import.meta.env.DROPCASTER_CONFIG に埋め込む
//   - 実行時: ホスト版 (apps/web) が index.html で window.__DROPCASTER_CONFIG__ を
//     設定する (こちらが優先)
//
// 設定値は startup 時に 1 度だけ解決する。getConfig() で読み出す。

export interface DropcasterConfig {
  /**
   * OpenProcessing の CDN (deckard.openprocessing.org) を proxy するベース。
   * 同一オリジン下のパス指定を推奨 (例: '/op-cdn')。絶対 URL も受け付ける。
   * 未設定なら deckard URL は書き換えない (アセット直配信、taint で投影マッピング不可)
   */
  assetProxyBaseUrl?: string;

  /**
   * OpenProcessing API のトークン。指定すれば Authorization: Bearer で送信。
   * 未指定なら無認証 (公開作品は読める、レート制限 40 req/min)。
   */
  openProcessingApiToken?: string;

  /** PWA / Service Worker を有効化するか。既定 true。 */
  enablePwa?: boolean;

  /** Service Worker のキャッシュ名サフィックス。デプロイごとに変えると古い shell が消える。 */
  cacheVersion?: string;

  /** OpenProcessingSource が許容する mode のリスト。既定は p5js と html。 */
  supportedOpModes?: string[];
}

const DEFAULTS: Required<Pick<DropcasterConfig, 'enablePwa' | 'supportedOpModes'>> = {
  enablePwa: true,
  supportedOpModes: ['p5js', 'html'],
};

declare global {
  interface Window {
    __DROPCASTER_CONFIG__?: DropcasterConfig;
  }
}

let resolved: DropcasterConfig | null = null;

/**
 * 起動時に 1 度だけ解決する。以降は cache を返す。
 * デフォルト < ビルド時注入 (dropcaster.config.js 由来) < 実行時注入
 * (window.__DROPCASTER_CONFIG__) の順で上書きする。
 */
export function getConfig(): DropcasterConfig {
  if (resolved) return resolved;
  // dropcaster dev / build が vite define で埋め込む。ホスト版や素の vite では未定義
  const buildTime = (import.meta.env.DROPCASTER_CONFIG ?? {}) as DropcasterConfig;
  const injected = (typeof window !== 'undefined' && window.__DROPCASTER_CONFIG__) || {};
  resolved = { ...DEFAULTS, ...buildTime, ...injected };
  return resolved;
}

/** テスト・ホットリロード用。通常は呼ばない。 */
export function resetConfig(): void {
  resolved = null;
}
