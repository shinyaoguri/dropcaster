import type { Sketch } from '../../types/sketch.js';
import { escapeHtml, safeUrl } from '../../utils/html.js';
import { publicAssetPath, routeHref } from '../../utils/paths.js';

export class SketchCard {
  static render(sketch: Sketch): string {
    // インタラクティブ要素のHTMLを生成
    let interactiveElementsHTML = '';
    if (sketch.interactiveElements.length > 0) {
      interactiveElementsHTML = `
        <div class="interactive-elements">
          ${sketch.interactiveElements.map(element =>
            `<span class="element-tag">${escapeHtml(element)}</span>`
          ).join('')}
        </div>
      `;
    }

    // 安全なプロパティアクセス
    const previewGif = publicAssetPath(sketch.previewGif || 'vite.svg');
    const avatarFile = publicAssetPath(sketch.userData?.avatarFile || 'vite.svg');
    const title = escapeHtml(sketch.title);
    const userName = escapeHtml(sketch.userData?.userName || 'Unknown User');
    const sketchUrl = safeUrl(sketch.sketchUrl);
    const userUrl = safeUrl(sketch.userData?.userUrl);
    const sketchHref = routeHref(`/${encodeURIComponent(sketch.id)}`);

    return `
      <div class="sketch-card">
        <div class="sketch-preview">
          <img
            src="${escapeHtml(previewGif)}"
            alt="${title}"
            loading="lazy"
          />
          <div class="sketch-overlay">
            <div class="sketch-bottom-left">
              <img
                src="${escapeHtml(avatarFile)}"
                alt="${userName}"
                class="author-avatar"
              />
              <div class="sketch-info">
                <div class="sketch-title">
                  ${sketch.sketchUrl ?
                    `<a href="${escapeHtml(sketchUrl)}"
                        class="sketch-title-link"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View original on OpenProcessing">
                      ${title}
                    </a>` :
                    title
                  }
                </div>
                <div class="author-name">
                  <span class="by-text">by</span>
                  <a
                    href="${escapeHtml(userUrl)}"
                    class="user-name-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span class="user-name">${userName}</span>
                  </a>
                </div>
              </div>
            </div>

            <div class="sketch-bottom-right">
              <a
                href="${escapeHtml(sketchHref)}"
                class="view-button"
                target="_blank"
                rel="noopener noreferrer"
              >
                表示 →
              </a>
            </div>

            <div class="sketch-tags">
              ${interactiveElementsHTML}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
