// 新しい版の通知 (#164)。操作画面 (viewer を読み込んだ document) にだけ出す。
// 出力ウィンドウは about:blank の別 document なので、ここで足す要素は映らない。
//
//   update  新しい版の SW が待機している。押すと適用して再読み込みする
//   reload  このページは旧版のまま、新しい版がすでに出ている (遅延読み込みの失敗・別タブでの適用)。
//           押すと再読み込みする
//   offline オフラインで遅延読み込みの画面が取れなかった。接続を確かめてから再読み込みしてもらう
//
// どれも押したときだけ再読み込みする。上演中に勝手に再読み込みすると出力ウィンドウが閉じるため。

import './updateNotice.css';
import { onLangChange, t, type MessageKey } from '../i18n/index.js';

export type UpdateNoticeState = 'update' | 'reload' | 'offline';

const TEXT: Record<UpdateNoticeState, MessageKey> = { update: 'pwa.available', reload: 'pwa.reloadRequired', offline: 'pwa.offline' };

let element: HTMLElement | null = null;
let state: UpdateNoticeState | null = null;
let reloadAction: (() => void) | null = null;
let langUnsub: (() => void) | null = null;

/** 通知を出す (出ていれば内容を差し替える)。reload は押されたときに呼ぶ。 */
export function showUpdateNotice(next: UpdateNoticeState, reload: () => void): void {
  // 読み込めなかったことの案内 (reload / offline) を、待機中の版の案内 (update) で弱めない
  if (state && state !== 'update' && next === 'update' && element) return;
  state = next;
  reloadAction = reload;
  if (!element) element = mount();
  render();
}

function mount(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'dc-update-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="dc-update-notice-text"></span>'
    + '<button type="button" data-action="reload"></button>'
    + '<button type="button" data-action="dismiss">×</button>';
  el.querySelector('[data-action="reload"]')!.addEventListener('click', () => reloadAction?.());
  el.querySelector('[data-action="dismiss"]')!.addEventListener('click', dismiss);
  document.body.append(el);
  langUnsub = onLangChange(render);
  return el;
}

function dismiss(): void {
  element?.remove();
  element = null;
  state = null;
  langUnsub?.();
  langUnsub = null;
}

function render(): void {
  if (!element || !state) return;
  element.dataset.state = state;
  element.querySelector('.dc-update-notice-text')!.textContent = t(TEXT[state]);
  const reload = element.querySelector<HTMLButtonElement>('[data-action="reload"]')!;
  reload.textContent = t(state === 'update' ? 'pwa.apply' : 'pwa.reload');
  reload.title = t('pwa.applyHint');
  const close = element.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!;
  close.title = t('pwa.dismiss');
  close.setAttribute('aria-label', t('pwa.dismiss'));
}
