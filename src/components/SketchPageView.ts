import type { Sketch } from '../types/sketch.js';
import { EventEmitter } from '../events/EventEmitter';
import { CursorManager } from '../managers/CursorManager';
import { UIElementController } from '../ui/services/UIElementController';
import { OverlayManager } from '../managers/OverlayManager';
import { escapeHtml } from '../utils/html.js';
import { publicAssetPath } from '../utils/paths.js';
import { applyVideoCrop, applyQuadTransform, defaultQuad, rectToQuad, type Quad } from '../utils/mappingTransform.js';

export class SketchPageView {
  private eventEmitter: EventEmitter;
  private cursorManager: CursorManager;
  private uiController: UIElementController;
  private overlayManager: OverlayManager;
  private mappingOverlay: HTMLDivElement | null = null;
  private mappingVideo: HTMLVideoElement | null = null;
  private iframeMappingContainer: HTMLDivElement | null = null;
  private iframeMappingVideo: HTMLVideoElement | null = null;
  private boundFullscreenChange = this.handleFullscreenChange.bind(this);
  private boundMappingOverlayUpdate = this.handleMappingOverlayUpdate.bind(this);
  private boundResize = this.handleResize.bind(this);
  private boundProjectionModeChange = this.handleProjectionModeChange.bind(this);
  private domSetupTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.cursorManager = new CursorManager();
    this.uiController = new UIElementController();
    this.overlayManager = new OverlayManager();
  }

  render(sketch: Sketch): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;

    // デバッグログ
    console.log('SketchPageView: Rendering sketch:', sketch);
    console.log('SketchPageView: userData:', sketch.userData);

    // パスを正しい形式に変換
    const sketchPath = publicAssetPath(sketch.path);

    // userDataの存在チェックとデフォルト値の設定
    const userName = sketch.userData?.userName || 'Unknown User';
    const avatarFile = publicAssetPath(sketch.userData?.avatarFile || 'vite.svg');
    const title = escapeHtml(sketch.title);
    const escapedUserName = escapeHtml(userName);

    console.log('SketchPageView: Using userName:', userName);
    console.log('SketchPageView: Using avatarFile:', avatarFile);

    app.innerHTML = `
      <div class="fullscreen-sketch-container">
        <iframe
          src="${escapeHtml(sketchPath)}"
          class="fullscreen-iframe"
          title="${title}"
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
              src="${escapeHtml(avatarFile)}"
              alt="${escapedUserName}"
              class="overlay-avatar-small"
            />
            <div class="overlay-text">
              <div class="overlay-username-small">${escapedUserName}</div>
              <div class="overlay-title-small">${title}</div>
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

    // プロジェクションモードの切替を購読
    window.addEventListener('projection-mode-change', this.boundProjectionModeChange);

    // DOMが完全に描画されるのを待ってから要素を取得
    this.domSetupTimeout = setTimeout(() => {
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
      this.domSetupTimeout = null;
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
    document.addEventListener('fullscreenchange', this.boundFullscreenChange);
  }

  private handleFullscreenChange(): void {
    const isFullscreen = !!document.fullscreenElement;
    this.updateFullscreenUI(isFullscreen);

    // CursorManagerにフルスクリーン状態を通知
    this.cursorManager.setFullscreenMode(isFullscreen);
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
    window.addEventListener('mapping-overlay-update', this.boundMappingOverlayUpdate);

    // ウィンドウリサイズ時の再計算
    window.addEventListener('resize', this.boundResize);
  }

  private handleMappingOverlayUpdate(event: Event): void {
    const customEvent = event as CustomEvent;
    this.updateMappingOverlay(customEvent.detail);
  }

  private handleResize(): void {
    const lastData = (window as any).lastMappingData;
    if (lastData) {
      this.updateMappingOverlay(lastData);
    }
  }

  private handleProjectionModeChange(event: Event): void {
    const detail = (event as CustomEvent).detail;
    const container = document.querySelector('.fullscreen-sketch-container');
    if (container) {
      container.classList.toggle('projecting', !!detail?.active);
    }
  }

  private updateMappingOverlay(data: any): void {
    const { source } = data;
    const quad: Quad = data.quad
      ?? (data.mapping ? rectToQuad(data.mapping) : defaultQuad());

    // データを保存
    (window as any).lastMappingData = data;

    // iframe-content-overlay の mapping-overlay
    if (this.mappingOverlay && this.mappingVideo) {
      if (!this.mappingVideo.srcObject) {
        this.mappingOverlay.style.display = 'none';
      } else {
        this.mappingOverlay.style.display = 'block';
        this.updateMappingOverlayPosition(this.mappingOverlay, this.mappingVideo, source, quad);
      }
    }

    // iframe-overlay 内のマッピングコンテナ（設定モード時のプレビュー）
    if (this.iframeMappingContainer && this.iframeMappingVideo) {
      this.updateIframeMappingPosition(this.iframeMappingContainer, this.iframeMappingVideo, source, quad);
    }
  }

  private updateMappingOverlayPosition(
    container: HTMLElement,
    video: HTMLVideoElement,
    source: any,
    quad: Quad
  ): void {
    // iframe-content-overlay は viewport 全体に固定（投影ステージ）
    const overlayContainer = document.getElementById('iframe-content-overlay') as HTMLDivElement | null;
    if (overlayContainer) {
      overlayContainer.style.width = '100%';
      overlayContainer.style.height = '100%';
    }

    // ホモグラフィー変換でマッピング四角形へ写像（container は 100%×100%）
    applyQuadTransform(container, quad);
    // ビデオは container 内で source rect を埋める（source crop）
    applyVideoCrop(video, source);
  }

  private updateIframeMappingPosition(
    container: HTMLElement,
    video: HTMLVideoElement,
    source: any,
    quad: Quad
  ): void {
    const iframeOverlay = document.getElementById('iframe-overlay');
    if (iframeOverlay) {
      iframeOverlay.style.position = 'absolute';
      iframeOverlay.style.top = '0';
      iframeOverlay.style.left = '0';
      iframeOverlay.style.width = '100%';
      iframeOverlay.style.height = '100%';
    }

    applyQuadTransform(container, quad);
    applyVideoCrop(video, source);
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
    if (this.domSetupTimeout) {
      clearTimeout(this.domSetupTimeout);
      this.domSetupTimeout = null;
    }
    document.removeEventListener('fullscreenchange', this.boundFullscreenChange);
    window.removeEventListener('mapping-overlay-update', this.boundMappingOverlayUpdate);
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('projection-mode-change', this.boundProjectionModeChange);
    this.eventEmitter.removeAllListeners();
    this.cursorManager.destroy();
    this.overlayManager.destroy();
  }
}
