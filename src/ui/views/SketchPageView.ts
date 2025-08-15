import type { Sketch } from '../../types/sketch.js';

export class SketchPageView {
  static render(sketch: Sketch): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    
    // パスを正しい形式に変換
    const sketchPath = sketch.path.replace('../', '/');
    
    app.innerHTML = `
      <div class="fullscreen-sketch-container">
        <iframe 
          src="${sketchPath}" 
          class="fullscreen-iframe" 
          title="${sketch.title}"
          sandbox="allow-scripts allow-same-origin allow-modals"
          id="sketch-iframe"
        ></iframe>
        
        <div class="sketch-overlay-info">
          <div class="sketch-overlay-content">
            <img 
              src="${sketch.userData.avatarFile.replace('../', '/')}" 
              alt="${sketch.userData.userName}" 
              class="overlay-avatar-small"
            />
            <div class="overlay-text">
              <div class="overlay-username-small">${sketch.userData.userName}</div>
              <div class="overlay-title-small">${sketch.title}</div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    this.setupIframe(sketch);
  }

  private static setupIframe(_sketch: Sketch): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    iframe.onload = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          const style = iframeDoc.createElement('style');
          style.textContent = `
            body {
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
              display: flex !important;
              justify-content: center !important;
              align-items: center !important;
              min-height: 100vh !important;
              width: 100% !important;
            }
            canvas {
              display: block !important;
              margin: 0 !important;
              padding: 0 !important;
              max-width: 100% !important;
              max-height: 100vh !important;
              object-fit: contain !important;
            }
            /* 他の要素がある場合の対応 */
            * {
              box-sizing: border-box !important;
            }
          `;
          iframeDoc.head.appendChild(style);
        }
      } catch (e) {
        console.log('Cannot access iframe content due to CORS policy');
      }
    };
  }
}
