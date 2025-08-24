import type { Sketch } from '../types/sketch.js';
import { FullscreenManager } from '../managers/FullscreenManager';
import { IframeManager } from '../managers/IframeManager';
import { CursorManager } from '../managers/CursorManager';
import { ResizeManager } from '../managers/ResizeManager';
import { SketchPageView } from './SketchPageView';
import { WindowController } from './WindowController';

export class SketchPageController {
  private fullscreenManager: FullscreenManager;
  private iframeManager: IframeManager;
  private cursorManager: CursorManager;
  private resizeManager: ResizeManager;
  private view: SketchPageView;
  private windowController: WindowController;
  private isSettingsMode = false;

  constructor() {
    this.fullscreenManager = new FullscreenManager();
    this.iframeManager = new IframeManager();
    this.cursorManager = new CursorManager();
    this.resizeManager = new ResizeManager();
    this.view = new SketchPageView();
    this.windowController = new WindowController();
  }

  async renderSketch(sketch: Sketch): Promise<void> {
    console.log('SketchPageController: スケッチのレンダリング開始:', sketch.title);
    
    // ビューのレンダリング
    this.view.render(sketch);
    
    // 各マネージャーの初期化
    await this.iframeManager.initialize();
    this.fullscreenManager.initialize();
    this.cursorManager.initialize();
    this.resizeManager.initialize();
    
    
    
    // イベントリスナーの設定
    this.setupEventListeners();
    
    console.log('SketchPageController: スケッチのレンダリング完了');
  }

  private setupEventListeners(): void {
    console.log('SketchPageController: イベントリスナーの設定開始');
    
    // フルスクリーンボタンのイベント
    this.view.onFullscreenToggle((container: HTMLElement) => {
      console.log('SketchPageController: フルスクリーンボタンクリック');
      this.fullscreenManager.toggleFullscreen(container);
    });

    // フルスクリーン状態の変更を監視
    this.fullscreenManager.onFullscreenChange((isFullscreen: boolean) => {
      console.log('SketchPageController: フルスクリーン状態変更を受信:', isFullscreen);
      this.cursorManager.setFullscreenMode(isFullscreen);
      this.view.updateFullscreenState(isFullscreen);
    });

    // UI要素の表示/非表示イベントを監視（デバッグ用）
    this.fullscreenManager.onUIHidden(() => {
      console.log('SketchPageController: UI要素非表示イベントを受信');
    });

    this.fullscreenManager.onUIShown(() => {
      console.log('SketchPageController: UI要素表示イベントを受信');
    });

    // カーソルの表示/非表示イベントを監視（デバッグ用）
    this.cursorManager.onCursorHidden(() => {
      console.log('SketchPageController: カーソル非表示イベントを受信');
    });

    this.cursorManager.onCursorShown(() => {
      console.log('SketchPageController: カーソル表示イベントを受信');
    });

    // ウィンドウ設定ボタンのイベント
    this.view.onWindowSettingsToggle(() => {
      console.log('SketchPageController: ウィンドウ設定ボタンクリック');
      // 設定モードの状態を切り替え
      this.isSettingsMode = !this.isSettingsMode;
      const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
      windowSettingsBtn.classList.toggle('settings-active', this.isSettingsMode);
      
      // iframeオーバーレイの表示/非表示を制御
      this.view.toggleIframeOverlay(this.isSettingsMode);
      
      // iframe内のCanvas要素の設定モードも更新
      this.iframeManager.toggleSettingsMode(this.isSettingsMode);
      
      console.log('SketchPageController: 設定モード:', this.isSettingsMode ? 'ON' : 'OFF');
      console.log('SketchPageController: iframe内のCanvas要素の枠を', this.isSettingsMode ? '追加' : '削除');
    });
    
    // フルスクリーン制御リクエストを監視
    window.addEventListener('message', (event) => {
      if (event.data.type === 'toggle-fullscreen-request') {
        console.log('SketchPageController: フルスクリーン切り替えリクエストを受信');
        const container = document.querySelector('.fullscreen-sketch-container') as HTMLElement;
        if (container) {
          this.fullscreenManager.toggleFullscreen(container);
        }
      }
    });

    // ウィンドウ開くボタンのイベント
    this.view.onOpenWindowsToggle(() => {
      console.log('SketchPageController: ウィンドウ開くボタンクリック');
      this.openWindows();
    });
    
    console.log('SketchPageController: イベントリスナーの設定完了');
  }

  private openWindows(): void {
    console.log('SketchPageController: ウィンドウコントローラーを使用してウィンドウを開きます');
    this.windowController.openBothWindows();
    
    // ウィンドウが開かれた後、Canvasストリーミングを開始（より長い遅延で確実に）
    setTimeout(() => {
      this.startCanvasStreamingToWindows();
      this.windowController.logWindowStatus();
    }, 2000); // 2秒後に実行
  }

  private startCanvasStreamingToWindows(): void {
    console.log('SketchPageController: Canvasストリーミング開始');
    
    const iframe = this.iframeManager.getIframe();
    if (iframe) {
      // iframe内のcanvasが読み込まれるのを待ってから開始
      this.waitForCanvasAndStartStreaming(iframe, 0);
    } else {
      console.warn('SketchPageController: iframe要素が見つかりません');
    }
  }

  private waitForCanvasAndStartStreaming(iframe: HTMLIFrameElement, retryCount: number): void {
    const maxRetries = 10;
    
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const canvas = iframeDoc.querySelector('canvas');
        if (canvas) {
          console.log('SketchPageController: Canvas要素が見つかりました。ストリーミング開始します');
          this.windowController.startCanvasStreaming(iframe);
          return;
        }
      }
    } catch (error) {
      console.log('SketchPageController: iframe内容へのアクセスエラー（CORS）:', error);
    }

    if (retryCount < maxRetries) {
      console.log(`SketchPageController: Canvas要素が見つかりません。再試行 ${retryCount + 1}/${maxRetries}`);
      setTimeout(() => {
        this.waitForCanvasAndStartStreaming(iframe, retryCount + 1);
      }, 500);
    } else {
      console.error('SketchPageController: Canvas要素が見つからないため、ストリーミングを開始できません');
    }
  }

  destroy(): void {
    console.log('SketchPageController: 破棄処理開始');
    this.fullscreenManager.destroy();
    this.iframeManager.destroy();
    this.cursorManager.destroy();
    this.resizeManager.destroy();
    this.view.destroy();
    this.windowController.closeAllWindows();
    console.log('SketchPageController: 破棄処理完了');
  }
}
