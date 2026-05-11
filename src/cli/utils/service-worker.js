import { promises as fs } from 'fs';
import { join } from 'path';

// 最小限の Service Worker。
// 目的は「installable な PWA にする」ことだけ（ホームに追加できる / Chrome レスのウィンドウで開ける）。
// キャッシュは一切しない — 更新は即反映され、オフライン対応もしない（HTTP キャッシュはブラウザ任せ）。
// 以前あった offline_mode / cache_strategy の凝った設定は廃止した。
const SERVICE_WORKER_SOURCE = `// dropcaster — minimal service worker (installable 用、キャッシュなし)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // 外部リソースはそのまま通す
  event.respondWith(fetch(event.request));
});
`;

export async function generateServiceWorker(outputDir) {
  const swPath = join(outputDir, 'sw.js');
  await fs.writeFile(swPath, SERVICE_WORKER_SOURCE, 'utf-8');
  return swPath;
}
