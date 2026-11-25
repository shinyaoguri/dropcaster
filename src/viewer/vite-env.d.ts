/// <reference types="vite/client" />

// dropcaster dev / build (ユーザーギャラリー) が vite define で埋め込む。
// ホスト版 (apps/web) や素の vite dev では未定義。
interface ImportMetaEnv {
  readonly DROPCASTER_CONFIG?: import('./config').DropcasterConfig;
  // src/core/build-info.js が求めた版。dropcaster dev / build・ホスト版・このリポの vite で埋め込む。
  readonly DROPCASTER_BUILD?: import('./utils/buildInfo').BuildInfo;
  // dev サーバ (dropcaster dev・このリポの vite / dev:web) が src/cli/utils/dev-service-worker.js で埋め込む。
  // 本番ビルドでは未定義。
  readonly DROPCASTER_DEV_SERVER?: boolean;
}
