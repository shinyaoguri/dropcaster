import type { Sketch } from '../../types/sketch.js';
import { EventEmitter } from '../../core/events/EventEmitter';

export class SketchPageView {
  private eventEmitter: EventEmitter;
  private resizeManager: any; // ResizeManagerのインスタンスを保持

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  render(sketch: Sketch): void {
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
        
        <!-- ウィンドウサイズいっぱいのマウス監視用div -->
        <div 
          id="mouse-monitor-overlay" 
          class="mouse-monitor-overlay"
          style="display: none;"
        ></div>
        
        <!-- iframeの外側に配置するオーバーレイ -->
        <div 
          id="iframe-overlay" 
          class="iframe-overlay"
          style="display: none;"
        >
          <!-- 四隅のハンドル -->
          <div class="resize-handle resize-handle-top-left" data-handle="top-left"></div>
          <div class="resize-handle resize-handle-top-right" data-handle="top-right"></div>
          <div class="resize-handle resize-handle-bottom-left" data-handle="bottom-left"></div>
          <div class="resize-handle resize-handle-bottom-right" data-handle="bottom-right"></div>
        </div>
        
        <div class="sketch-overlay-info">
          <div class="sketch-overlay-content">
            <img 
              src="${(sketch.userData?.avatarFile || '/public/avatars/user128718.jpg').replace('../', '/')}" 
              alt="${sketch.userData.userName || 'Unknown User'}" 
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

        <!-- ウィンドウ設定ボタン -->
        <button 
          id="window-settings-btn" 
          class="window-settings-button"
          title="ウィンドウ設定"
          aria-label="ウィンドウ設定"
        >
          <svg class="window-settings-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
          </svg>
        </button>
      </div>
    `;
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    
    // フルスクリーンボタンのイベント
    fullscreenBtn.addEventListener('click', () => {
      const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
      this.eventEmitter.emit('fullscreenToggle', container);
    });

    // ウィンドウ設定ボタンのイベント
    windowSettingsBtn.addEventListener('click', () => {
      this.eventEmitter.emit('windowSettingsToggle');
    });

    // フルスクリーン状態の変更を監視
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;
      fullscreenBtn.classList.toggle('fullscreen-active', isFullscreen);
      
      // フルスクリーン時にボタンとユーザー情報を非表示
      const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;
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

  updateFullscreenState(isFullscreen: boolean): void {
    const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
    
    if (isFullscreen) {
      container.classList.add('fullscreen');
    } else {
      container.classList.remove('fullscreen');
    }
    
    // アイコンを更新
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const icon = fullscreenBtn.querySelector('.fullscreen-icon') as SVGElement;
    if (isFullscreen) {
      // フルスクリーン終了アイコン
      icon.innerHTML = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
    } else {
      // フルスクリーン開始アイコン
      icon.innerHTML = '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
    }
  }

  toggleIframeOverlay(isVisible: boolean): void {
    const overlay = document.getElementById('iframe-overlay') as HTMLDivElement;
    const mouseMonitor = document.getElementById('mouse-monitor-overlay') as HTMLDivElement;
    
    if (overlay && mouseMonitor) {
      if (isVisible) {
        // オーバーレイを表示し、iframe内のcanvasの位置とサイズに合わせる
        this.positionOverlayToCanvas(overlay);
        overlay.style.display = 'block';
        // マウス監視用divも表示
        mouseMonitor.style.display = 'block';
        console.log('iframeオーバーレイとマウス監視を表示しました');
      } else {
        overlay.style.display = 'none';
        mouseMonitor.style.display = 'none';
        console.log('iframeオーバーレイとマウス監視を非表示にしました');
      }
    }
  }

  private positionOverlayToCanvas(overlay: HTMLDivElement): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe) return;

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const canvas = iframeDoc.querySelector('canvas');
        if (canvas) {
          // canvasの位置とサイズを取得
          const canvasRect = canvas.getBoundingClientRect();
          const iframeRect = iframe.getBoundingClientRect();
          
          // iframe内のcanvasの相対位置を計算
          const relativeLeft = canvasRect.left - iframeRect.left;
          const relativeTop = canvasRect.top - iframeRect.top;
          
          // オーバーレイをcanvasの位置とサイズに合わせる
          overlay.style.position = 'absolute';
          overlay.style.left = `${relativeLeft}px`;
          overlay.style.top = `${relativeTop}px`;
          overlay.style.width = `${canvasRect.width}px`;
          overlay.style.height = `${canvasRect.height}px`;
          
          console.log('オーバーレイをcanvasの位置とサイズに合わせました:', {
            left: relativeLeft,
            top: relativeTop,
            width: canvasRect.width,
            height: canvasRect.height
          });
        }
      }
    } catch (e) {
      console.log('canvasの位置取得に失敗:', e);
      // フォールバック: iframe全体に合わせる
      overlay.style.position = 'absolute';
      overlay.style.left = '0px';
      overlay.style.top = '0px';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
    }
  }

  /**
   * ResizeManagerのインスタンスを設定
   */
  setResizeManager(resizeManager: any): void {
    this.resizeManager = resizeManager;
  }

  /**
   * iframe-overlayとiframe内のcanvasの位置・サイズを同期
   */
  syncOverlayWithCanvas(): void {
    if (this.resizeManager && typeof this.resizeManager.syncOverlayWithCanvas === 'function') {
      this.resizeManager.syncOverlayWithCanvas();
    }
  }

  onFullscreenToggle(callback: (container: HTMLElement) => void): void {
    this.eventEmitter.on('fullscreenToggle', callback);
  }

  onWindowSettingsToggle(callback: () => void): void {
    this.eventEmitter.on('windowSettingsToggle', callback);
  }

  destroy(): void {
    this.eventEmitter.removeAllListeners();
  }
}
