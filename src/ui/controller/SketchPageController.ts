import type { Sketch } from '../../types/sketch.js';
import { FullscreenManager } from '../services/FullscreenManager';
import { IframeManager } from '../services/IframeManager';
import { CursorManager } from '../services/CursorManager';
import { SketchPageView } from '../views/SketchPageView';

export class SketchPageController {
  private fullscreenManager: FullscreenManager;
  private iframeManager: IframeManager;
  private cursorManager: CursorManager;
  private view: SketchPageView;

  constructor() {
    this.fullscreenManager = new FullscreenManager();
    this.iframeManager = new IframeManager();
    this.cursorManager = new CursorManager();
    this.view = new SketchPageView();
  }

  async renderSketch(sketch: Sketch): Promise<void> {
    console.log('SketchPageController: スケッチのレンダリング開始:', sketch.title);
    
    // ビューのレンダリング
    this.view.render(sketch);
    
    // 各マネージャーの初期化
    await this.iframeManager.initialize(sketch);
    this.fullscreenManager.initialize();
    this.cursorManager.initialize();
    
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
      const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
      const isActive = windowSettingsBtn.classList.contains('settings-active');
      windowSettingsBtn.classList.toggle('settings-active', !isActive);
      
      this.iframeManager.toggleSettingsMode(!isActive);
    });
    
    console.log('SketchPageController: イベントリスナーの設定完了');
  }

  destroy(): void {
    console.log('SketchPageController: 破棄処理開始');
    this.fullscreenManager.destroy();
    this.iframeManager.destroy();
    this.cursorManager.destroy();
    this.view.destroy();
    console.log('SketchPageController: 破棄処理完了');
  }
}
