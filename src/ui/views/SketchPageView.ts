import type { Sketch } from '../../types/sketch.js';
import { EventEmitter } from '../../core/events/EventEmitter';
import { CursorManager } from '../services/CursorManager';

export class SketchPageView {
  private eventEmitter: EventEmitter;
  private resizeManager: any; // ResizeManagerのインスタンスを保持
  private cursorManager: CursorManager;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.cursorManager = new CursorManager();
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
        
        <!-- iframeの外側に配置するオーバーレイ -->
        <div 
          id="iframe-overlay" 
          class="iframe-overlay"
          style="display: none;"
        >
          <!-- 空のdiv要素 -->
        </div>
        
        <div class="sketch-overlay-info ui-element">
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
          class="fullscreen-button top-right-button ui-element"
          title="フルスクリーン"
          aria-label="フルスクリーン"
        >
          <i class="fas fa-expand fullscreen-icon button-icon"></i>
        </button>

        <!-- ウィンドウ設定ボタン -->
        <button 
          id="window-settings-btn" 
          class="window-settings-button top-right-button ui-element"
          title="ウィンドウ設定"
          aria-label="ウィンドウ設定"
        >
          <svg class="window-settings-icon button-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
          </svg>
        </button>
      </div>
    `;
    
    this.setupEventListeners();
    
    // CursorManagerを初期化
    this.cursorManager.initialize();
  }

  private setupEventListeners(): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    
    // フルスクリーンボタンのイベント
    fullscreenBtn.addEventListener('click', () => {
      const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
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

    // ウィンドウ設定ボタンのイベント
    windowSettingsBtn.addEventListener('click', () => {
      this.eventEmitter.emit('windowSettingsToggle');
    });

    // フルスクリーン状態の変更を監視
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;
      this.updateFullscreenUI(isFullscreen);
      
      // CursorManagerにフルスクリーン状態を通知
      this.cursorManager.setFullscreenMode(isFullscreen);
    });
  }

  private updateFullscreenUI(isFullscreen: boolean): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;
    
    console.log(`🔄 フルスクリーン状態更新: ${isFullscreen ? '開始' : '終了'}`);
    
    // 両方のボタンにフルスクリーン状態のクラスを適用
    fullscreenBtn.classList.toggle('fullscreen-active', isFullscreen);
    windowSettingsBtn.classList.toggle('fullscreen-active', isFullscreen);
    
    // UI要素の表示/非表示を統一的に管理
    // フルスクリーン時は非表示、フルスクリーン終了時は表示
    const shouldShowUI = !isFullscreen;
    console.log(`👁️ UI要素の表示状態: ${shouldShowUI ? '表示' : '非表示'}`);
    this.toggleUIElements(shouldShowUI);
    
    // アイコンを更新
    const icon = fullscreenBtn.querySelector('.fullscreen-icon') as HTMLElement;
    if (isFullscreen) {
      // フルスクリーン終了アイコン
      icon.className = 'fas fa-compress fullscreen-icon button-icon';
      console.log('🔴 フルスクリーン終了アイコンに変更');
    } else {
      // フルスクリーン開始アイコン
      icon.className = 'fas fa-expand fullscreen-icon button-icon';
      console.log('🟢 フルスクリーン開始アイコンに変更');
    }
  }

  private toggleUIElements(isVisible: boolean): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;
    
    const opacity = isVisible ? '1' : '0';
    const pointerEvents = isVisible ? 'auto' : 'none';
    
    // 全てのUI要素を同時に制御
    [fullscreenBtn, windowSettingsBtn, overlayInfo].forEach(element => {
      if (element) {
        element.style.opacity = opacity;
        element.style.pointerEvents = pointerEvents;
      }
    });
    
    console.log(`UI要素を${isVisible ? '表示' : '非表示'}にしました`);
  }

  updateFullscreenState(isFullscreen: boolean): void {
    const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
    
    if (isFullscreen) {
      container.classList.add('fullscreen');
    } else {
      container.classList.remove('fullscreen');
    }
    
    // UI要素の更新も統一的に処理
    this.updateFullscreenUI(isFullscreen);
  }

  toggleIframeOverlay(isVisible: boolean): void {
    const overlay = document.getElementById('iframe-overlay') as HTMLDivElement;
    
    if (overlay) {
      if (isVisible) {
        overlay.style.display = 'block';
        console.log('iframeオーバーレイを表示しました');
      } else {
        overlay.style.display = 'none';
        console.log('iframeオーバーレイを非表示にしました');
      }
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
    this.cursorManager.destroy();
  }
}
