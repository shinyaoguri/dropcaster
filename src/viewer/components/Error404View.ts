import { routeHref } from '../utils/paths.js';
import { t, onLangChange } from '../i18n/index.js';
import { langSwitcherHtml, wireLangSwitcher } from '../i18n/LanguageSwitcher.js';

export class Error404View {
  private static langUnsub: (() => void) | null = null;

  static render(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    Error404View.langUnsub?.();

    const paint = () => {
      app.innerHTML = `
      <div class="container error-page">
        <div class="dc-lang-corner">${langSwitcherHtml()}</div>
        <h1 class="error-title">${t('error404.title')}</h1>
        <p class="error-message">${t('error404.message')}</p>
        <a href="${routeHref('/')}" class="error-link">${t('error404.backLink')}</a>
      </div>
    `;
      wireLangSwitcher(app);
    };
    paint();
    Error404View.langUnsub = onLangChange(() => {
      if (app.querySelector('.error-page')) paint();
      else Error404View.langUnsub?.();
    });
  }
}
