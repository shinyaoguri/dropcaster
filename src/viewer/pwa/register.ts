// Service Worker の登録ロジック。main.ts に直書きされていた挙動を切り出し、
// DropcasterConfig.enablePwa を尊重するように整理。
//
// 挙動:
//   - config.enablePwa === false なら何もしない
//   - localhost / 127.0.0.1 でも登録する (開発中 PWA を試したい場合のため)。
//     ただし http (非 https) かつ localhost 以外では登録しない (SW は secure context が必要)
//   - 既存の SW があれば update を促す
//   - 新バージョンが waiting に入ったときは SKIP_WAITING を送って即時切替

import { getConfig } from '../config.js';
import { getBasePath, publicAssetPath } from '../utils/paths.js';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (getConfig().enablePwa === false) return;
  if (!isSecureOrLocalhost()) return;

  // ページロード後に登録 (起動高速化のため defer)
  if (document.readyState === 'complete') {
    queueRegister();
  } else {
    window.addEventListener('load', queueRegister, { once: true });
  }
}

function queueRegister(): void {
  void registerAndWatch();
}

async function registerAndWatch(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.register(publicAssetPath('sw.js'), {
      scope: getBasePath(),
    });
    // 既に新しい SW が waiting にいる (前回 reload で activate されなかった) ならすぐ切替
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

    // 新規 update が見つかったら waiting に入った瞬間に切替を依頼
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    // controller が swap されたタイミングで、すでに開いているページを 1 度だけ reload する
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  } catch (err) {
    console.warn('ServiceWorker registration failed:', err);
  }
}

function isSecureOrLocalhost(): boolean {
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}
