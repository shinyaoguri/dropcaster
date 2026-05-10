import type { Sketch } from '../types/sketch.js';
import { EventEmitter } from '../events/EventEmitter';
import { CursorManager } from '../managers/CursorManager';
import { UIElementController } from '../ui/services/UIElementController';
import { OverlayManager } from '../managers/OverlayManager';
import { escapeHtml } from '../utils/html.js';
import { publicAssetPath } from '../utils/paths.js';
import {
  applyVideoCrop,
  applyQuadTransform,
  isMappingEnabled,
  type MappingEntry,
} from '../utils/mappingTransform.js';

export class SketchPageView {
  private eventEmitter: EventEmitter;
  private cursorManager: CursorManager;
  private uiController: UIElementController;
  private overlayManager: OverlayManager;
  // dynamic な mapping-overlay 要素はここに生成される
  private projectionStage: HTMLDivElement | null = null;
  private settingsStage: HTMLDivElement | null = null;
  // canvas captureStream の現在値（WindowController から canvas-stream-ready で渡される）
  private currentStream: MediaStream | null = null;
  // 直近の mapping-overlay-update の payload を保持（resize 時の再描画に使う）
  private lastMappings: MappingEntry[] = [];
  private boundFullscreenChange = this.handleFullscreenChange.bind(this);
  private boundMappingOverlayUpdate = this.handleMappingOverlayUpdate.bind(this);
  private boundResize = this.handleResize.bind(this);
  private boundProjectionModeChange = this.handleProjectionModeChange.bind(this);
  private boundCanvasStreamReady = this.handleCanvasStreamReady.bind(this);
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
    const title = escapeHtml(sketch.title);
    const escapedUserName = escapeHtml(userName);

    console.log('SketchPageView: Using userName:', userName);

    app.innerHTML = `
      <div class="fullscreen-sketch-container">
        <iframe
          src="${escapeHtml(sketchPath)}"
          class="fullscreen-iframe"
          title="${title}"
          id="sketch-iframe"
        ></iframe>

        <!-- iframeの外側に配置するオーバーレイ（設定モード用 stage、子は動的生成） -->
        <div
          id="iframe-overlay"
          class="iframe-overlay"
        ></div>

        <div class="sketch-overlay-info ui-element">
          <div class="sketch-overlay-content">
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

        <!-- 投影 stage（projecting 時に黒背景で前面化、子の mapping-overlay は動的生成） -->
        <div id="iframe-content-overlay" class="iframe-content-overlay"></div>
      </div>
    `;

    this.setupEventListeners();

    // プロジェクションモード／canvas stream の通知を購読
    window.addEventListener('projection-mode-change', this.boundProjectionModeChange);
    window.addEventListener('canvas-stream-ready', this.boundCanvasStreamReady);

    // DOM が完全に描画されるのを待ってから dynamic stage を取得してイベント購読
    this.domSetupTimeout = setTimeout(() => {
      this.projectionStage = document.getElementById('iframe-content-overlay') as HTMLDivElement;
      this.settingsStage = document.getElementById('iframe-overlay') as HTMLDivElement;

      this.setupMappingOverlayListener();
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

  private setupMappingOverlayListener(): void {
    window.addEventListener('mapping-overlay-update', this.boundMappingOverlayUpdate);
    // ウィンドウリサイズ時の再計算（matrix3d は親の pixel size 依存）
    window.addEventListener('resize', this.boundResize);
  }

  private handleCanvasStreamReady(event: Event): void {
    const detail = (event as CustomEvent).detail;
    this.currentStream = (detail?.stream as MediaStream | null) ?? null;
    this.applyStreamToAllVideos();
  }

  private applyStreamToAllVideos(): void {
    const videos = document.querySelectorAll<HTMLVideoElement>(
      '.mapping-overlay video, .iframe-mapping-container video'
    );
    videos.forEach(video => {
      if (this.currentStream) {
        if (video.srcObject !== this.currentStream) {
          video.srcObject = this.currentStream;
          video.play().catch(error => {
            console.warn('SketchPageView: video.play 失敗', error);
          });
        }
      } else {
        video.srcObject = null;
      }
    });
  }

  private handleMappingOverlayUpdate(event: Event): void {
    const detail = (event as CustomEvent).detail;
    const mappings = (detail?.mappings as MappingEntry[]) ?? [];
    this.lastMappings = mappings;
    this.updateMappingOverlay(mappings);
  }

  private handleResize(): void {
    if (this.lastMappings.length > 0) {
      this.updateMappingOverlay(this.lastMappings);
    }
  }

  private handleProjectionModeChange(event: Event): void {
    const detail = (event as CustomEvent).detail;
    const container = document.querySelector('.fullscreen-sketch-container');
    if (container) {
      container.classList.toggle('projecting', !!detail?.active);
    }
  }

  private updateMappingOverlay(mappings: MappingEntry[]): void {
    if (!this.projectionStage || !this.settingsStage) return;

    // disabled な mapping は投影出力には出さない
    const enabled = mappings.filter(isMappingEnabled);
    this.syncMappingChildren(this.projectionStage, 'mapping-overlay', enabled);
    this.syncMappingChildren(this.settingsStage, 'iframe-mapping-container', enabled);
  }

  /**
   * parent の中に mappings 件分の `<div class="${baseClass}" data-mapping-id>`
   * を生成・更新・削除する。各 div は内部に `<video>` を持ち、自分の quad を
   * matrix3d で適用、source rect を video の crop で適用する。
   */
  private syncMappingChildren(parent: HTMLElement, baseClass: string, mappings: MappingEntry[]): void {
    // 親の position は明示しておく（matrix3d は親の rect に対する相対 % を使う）
    parent.style.position = 'absolute';
    parent.style.top = '0';
    parent.style.left = '0';
    parent.style.width = '100%';
    parent.style.height = '100%';

    const existing = new Map<string, HTMLDivElement>();
    parent.querySelectorAll<HTMLDivElement>(`:scope > .${baseClass}`).forEach(el => {
      const id = el.dataset.mappingId;
      if (id) existing.set(id, el);
    });

    // 不要になった entry を削除
    const validIds = new Set(mappings.map(m => m.id));
    existing.forEach((el, id) => {
      if (!validIds.has(id)) {
        el.remove();
        existing.delete(id);
      }
    });

    // 各 mapping を反映（新規なら生成）
    for (const mapping of mappings) {
      let el = existing.get(mapping.id);
      if (!el) {
        el = parent.ownerDocument.createElement('div');
        el.className = baseClass;
        el.dataset.mappingId = mapping.id;
        const video = parent.ownerDocument.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        el.appendChild(video);
        parent.appendChild(el);

        // 現在 stream がある場合は即座に bind
        if (this.currentStream) {
          video.srcObject = this.currentStream;
          video.play().catch(error => {
            console.warn(`SketchPageView: video.play 失敗 (${mapping.id})`, error);
          });
        }
      }

      const video = el.querySelector('video') as HTMLVideoElement | null;
      if (video) applyVideoCrop(video, mapping.source);
      applyQuadTransform(el, mapping.quad);
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
    window.removeEventListener('canvas-stream-ready', this.boundCanvasStreamReady);
    this.eventEmitter.removeAllListeners();
    this.cursorManager.destroy();
    this.overlayManager.destroy();
  }
}
