import type { Sketch } from '../../types/sketch.js';
import { EventEmitter } from '../../core/events/EventEmitter';
import { CursorManager } from '../managers/CursorManager';
import { UIElementController } from '../services/UIElementController';
import { OverlayManager } from '../managers/OverlayManager';

export class SketchPageView {
  private eventEmitter: EventEmitter;
  private cursorManager: CursorManager;
  private uiController: UIElementController;
  private overlayManager: OverlayManager;
  private mappingOverlay: HTMLDivElement | null = null;
  private mappingVideo: HTMLVideoElement | null = null;
  private iframeMappingContainer: HTMLDivElement | null = null;
  private iframeMappingVideo: HTMLVideoElement | null = null;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.cursorManager = new CursorManager();
    this.uiController = new UIElementController();
    this.overlayManager = new OverlayManager();
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
        
        <!-- iframeの外側に配置するオーバーレイ -->
        <div 
          id="iframe-overlay" 
          class="iframe-overlay"
        >
          <!-- マッピング映像を表示するコンテナ -->
          <div id="iframe-mapping-container" class="iframe-mapping-container">
            <video id="iframe-mapping-video" autoplay muted playsinline></video>
          </div>
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

        <!-- ウィンドウ開くボタン -->
        <button 
          id="open-windows-btn" 
          class="open-windows-button top-right-button ui-element"
          title="ウィンドウを開く"
          aria-label="ウィンドウを開く"
        >
          <i class="fas fa-external-link-alt button-icon"></i>
        </button>
        
