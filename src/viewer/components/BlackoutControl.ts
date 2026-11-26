import type { WindowController } from './WindowController';
import { t, onLangChange } from '../i18n/index.js';

/** 斜線の入った画面。スライドショーのヘッダと単独作品ページのボタンで共有する。 */
export const blackoutIcon = `<svg class="button-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M8 20.5h8M12 16.5v4M4 3l16 15"/>
</svg>`;

/**
 * メイン画面のブラックアウト操作 (#194)。編集を閉じているときのボタンと `B` キーを、
 * WindowController が持つ 1 つの状態につなぐ。編集中の入切り (「確認」パネル・帯) は ControlWindow が持つ。
 *
 * `B` は緊急操作なので編集中も効く。入力欄の中、修飾キー付き、他が処理済みのキーでは効かない。
 * 出力ウィンドウや作品の iframe で押したキーはこの document に届かないので、従来どおり作品のもの (#176)。
 */
export class BlackoutControl {
  private readonly off: (() => void)[] = [];
  private readonly wc: WindowController;
  private readonly button: HTMLButtonElement | null;

  constructor(wc: WindowController, button: HTMLButtonElement | null) {
    this.wc = wc;
    this.button = button;
    const onKey = (e: KeyboardEvent) => this.handleKeydown(e);
    const onClick = () => this.wc.toggleBlackout();
    document.addEventListener('keydown', onKey);
    button?.addEventListener('click', onClick);
    this.off.push(
      () => document.removeEventListener('keydown', onKey),
      () => button?.removeEventListener('click', onClick),
      wc.events.blackout.subscribe(() => this.render()),
      onLangChange(() => this.render()),
    );
    this.render();
  }

  private handleKeydown(e: KeyboardEvent): void {
    // 押しっぱなしの連続入力で点滅させない。
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'b' && e.key !== 'B') return;
    const target = e.target as Partial<Element> | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
    this.wc.toggleBlackout();
  }

  /** ボタンの見た目と名前を現在の状態・言語に合わせる。 */
  private render(): void {
    const button = this.button;
    if (!button) return;
    const on = this.wc.events.blackout.get();
    const label = t(on ? 'blackout.leave' : 'blackout.enter');
    button.classList.toggle('blackout-active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  dispose(): void {
    this.off.splice(0).forEach(off => off());
  }
}
