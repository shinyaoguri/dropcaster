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
        
        <!-- iframeと重ねる新しいdiv要素 -->
        <div class="sketch-overlay-layer" id="sketch-overlay-layer">
          <!-- 中身はまだ空 -->
        </div>
        
        <div class="sketch-overlay-info">
          <div class="sketch-overlay-content">
            <img 
              src="${(sketch.userData?.avatarFile || '/public/avatars/user128718.jpg').replace('../', '/')}" 
              alt="${sketch.userData?.userName || 'Unknown User'}" 
              class="overlay-avatar-small"
            />
            <div class="overlay-text">
              <div class="overlay-username-small">${sketch.userData.userName}</div>
              <div class="overlay-title-small">${sketch.title}</div>
            </div>
          </div>
        </div>

        <!-- フルスクリーンボタン -->
        <button 
          id="fullscreen-btn" 
          class="fullscreen-button"
          title="フルスクリーン"
          aria-label="フルスクリーン"
        >
          <i class="fas fa-expand fullscreen-icon"></i>
        </button>
      </div>
    `;
    
    this.setupIframe(sketch);
    this.setupFullscreenButton();
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

  private static setupFullscreenButton(): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
    const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;
    
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        // フルスクリーンを終了
        document.exitFullscreen();
      } else {
        // フルスクリーンを開始
        container.requestFullscreen().catch(err => {
          console.error('フルスクリーン化に失敗しました:', err);
        });
      }
    });

    // フルスクリーン状態の変更を監視
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;
      fullscreenBtn.classList.toggle('fullscreen-active', isFullscreen);
      
      // フルスクリーン時にボタンとユーザー情報を非表示
      if (isFullscreen) {
        fullscreenBtn.style.opacity = '0';
        fullscreenBtn.style.pointerEvents = 'none';
        if (overlayInfo) {
          overlayInfo.style.opacity = '0';
          overlayInfo.style.pointerEvents = 'none';
        }
      } else {
        fullscreenBtn.style.opacity = '1';
        fullscreenBtn.style.pointerEvents = 'auto';
        if (overlayInfo) {
          overlayInfo.style.opacity = '1';
          overlayInfo.style.pointerEvents = 'auto';
        }
      }
      
      // アイコンを更新
      const icon = fullscreenBtn.querySelector('.fullscreen-icon') as HTMLElement;
      if (isFullscreen) {
        // フルスクリーン終了アイコン
        icon.className = 'fas fa-compress fullscreen-icon';
      } else {
        // フルスクリーン開始アイコン
        icon.className = 'fas fa-expand fullscreen-icon';
      }
    });
  }
}
