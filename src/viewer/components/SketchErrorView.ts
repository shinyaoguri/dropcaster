// スケッチ読み込み失敗時のエラー画面 (404 より細かい原因表示)。
//
// 出し分け:
//   - kind: 'rate-limit'        OpenProcessing per-IP 制限。Retry-After を秒で countdown
//                               + 自動 retry callback
//   - kind: 'unsupported-mode'  p5js 以外 (processing / shader 等)。OP の作品ページへの
//                               リンクを案内
//   - kind: 'not-found'         404 / API エラー。ホームに戻る案内
//
// 視覚スタイルは既存 .container 系を流用しつつ、専用クラスは少しだけ追加。

import { routeHref } from '../utils/paths.js';
import { t, onLangChange } from '../i18n/index.js';
import { langSwitcherHtml, wireLangSwitcher } from '../i18n/LanguageSwitcher.js';

export type SketchErrorKind = 'rate-limit' | 'unsupported-mode' | 'not-found';

export interface SketchErrorOptions {
  /** rate-limit のとき: Retry-After ヘッダから抽出した待機時間 (ms) */
  retryAfterMs?: number;
  /** rate-limit のとき: countdown 完了時に呼ばれる (auto-retry) */
  onRetry?: () => void;
  /** unsupported-mode のとき: 検出された mode (例: 'processing') */
  mode?: string;
  /** unsupported-mode / not-found のとき: 元の OP 作品 URL */
  sketchUrl?: string;
  /** 任意追加メッセージ (generic な技術詳細) */
  detail?: string;
}

export class SketchErrorView {
  private static countdownTimer: number | null = null;
  private static langUnsub: (() => void) | null = null;

  static render(kind: SketchErrorKind, options: SketchErrorOptions = {}): void {
    SketchErrorView.cancelCountdown();
    SketchErrorView.langUnsub?.();
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) return;

    const paint = () => {
      switch (kind) {
        case 'rate-limit':
          SketchErrorView.renderRateLimit(app, options);
          break;
        case 'unsupported-mode':
          SketchErrorView.renderUnsupported(app, options);
          break;
        default:
          SketchErrorView.renderNotFound(app, options);
      }
      wireLangSwitcher(app);
    };

    paint();
    SketchErrorView.langUnsub = onLangChange(() => {
      // countdown は再描画でリセットされる（残り時間は inputに反映されない）が、
      // 言語切替は稀なので許容する
      if (app.querySelector('.sketch-error')) {
        SketchErrorView.cancelCountdown();
        paint();
      } else {
        SketchErrorView.langUnsub?.();
      }
    });
  }

  /** countdown timer をキャンセル (画面遷移時に呼ばれる)。 */
  static cancelCountdown(): void {
    if (SketchErrorView.countdownTimer !== null) {
      clearInterval(SketchErrorView.countdownTimer);
      SketchErrorView.countdownTimer = null;
    }
  }

  private static renderRateLimit(app: HTMLElement, opts: SketchErrorOptions): void {
    const initialSec = Math.max(1, Math.ceil((opts.retryAfterMs ?? 60_000) / 1000));
    app.innerHTML = `
      <div class="container sketch-error">
        <div class="dc-lang-corner">${langSwitcherHtml()}</div>
        <div class="sketch-error-icon">⏳</div>
        <h1 class="sketch-error-title">${t('sketchError.rateLimit.title')}</h1>
        <p class="sketch-error-message">
          ${t('sketchError.rateLimit.message')}
        </p>
        <p class="sketch-error-countdown">
          ${t('sketchError.rateLimit.countdown', {
            sec: `<span class="sketch-error-countdown-num" data-countdown>${initialSec}</span>`,
          })}
        </p>
        <div class="sketch-error-actions">
          <button type="button" class="sketch-error-button" data-retry-now>${t('sketchError.rateLimit.retryNow')}</button>
          <a href="${routeHref('/')}" class="sketch-error-link">${t('sketchError.home')}</a>
        </div>
      </div>
    `;

    const numEl = app.querySelector<HTMLElement>('[data-countdown]');
    const retryNow = app.querySelector<HTMLButtonElement>('[data-retry-now]');
    let remaining = initialSec;

    const fireRetry = () => {
      SketchErrorView.cancelCountdown();
      if (opts.onRetry) opts.onRetry();
    };

    SketchErrorView.countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (numEl) numEl.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) fireRetry();
    }, 1000);

    retryNow?.addEventListener('click', fireRetry);
  }

  private static renderUnsupported(app: HTMLElement, opts: SketchErrorOptions): void {
    const modeNote = opts.mode
      ? t('sketchError.unsupported.modeNote', { mode: escapeHtml(opts.mode) })
      : '';
    app.innerHTML = `
      <div class="container sketch-error">
        <div class="dc-lang-corner">${langSwitcherHtml()}</div>
        <div class="sketch-error-icon">⚠</div>
        <h1 class="sketch-error-title">${t('sketchError.unsupported.title')}</h1>
        <p class="sketch-error-message">
          ${t('sketchError.unsupported.message', { modeNote })}
        </p>
        <div class="sketch-error-actions">
          ${opts.sketchUrl ? `<a href="${opts.sketchUrl}" target="_blank" rel="noopener" class="sketch-error-button">${t('sketchError.unsupported.openOnOp')}</a>` : ''}
          <a href="${routeHref('/')}" class="sketch-error-link">${t('sketchError.home')}</a>
        </div>
      </div>
    `;
  }

  private static renderNotFound(app: HTMLElement, opts: SketchErrorOptions): void {
    app.innerHTML = `
      <div class="container sketch-error">
        <div class="dc-lang-corner">${langSwitcherHtml()}</div>
        <div class="sketch-error-icon">😵</div>
        <h1 class="sketch-error-title">${t('sketchError.notFound.title')}</h1>
        <p class="sketch-error-message">
          ${t('sketchError.notFound.message')}
        </p>
        ${opts.detail ? `<p class="sketch-error-detail"><code>${escapeHtml(opts.detail)}</code></p>` : ''}
        <div class="sketch-error-actions">
          ${opts.sketchUrl ? `<a href="${opts.sketchUrl}" target="_blank" rel="noopener" class="sketch-error-button">${t('sketchError.notFound.tryOnOp')}</a>` : ''}
          <a href="${routeHref('/')}" class="sketch-error-link">${t('sketchError.home')}</a>
        </div>
      </div>
    `;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
