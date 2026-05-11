import type { Sketch } from '../types/sketch.js';
import { FullscreenManager } from '../managers/FullscreenManager';
import { SketchFrame } from '../runtime/SketchFrame';
import { CursorManager } from '../managers/CursorManager';
import { SketchPageView } from './SketchPageView';
import { WindowController } from './WindowController';
import { publicAssetPath } from '../utils/paths.js';

export class SketchPageController {
  private fullscreenManager: FullscreenManager;
  private sketchFrame: SketchFrame | null = null;
  private cursorManager: CursorManager;
  private view: SketchPageView;
  private windowController: WindowController;
  private openWindowsTimeout: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;
  private messageHandler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;

    if (event.data?.type === 'toggle-fullscreen-request') {
      console.log('SketchPageController: フルスクリーン切り替えリクエストを受信');
      const container = document.querySelector('.fullscreen-sketch-container') as HTMLElement;
      if (container) {
        this.fullscreenManager.toggleFullscreen(container);
      }
    }
  };

  constructor() {
    this.fullscreenManager = new FullscreenManager();
    this.cursorManager = new CursorManager();
    this.view = new SketchPageView();
    this.windowController = new WindowController();
  }

  async renderSketch(sketch: Sketch): Promise<void> {
    this.isDestroyed = false;
    console.log('SketchPageController: スケッチのレンダリング開始:', sketch.title);

    // ビューのレンダリング（#sketch-stage を含む空のステージを描画）
    this.view.render(sketch);

    // スケッチ iframe を SketchFrame で差し込む
    const stage = document.getElementById('sketch-stage');
    if (stage) {
      this.sketchFrame = new SketchFrame(stage);
      // CursorManager / MouseEventHandler が #sketch-iframe で参照するので id を付ける（このページは frame 1 枚）
      this.sketchFrame.iframe.id = 'sketch-iframe';
      await this.sketchFrame.load(publicAssetPath(sketch.path));
    } else {
      console.warn('SketchPageController: #sketch-stage が見つかりません');
    }

    // 各マネージャーの初期化
    this.fullscreenManager.initialize();
    this.cursorManager.initialize();

    // ページ離脱時の警告を設定
    this.setupBeforeUnloadWarning();

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

    // フルスクリーン制御リクエストを監視
    window.addEventListener('message', this.messageHandler);

    // ウィンドウ開くボタンのイベント
    this.view.onOpenWindowsToggle(() => {
      console.log('SketchPageController: ウィンドウ開くボタンクリック');
      this.openWindows();
    });

    console.log('SketchPageController: イベントリスナーの設定完了');
  }

  private openWindows(): void {
    console.log('SketchPageController: ウィンドウコントローラーを使用してウィンドウを開きます');
    // クリックの user gesture 内で コントロール／出力ウィンドウを開く（スライドショーと同様）
    this.windowController.openBothWindows();
    this.windowController.openOutputWindow();

    // ウィンドウが開かれた後、Canvasストリーミングを開始（より長い遅延で確実に）
    this.openWindowsTimeout = setTimeout(() => {
      this.openWindowsTimeout = null;
      if (this.isDestroyed) return;
      void this.startCanvasStreamingToWindows();
      this.windowController.logWindowStatus();
    }, 2000); // 2秒後に実行
  }

  private async startCanvasStreamingToWindows(): Promise<void> {
    console.log('SketchPageController: Canvasストリーミング開始');

    const frame = this.sketchFrame;
    if (!frame) {
      console.warn('SketchPageController: SketchFrame がありません');
      return;
    }
    // iframe内のcanvasが読み込まれる（p5 の setup() で生成される）のを待ってから開始
    const canvas = await frame.whenCanvasReady();
    if (this.isDestroyed) return;
    if (canvas) {
      console.log('SketchPageController: Canvas要素が見つかりました。ストリーミング開始します');
      this.windowController.startCanvasStreaming(frame.iframe);
    } else {
      console.error('SketchPageController: Canvas要素が見つからないため、ストリーミングを開始できません');
    }
  }

  private isInternalNavigation = false;

  private beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    // 内部ナビゲーションの場合は警告を表示しない
    if (this.isInternalNavigation) {
      this.isInternalNavigation = false;
      return;
    }

    const message = 'このページを離れますか？';

    // 標準的なブラウザの離脱警告を表示
    event.preventDefault();
    event.returnValue = message;

    console.log('SketchPageController: ページ離脱警告を表示');
    return message;
  };

  private unloadHandler = () => {
    console.log('SketchPageController: ページアンロード - 開いているウィンドウを全て閉じます');
    this.windowController.closeAllWindows();
  };

  private pagehideHandler = () => {
    console.log('SketchPageController: ページ非表示 - 開いているウィンドウを全て閉じます');
    this.windowController.closeAllWindows();
  };

  private setupBeforeUnloadWarning(): void {
    // ページ離脱時に常に警告を表示
    window.addEventListener('beforeunload', this.beforeUnloadHandler);

    // ページが実際にアンロードされる時に開いているウィンドウを全て閉じる
    window.addEventListener('unload', this.unloadHandler);

    // ページが非表示になる時にもウィンドウを閉じる（ブラウザタブが閉じられた場合）
    window.addEventListener('pagehide', this.pagehideHandler);

    console.log('SketchPageController: ページ離脱警告とクリーンアップを設定しました');
  }

  setInternalNavigation(value: boolean): void {
    this.isInternalNavigation = value;
  }

  destroy(): void {
    console.log('SketchPageController: 破棄処理開始');
    this.isDestroyed = true;

    // 内部ナビゲーションフラグを設定
    this.isInternalNavigation = true;

    // イベントリスナーを削除
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    window.removeEventListener('unload', this.unloadHandler);
    window.removeEventListener('pagehide', this.pagehideHandler);
    window.removeEventListener('message', this.messageHandler);

    if (this.openWindowsTimeout) {
      clearTimeout(this.openWindowsTimeout);
      this.openWindowsTimeout = null;
    }

    // 各マネージャーの破棄
    this.fullscreenManager.destroy();
    this.sketchFrame?.dispose();
    this.sketchFrame = null;
    this.cursorManager.destroy();
    this.view.destroy();
    this.windowController.destroy();

    console.log('SketchPageController: 破棄処理完了');
  }
}
