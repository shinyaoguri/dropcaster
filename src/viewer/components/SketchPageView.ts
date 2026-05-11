import type { Sketch } from '../types/sketch.js';
import { EventEmitter } from '../events/EventEmitter';
import { CursorManager } from '../managers/CursorManager';
import { UIElementController } from '../ui/services/UIElementController';
import { escapeHtml } from '../utils/html.js';
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
  // 投影中、ワープした映像の overlay 要素（.mapping-overlay）はここに生成される
  private projectionStage: HTMLDivElement | null = null;
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
  }

  render(sketch: Sketch): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;

    // userDataの存在チェックとデフォルト値の設定
    const userName = sketch.userData?.userName || 'Unknown User';
    const title = escapeHtml(sketch.title);
    const escapedUserName = escapeHtml(userName);

    app.innerHTML = `
      <div class="fullscreen-sketch-container">
        <!-- スケッチ iframe は SketchPageController が SketchFrame を使ってここに差し込む -->
        <div id="sketch-stage" class="fullscreen-iframe"></div>

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
      this.setupMappingOverlayListener();
      this.domSetupTimeout = null;
    }, 100);

    // CursorManagerを初期化
    this.cursorManager.initialize();
  }

  private setupEventListeners(): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
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
    const videos = document.querySelectorAll<HTMLVideoElement>('.mapping-overlay video');
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
    if (!this.projectionStage) return;

    // disabled な mapping は投影出力には出さない
    const enabled = mappings.filter(isMappingEnabled);
    this.syncMappingChildren(this.projectionStage, 'mapping-overlay', enabled);
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
  }
}
