import type { Sketch } from '../types/sketch.js';
import { SketchCard } from '../ui/components/SketchCard.js';
import { routeHref } from '../utils/paths.js';
import { OpIdEntryView } from './OpIdEntryView.js';

export class SketchGalleryView {
  static render(sketches: Sketch[], onOpIdSubmit?: (id: string) => void): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;

    app.innerHTML = `
      <div class="container">
        <header class="header">
          <h1>Sketch Gallery</h1>
          <div class="header-actions">
            <a href="${routeHref('/slideshow')}" class="slideshow-btn" target="_blank">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                <line x1="7" y1="2" x2="7" y2="22"/>
                <line x1="17" y1="2" x2="17" y2="22"/>
              </svg>
              スライドショー
            </a>
          </div>
        </header>

        ${onOpIdSubmit ? `<div class="op-id-inline">${OpIdEntryView.inlineHtml()}</div>` : ''}

        <div class="gallery-grid">
          ${sketches.map(sketch => SketchCard.render(sketch)).join('')}
        </div>

        <footer class="footer">
          <p>&copy; ${new Date().getFullYear()} dropcaster. All rights reserved.</p>
        </footer>
      </div>
    `;

    if (onOpIdSubmit) {
      const inline = app.querySelector<HTMLElement>('.op-id-inline');
      if (inline) OpIdEntryView.wireForm(inline, onOpIdSubmit);
    }
  }
}
