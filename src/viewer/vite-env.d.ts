/// <reference types="vite/client" />

// dropcaster dev / build (ユーザーギャラリー) が vite define で埋め込む。
// ホスト版 (apps/web) や素の vite dev では未定義。
interface ImportMetaEnv {
  readonly DROPCASTER_CONFIG?: import('./config').DropcasterConfig;
}
