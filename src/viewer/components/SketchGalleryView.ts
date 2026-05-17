import type { Sketch } from '../types/sketch.js';
import { SketchCard } from '../ui/components/SketchCard.js';
import { routeHref } from '../utils/paths.js';
import { OpIdEntryView } from './OpIdEntryView.js';
import { t, onLangChange } from '../i18n/index.js';
import { langSwitcherHtml, wireLangSwitcher } from '../i18n/LanguageSwitcher.js';

export class SketchGalleryView {
  private static langUnsub: (() => void) | null = null;

  static render(sketches: Sketch[], onOpIdSubmit?: (id: string) => void): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    SketchGalleryView.langUnsub?.();

    const paint = () => {
      app.innerHTML = `
      <div class="container">
        <header class="header">
          <h1>${t('gallery.title')}</h1>
          <div class="header-actions">
            ${langSwitcherHtml()}
            <a href="${routeHref('/slideshow')}" class="slideshow-btn" target="_blank">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                <line x1="7" y1="2" x2="7" y2="22"/>
                <line x1="17" y1="2" x2="17" y2="22"/>
              </svg>
              ${t('gallery.slideshow')}
            </a>
          </div>
        </header>

        ${onOpIdSubmit ? `<div class="op-id-inline">${OpIdEntryView.inlineHtml()}</div>` : ''}

        <div class="gallery-grid">
          ${sketches.map(sketch => SketchCard.render(sketch)).join('')}
        </div>

        <footer class="footer">
          <p>
            ${t('footer.copyright', { year: new Date().getFullYear() })} ·
            <a href="https://github.com/shinyaoguri/dropcaster/blob/main/LICENSE" target="_blank" rel="noopener">${t('footer.license')}</a> ·
            <a href="https://github.com/shinyaoguri/dropcaster" target="_blank" rel="noopener">${t('footer.github')}</a>
          </p>
        </footer>
      </div>
    `;

      if (onOpIdSubmit) {
        const inline = app.querySelector<HTMLElement>('.op-id-inline');
        if (inline) OpIdEntryView.wireForm(inline, onOpIdSubmit);
      }
      wireLangSwitcher(app);
    };

    paint();
    SketchGalleryView.langUnsub = onLangChange(() => {
      if (app.querySelector('.header h1')) paint();
      else SketchGalleryView.langUnsub?.();
    });
  }
}
