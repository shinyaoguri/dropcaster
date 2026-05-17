// ホスト版 dropcaster (apps/web) のビルド設定。
//
// メインの vite.config.ts はユーザサイトテンプレ用 (catalog 起点)。こちらは:
//   - root を apps/web に置く (apps/web/index.html がエントリ)
//   - viewer の src/viewer/main.ts は ../../ で参照 (fs.allow に project root を入れる)
//   - publicDir は apps/web/public (CNAME / manifest.json / icon.svg をここに置く)
//   - sketches.json は同梱しない (空 catalog → OpIdEntryView.renderHero がデフォルト顔)
//   - base は '/' (dropcaster.soui.dev のルートに置く前提)

import { defineConfig } from 'vite';
import { resolve } from 'path';

const projectRoot = resolve(__dirname, '..', '..');

export default defineConfig({
  root: __dirname,
  base: '/',
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  },
  server: {
    port: 5175,
    strictPort: true,
    fs: {
      // src/viewer / src/core (project root 配下) を参照させるため明示的に許可
      allow: [__dirname, projectRoot],
    },
    // dev (npm run dev:web) では Worker が居ないので、本番と同じく /op-cdn/* を
    // deckard.openprocessing.org に proxy しつつ Access-Control-Allow-Origin を
    // 付ける。本番では同じ URL が Worker の fetch handler に当たる。
    proxy: {
      '/op-cdn': {
        target: 'https://deckard.openprocessing.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/op-cdn/, ''),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['access-control-allow-origin'] = '*';
            proxyRes.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
            delete proxyRes.headers['vary'];
          });
        },
      },
    },
  },
  build: {
    target: 'esnext',
    modulePreload: false,
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
