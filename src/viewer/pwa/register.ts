// Service Worker の登録と、新しい版の扱い。main.ts に直書きされていた挙動を切り出し、
// DropcasterConfig.enablePwa を尊重するように整理。
//
// 挙動:
//   - config.enablePwa === false なら何もしない
//   - localhost / 127.0.0.1 でも登録する (開発中 PWA を試したい場合のため)。
//     ただし http (非 https) かつ localhost 以外では登録しない (SW は secure context が必要)
//   - 新しい版の SW は、ブラウザ標準のライフサイクルどおり、そのオリジンのタブ・ウィンドウが
//     すべて閉じたときに有効になる。自動で切り替えたり再読み込みしたりしない (#164)。
//     上演中に再読み込みすると出力ウィンドウが閉じ、作品の映像も途切れるため
//   - 新しい版が待機しているあいだは、操作画面にだけ通知を出し、押したときだけ
//     APPLY_UPDATE_MESSAGE を送って 1 度だけ再読み込みする
//   - 遅延読み込みのチャンクが取れない (デプロイで旧版の資産が消えた) ときも、
//     自動で再読み込みせず、再読み込みを案内する (原因は断定しない)。オフラインなら接続の確認を案内する
//     (watchLazyLoadFailures)

import { getConfig } from '../config.js';
import { getBasePath, publicAssetPath } from '../utils/paths.js';
import { showUpdateNotice } from './UpdateNotice.js';

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

/**
 * 遅延読み込み (3D プレビュー・会場ページ) のチャンクが取れなかったら、再読み込みを案内する。
 * navigator.onLine が true でも外に出られない会場はあるので、新しい版か接続の不安定かは断定しない。
 * オフラインと分かるときは接続の確認を案内する。
 * 失敗そのものは各画面のエラー処理に任せる (preventDefault しない)。SW の有無によらず、
 * 開いたままのページが旧版の資産を参照していれば起きるので、登録とは別に受ける。
 */
export function watchLazyLoadFailures(): void {
  window.addEventListener('vite:preloadError', () => {
    showUpdateNotice(navigator.onLine === false ? 'offline' : 'loadFailed', reloadPage);
  });
}

/**
 * 新しい版の SW に適用を頼むメッセージ (sw-template.js の APPLY_UPDATE_MESSAGE と同じ値)。
 * SKIP_WAITING ではない: それはこの変更より前の版のページが自動で送るので、SW が受けない。
 */
const APPLY_UPDATE_MESSAGE = 'DC_APPLY_UPDATE';

let registration: ServiceWorkerRegistration | null = null;
/** 利用者が通知で適用を選んだ。新しい版が制御を握ったら 1 度だけ再読み込みする。 */
let applyRequested = false;

function queueRegister(): void {
  void registerAndWatch();
}

async function registerAndWatch(): Promise<void> {
  try {
    // 初回訪問では controller が無く、有効化 (clients.claim) で controllerchange が起きる。
    // これは更新ではないので通知も再読み込みもしない。
    let controlled = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applyRequested) {
        applyRequested = false;
        reloadPage();
        return;
      }
      if (!controlled) {
        controlled = true;
        return;
      }
      // 別のタブで新しい版が適用された。このページは旧版の資産のまま動いているので案内する
      showUpdateNotice('reload', reloadPage);
    });

    const reg = await navigator.serviceWorker.register(publicAssetPath('sw.js'), {
      scope: getBasePath(),
    });
    registration = reg;
    // 前回までに見つかった新しい版が、まだ待機している
    notifyIfWaiting(reg);
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') notifyIfWaiting(reg);
      });
    });
  } catch (err) {
    console.warn('ServiceWorker registration failed:', err);
  }
}

/** 旧版が制御している操作画面で、新しい版が待機していれば通知する。 */
function notifyIfWaiting(reg: ServiceWorkerRegistration): void {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateNotice('update', applyUpdate);
}

function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) {
    reloadPage();
    return;
  }
  applyRequested = true;
  waiting.postMessage({ type: APPLY_UPDATE_MESSAGE });
}

function reloadPage(): void {
  window.location.reload();
}

function isSecureOrLocalhost(): boolean {
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}