        <!-- iframeオーバーレイコンテナ -->
        <div id="iframe-content-overlay" class="iframe-content-overlay">
          <!-- マッピングオーバーレイ -->
          <div id="mapping-overlay" class="mapping-overlay" style="display: none;">
            <video id="mapping-overlay-video" autoplay muted playsinline></video>
          </div>
        </div>
      </div>
    `;
    
    this.setupEventListeners();
    
    // DOMが完全に描画されるのを待ってから要素を取得
    setTimeout(() => {
      // オーバーレイ要素を取得
      this.mappingOverlay = document.getElementById('mapping-overlay') as HTMLDivElement;
      this.mappingVideo = document.getElementById('mapping-overlay-video') as HTMLVideoElement;
      this.iframeMappingContainer = document.getElementById('iframe-mapping-container') as HTMLDivElement;
      this.iframeMappingVideo = document.getElementById('iframe-mapping-video') as HTMLVideoElement;
      
      console.log('SketchPageView: DOM要素取得結果', {
        mappingOverlay: !!this.mappingOverlay,
        mappingVideo: !!this.mappingVideo,
        iframeMappingContainer: !!this.iframeMappingContainer,
        iframeMappingVideo: !!this.iframeMappingVideo
      });
      
      // 要素が取得できた場合のみリスナーを設定
      if (this.iframeMappingContainer && this.iframeMappingVideo) {
        this.setupMappingOverlayListener();
        this.setupVideoEventListeners();
      }
    }, 100);
    
    // CursorManagerを初期化
    this.cursorManager.initialize();
  }

  private setupEventListeners(): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    const openWindowsBtn = document.getElementById('open-windows-btn') as HTMLButtonElement;
    
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

    // ウィンドウ開くボタンのイベント
    openWindowsBtn.addEventListener('click', () => {
      this.eventEmitter.emit('openWindowsToggle');
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
    console.log(`🔄 フルスクリーン状態更新: ${isFullscreen ? '開始' : '終了'}`);
    
    // UI要素の状態を更新
    this.uiController.setFullscreenActiveState(isFullscreen);
    this.uiController.updateFullscreenButtonIcon(isFullscreen);
    
    // UI要素の表示/非表示を統一的に管理
    const shouldShowUI = !isFullscreen;
    console.log(`👁️ UI要素の表示状態: ${shouldShowUI ? '表示' : '非表示'}`);
    this.uiController.toggleElements(shouldShowUI);
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
    this.overlayManager.toggleOverlay(isVisible);
  }

  private setupVideoEventListeners(): void {
    // ビデオストリームが設定されたらオーバーレイを更新
    if (this.mappingVideo) {
      this.mappingVideo.addEventListener('loadedmetadata', () => {
        console.log('SketchPageView: mapping-overlay-videoメタデータ読み込み完了');
        const lastData = (window as any).lastMappingData;
        if (lastData) {
          this.updateMappingOverlay(lastData);
        }
      });
    }
    
    // iframe-mapping-videoのメタデータ読み込み時にも更新
    if (this.iframeMappingVideo) {
      this.iframeMappingVideo.addEventListener('loadedmetadata', () => {
        console.log('SketchPageView: iframe-mapping-videoメタデータ読み込み完了');
        const lastData = (window as any).lastMappingData;
        if (lastData) {
          this.updateMappingOverlay(lastData);
        }
      });
    }
  }

  private setupMappingOverlayListener(): void {
    window.addEventListener('mapping-overlay-update', (event: Event) => {
      const customEvent = event as CustomEvent;
      this.updateMappingOverlay(customEvent.detail);
    });
    
    // ウィンドウリサイズ時の再計算
    window.addEventListener('resize', () => {
      const lastData = (window as any).lastMappingData;
      if (lastData) {
        this.updateMappingOverlay(lastData);
      }
    });
  }

  private updateMappingOverlay(data: any): void {
    const { source, mapping } = data;
    
    console.log('SketchPageView: updateMappingOverlay called with:', data);
    
    // データを保存
    (window as any).lastMappingData = data;
    
    // iframe-content-overlayの更新
    if (this.mappingOverlay && this.mappingVideo) {
      // ビデオにストリームが設定されているか確認
      if (!this.mappingVideo.srcObject) {
        console.log('SketchPageView: mapping-overlay-videoにストリームが未設定');
        this.mappingOverlay.style.display = 'none';
      } else {
        // オーバーレイを表示
        this.mappingOverlay.style.display = 'block';
        this.updateMappingOverlayPosition(this.mappingOverlay, this.mappingVideo, source, mapping);
      }
    }
    
    // iframe-overlay内のマッピングコンテナの更新
    if (this.iframeMappingContainer && this.iframeMappingVideo) {
      console.log('SketchPageView: Updating iframe-mapping-container');
      // iframe-mapping-containerには特別な処理を適用
      this.updateIframeMappingPosition(this.iframeMappingContainer, this.iframeMappingVideo, source, mapping);
    } else {
      console.warn('SketchPageView: iframe-mapping-container or video not found', {
        container: this.iframeMappingContainer,
        video: this.iframeMappingVideo
      });
    }
  }
  
  private updateMappingOverlayPosition(
    container: HTMLElement,
    video: HTMLVideoElement,
    source: any,
    mapping: any
  ): void {
    
    // iframeのサイズを取得してスケーリングを調整
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (iframe) {
      const iframeRect = iframe.getBoundingClientRect();
      const overlayContainer = document.getElementById('iframe-content-overlay') as HTMLDivElement;
      
      // iframeオーバーレイコンテナをiframeと同じサイズに設定
      if (overlayContainer) {
        overlayContainer.style.width = `${iframeRect.width}px`;
        overlayContainer.style.height = `${iframeRect.height}px`;
      }
    }
    
    // コンテナの位置とサイズを更新（マッピングウィンドウと同期）
    container.style.left = `${mapping.x}%`;
    container.style.top = `${mapping.y}%`;
    container.style.width = `${mapping.width}%`;
    container.style.height = `${mapping.height}%`;
    
    // ビデオのクロップ位置を更新（ソース選択領域のみを表示）
    // シンプルなスケール計算
    const scale = 100 / source.width;
    const translateX = -source.x * scale;
    const translateY = -source.y * scale;
    
    video.style.width = `${scale * 100}%`;
    video.style.height = `${scale * 100}%`;
    video.style.transform = `translate(${translateX}%, ${translateY}%)`;
    
    console.log('SketchPageView: オーバーレイ更新', {
      containerType: container.id,
      source,
      mapping,
      scale,
      translateX,
      translateY,
      hasStream: !!video.srcObject
    });
  }
  
  private updateIframeMappingPosition(
    container: HTMLElement,
    video: HTMLVideoElement,
    source: any,
    mapping: any
  ): void {
    // iframeのサイズを取得
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe) {
      console.warn('SketchPageView: iframe要素が見つかりません');
      return;
    }
    
    const iframeRect = iframe.getBoundingClientRect();
    
    // iframe-overlayがiframeと同じサイズに設定されていることを確認
    const iframeOverlay = document.getElementById('iframe-overlay');
    if (iframeOverlay) {
      iframeOverlay.style.position = 'absolute';
      iframeOverlay.style.top = '0';
      iframeOverlay.style.left = '0';
      iframeOverlay.style.width = '100%';
      iframeOverlay.style.height = '100%';
    }
    
    // マッピングウィンドウのcropped-containerと同じ相対位置に配置
    // パーセンテージをそのまま使用
    container.style.position = 'absolute';
    container.style.left = `${mapping.x}%`;
    container.style.top = `${mapping.y}%`;
    container.style.width = `${mapping.width}%`;
    container.style.height = `${mapping.height}%`;
    
    // マッピングウィンドウと同じシンプルな変換を使用
    const scale = 100 / source.width;
    const translateX = -source.x * scale;
    const translateY = -source.y * scale;
    
    // ビデオ要素のスタイルを設定
    video.style.position = 'absolute';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = `${scale * 100}%`;
    video.style.height = `${scale * 100}%`;
    video.style.transform = `translate(${translateX}%, ${translateY}%)`;
    video.style.transformOrigin = 'top left';
    
    // ビデオストリームの状態を確認
    const hasStream = !!video.srcObject;
    if (!hasStream) {
      console.warn('SketchPageView: ビデオストリームが設定されていません', {
        videoId: video.id,
        videoElement: video
      });
    }
    
    console.log('SketchPageView: iframe-mapping-container更新', {
      position: {
        left: `${mapping.x}%`,
        top: `${mapping.y}%`,
        width: `${mapping.width}%`,
        height: `${mapping.height}%`
      },
      videoCrop: {
        width: `${scale * 100}%`,
        height: `${scale * 100}%`,
        transform: `translate(${translateX}%, ${translateY}%)`
      },
      source,
      mapping,
      scale,
      translateX,
      translateY,
      hasStream,
      iframeRect
    });
  }

  public setMappingVideoStream(stream: MediaStream): void {
    if (this.mappingVideo) {
      this.mappingVideo.srcObject = stream;
    }
  }



  onFullscreenToggle(callback: (container: HTMLElement) => void): void {
    this.eventEmitter.on('fullscreenToggle', callback);
  }

  onWindowSettingsToggle(callback: () => void): void {
    this.eventEmitter.on('windowSettingsToggle', callback);
  }

  onOpenWindowsToggle(callback: () => void): void {
    this.eventEmitter.on('openWindowsToggle', callback);
  }

  destroy(): void {
    this.eventEmitter.removeAllListeners();
    this.cursorManager.destroy();
    this.overlayManager.destroy();
  }
}
