import type { Sketch } from '../../types/sketch.js';

export class SketchCard {
  static render(sketch: Sketch): string {
    // インタラクティブ要素のHTMLを生成
    let interactiveElementsHTML = '';
    if (sketch.interactiveElements.length > 0) {
      interactiveElementsHTML = `
        <div class="interactive-elements">
          ${sketch.interactiveElements.map(element => 
            `<span class="element-tag">${element}</span>`
          ).join('')}
        </div>
      `;
    }
    
    // 安全なプロパティアクセス
    const previewGif = sketch.previewGif || '/vite.svg';
    const avatarFile = sketch.userData?.avatarFile || '/vite.svg';
    
    return `
      <div class="sketch-card">
        <div class="sketch-preview">
          <img 
            src="${previewGif.replace('../', '/')}" 
            alt="${sketch.title}" 
            loading="lazy"
          />
          <div class="sketch-overlay">
            <div class="sketch-bottom-left">
              <img 
                src="${avatarFile.replace('../', '/')}" 
                alt="${sketch.userData?.userName || 'Unknown User'}" 
                class="author-avatar"
              />
              <div class="sketch-info">
                <div class="sketch-title">
                  ${sketch.sketchUrl ? 
                    `<a href="${sketch.sketchUrl}" 
                        class="sketch-title-link" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        title="View original on OpenProcessing">
                      ${sketch.title}
                    </a>` : 
                    sketch.title
                  }
                </div>
                <div class="author-name">
                  <span class="by-text">by</span>
                  <a 
                    href="${sketch.userData?.userUrl || '#'}" 
                    class="user-name-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span class="user-name">${sketch.userData?.userName || 'Unknown User'}</span>
                  </a>
                </div>
              </div>
            </div>
            
            <div class="sketch-bottom-right">
              <a 
                href="/${sketch.id}" 
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
