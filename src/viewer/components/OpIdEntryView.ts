// 外部ソースの作品参照 (OpenProcessing 作品 ID / 公開 Gist) を入力して読み込ませる UI。
//
// 2 つのレンダリングモードを持つ:
//   renderHero(onSubmit)   ローカル catalog が空 (ホスト版) のときのメイン画面。
//                          画面中央の大きな入力欄。
//   renderInline(container, onSubmit)
//                          ギャラリーの上に出す小さな入力バー。
//
// どちらも submit 時に parseSketchRef() で参照を解決し、onSubmit(ref) を呼ぶ。
// OP は数値 ID / "sketch<id>" / 作品 URL、Gist は 32 桁 hex の ID / Gist URL を
// 受ける。ID 空間が重ならない (数字 vs 20 桁以上 hex) ので入力欄は 1 つで足りる。

import { t, onLangChange } from '../i18n/index.js';
import { langSwitcherHtml, wireLangSwitcher } from '../i18n/LanguageSwitcher.js';
import { getConfig } from '../config.js';
import { parseSketchRef } from '../../core/modules/sketch-ref.js';
import type { SketchRef } from '../../core/modules/sketch-ref.js';

export type { SketchRef } from '../../core/modules/sketch-ref.js';

function heroHtml(): string {
  return `
  <div class="container op-hero-container">
    <div class="dc-lang-corner">${langSwitcherHtml()}</div>
    <header class="op-hero-header">
      <h1 class="op-hero-title">dropcaster</h1>
      <p class="op-hero-subtitle">${t('op.hero.subtitle')}</p>
    </header>
    <form class="op-id-form op-id-form--hero" novalidate>
      <label class="op-id-label" for="op-id-input-hero">${t('op.label')}</label>
      <div class="op-id-row">
        <input
          id="op-id-input-hero"
          class="op-id-input"
          name="op-id"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="${t('op.placeholder.hero')}"
          required
        >
        <button type="submit" class="op-id-submit">${t('op.submit.hero')}</button>
      </div>
      <p class="op-id-error" hidden>${t('op.error.invalid')}</p>
    </form>
    <footer class="op-hero-footer">
      <p>${t(getConfig().assetProxyBaseUrl ? 'op.hero.footer' : 'op.hero.footer.noProxy')}
        <span class="op-hero-help" tabindex="0" aria-label="${t('op.hero.help.label')}">?<span
          class="op-hero-help-tip" role="tooltip">${t(getConfig().assetProxyBaseUrl ? 'op.hero.help.cases' : 'op.hero.help.cases.noProxy')}</span></span>
      </p>
      <p class="op-hero-credit">
        ${t('footer.copyright', { year: new Date().getFullYear() })} ·
        <a href="https://github.com/shinyaoguri/dropcaster/blob/main/LICENSE" target="_blank" rel="noopener">${t('footer.license')}</a> ·
        <a href="https://github.com/shinyaoguri/dropcaster" target="_blank" rel="noopener">${t('footer.github')}</a>
      </p>
    </footer>
  </div>
`;
}

function inlineHtml(): string {
  return `
  <form class="op-id-form op-id-form--inline" novalidate>
    <input
      class="op-id-input"
      name="op-id"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      placeholder="${t('op.placeholder.inline')}"
      required
    >
    <button type="submit" class="op-id-submit">${t('op.submit.inline')}</button>
  </form>
`;
}

export class OpIdEntryView {
  private static heroLangUnsub: (() => void) | null = null;

  /** catalog が空のときのメイン画面として #app 全体を埋める。 */
  static renderHero(onSubmit: (ref: SketchRef) => void): void {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) return;
    OpIdEntryView.heroLangUnsub?.();
    const paint = () => {
      app.innerHTML = heroHtml();
      OpIdEntryView.wireForm(app, onSubmit);
      wireLangSwitcher(app);
      // フォーカスは hero モードのときだけ自動付与 (inline はギャラリー閲覧を邪魔したくない)
      app.querySelector<HTMLInputElement>('.op-id-input')?.focus();
    };
    paint();
    OpIdEntryView.heroLangUnsub = onLangChange(() => {
      // 別 view へ遷移していたら #app の中身が違うので何もしない
      if (app.querySelector('.op-hero-container')) paint();
      else OpIdEntryView.heroLangUnsub?.();
    });
  }

  /** ギャラリー UI 内などに小さな入力バーを差し込む。 */
  static renderInline(container: HTMLElement, onSubmit: (ref: SketchRef) => void): void {
    container.insertAdjacentHTML('beforeend', inlineHtml());
    OpIdEntryView.wireForm(container, onSubmit);
  }

  /** インライン形式の HTML 文字列を返す（既存テンプレに埋め込み用）。 */
  static inlineHtml(): string {
    return inlineHtml();
  }

  /** scope 内の最後の .op-id-form を 1 つだけ wire する。重複バインドはしない。 */
  static wireForm(scope: HTMLElement, onSubmit: (ref: SketchRef) => void): void {
    const form = scope.querySelector<HTMLFormElement>('.op-id-form:not([data-wired])');
    if (!form) return;
    form.setAttribute('data-wired', 'true');
    const input = form.querySelector<HTMLInputElement>('.op-id-input');
    const error = form.querySelector<HTMLElement>('.op-id-error');
    if (!input) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = parseSketchRef(input.value);
      if (ref) {
        error?.setAttribute('hidden', '');
        input.classList.remove('op-id-input--invalid');
        onSubmit(ref);
      } else {
        error?.removeAttribute('hidden');
        input.classList.add('op-id-input--invalid');
        input.focus();
        input.select();
      }
    });
    input.addEventListener('input', () => {
      input.classList.remove('op-id-input--invalid');
      error?.setAttribute('hidden', '');
    });
  }
}
