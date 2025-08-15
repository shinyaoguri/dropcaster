import type { Sketch } from '../../types/sketch.js';

// Electron APIの型定義
declare global {
  interface Window {
    electronAPI?: {
      setAlwaysOnTop: (alwaysOnTop: boolean) => void;
    };
  }
}

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
          <svg class="fullscreen-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
          </svg>
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
    
    this.setupIframe(sketch);
    this.setupFullscreenButton();
    this.setupWindowSettingsButton();
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
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
    const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;
    
    // マウスカーソル非表示化のための変数
    let cursorHideTimeout: ReturnType<typeof setTimeout> | null = null;
    const CURSOR_HIDE_DELAY = 3000; // 3秒後にカーソルを非表示
    
    // マウスカーソルを非表示にする関数
    const hideCursor = () => {
      document.body.style.cursor = 'none';
      // iframe内のカーソルも非表示にする
      const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
      if (iframe && iframe.contentDocument) {
        try {
          iframe.contentDocument.body.style.cursor = 'none';
        } catch (e) {
          // CORSエラーの場合は無視
        }
      }
      console.log('カーソルを非表示にしました');
    };
    
    // マウスカーソルを表示する関数
    const showCursor = () => {
      document.body.style.cursor = 'auto';
      // iframe内のカーソルも表示する
      const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
      if (iframe && iframe.contentDocument) {
        try {
          iframe.contentDocument.body.style.cursor = 'auto';
        } catch (e) {
          // CORSエラーの場合は無視
        }
      }
      console.log('カーソルを表示しました');
    };
    
    // マウスカーソルの非表示化タイマーをリセットする関数
    const resetCursorTimer = () => {
      if (cursorHideTimeout) {
        clearTimeout(cursorHideTimeout);
      }
      showCursor();
      cursorHideTimeout = setTimeout(hideCursor, CURSOR_HIDE_DELAY);
      console.log('カーソルタイマーをリセットしました');
    };
    
    // より包括的なマウス操作検知
    const handleMouseActivity = (event: Event) => {
      console.log('マウス操作を検知:', event.type);
      resetCursorTimer();
    };
    
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
        container.classList.add('fullscreen');
        fullscreenBtn.style.opacity = '0';
        fullscreenBtn.style.pointerEvents = 'none';
        windowSettingsBtn.style.opacity = '0';
        windowSettingsBtn.style.pointerEvents = 'none';
        if (overlayInfo) {
          overlayInfo.style.opacity = '0';
          overlayInfo.style.pointerEvents = 'none';
        }
        
        // フルスクリーン時のみマウスカーソル非表示化を有効化
        document.addEventListener('mousemove', handleMouseActivity);
        document.addEventListener('mousedown', handleMouseActivity);
        document.addEventListener('wheel', handleMouseActivity);
        document.addEventListener('mouseenter', handleMouseActivity);
        document.addEventListener('keydown', handleMouseActivity);
        document.addEventListener('keyup', handleMouseActivity);
        
        // iframe内のイベントも監視
        const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
        if (iframe) {
          iframe.addEventListener('load', () => {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                iframeDoc.addEventListener('mousemove', handleMouseActivity);
                iframeDoc.addEventListener('mousedown', handleMouseActivity);
                iframeDoc.addEventListener('wheel', handleMouseActivity);
                iframeDoc.addEventListener('keydown', handleMouseActivity);
                iframeDoc.addEventListener('keyup', handleMouseActivity);
              }
            } catch (e) {
              console.log('iframe内のイベントリスナー設定に失敗:', e);
            }
          });
        }
        
        resetCursorTimer(); // 初期タイマーを開始
      } else {
        container.classList.remove('fullscreen');
        fullscreenBtn.style.opacity = '1';
        fullscreenBtn.style.pointerEvents = 'auto';
        windowSettingsBtn.style.opacity = '1';
        windowSettingsBtn.style.pointerEvents = 'auto';
        if (overlayInfo) {
          overlayInfo.style.opacity = '1';
          overlayInfo.style.pointerEvents = 'auto';
        }
        
        // フルスクリーン終了時にマウスカーソル非表示化を無効化
        document.removeEventListener('mousemove', handleMouseActivity);
        document.removeEventListener('mousedown', handleMouseActivity);
        document.removeEventListener('wheel', handleMouseActivity);
        document.removeEventListener('mouseenter', handleMouseActivity);
        document.removeEventListener('keydown', handleMouseActivity);
        document.removeEventListener('keyup', handleMouseActivity);
        
        // iframe内のイベントも監視を解除
        const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
        if (iframe) {
          iframe.removeEventListener('load', () => {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                iframeDoc.removeEventListener('mousemove', handleMouseActivity);
                iframeDoc.removeEventListener('mousedown', handleMouseActivity);
                iframeDoc.removeEventListener('wheel', handleMouseActivity);
                iframeDoc.removeEventListener('keydown', handleMouseActivity);
                iframeDoc.removeEventListener('keyup', handleMouseActivity);
              }
            } catch (e) {
              console.log('iframe内のイベントリスナー解除に失敗:', e);
            }
          });
        }
        
        // タイマーをクリアしてカーソルを表示
        if (cursorHideTimeout) {
          clearTimeout(cursorHideTimeout);
          cursorHideTimeout = null;
        }
        showCursor();
      }
      
      // アイコンを更新
      const icon = fullscreenBtn.querySelector('.fullscreen-icon') as SVGElement;
      if (isFullscreen) {
        // フルスクリーン終了アイコン
        icon.innerHTML = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
      } else {
        // フルスクリーン開始アイコン
        icon.innerHTML = '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
      }
    });
  }

  private static setupWindowSettingsButton(): void {
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    let isSettingsMode = false;
    
    windowSettingsBtn.addEventListener('click', () => {
      isSettingsMode = !isSettingsMode;
      
      // ボタンの見た目を更新
      windowSettingsBtn.classList.toggle('settings-active', isSettingsMode);
      
      // iframeの枠を制御
      const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
      if (iframe) {
        if (isSettingsMode) {
          iframe.style.border = '3px solid #10b981';
          iframe.style.borderRadius = '8px';
        } else {
          iframe.style.border = 'none';
          iframe.style.borderRadius = '0';
        }
      }
      
      // 設定モードの状態をコンソールに表示（デバッグ用）
      console.log('設定モード:', isSettingsMode ? 'ON' : 'OFF');
    });
  }
}
