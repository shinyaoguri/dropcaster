import type { Sketch } from '../types/sketch.js';
import { FullscreenManager } from '../managers/FullscreenManager';
import { SketchFrame } from '../runtime/SketchFrame';
import { CursorManager } from '../managers/CursorManager';
import { SketchPageView } from './SketchPageView';
import { WindowController } from './WindowController';
import { ControlWindow } from '../windows/control/ControlWindow';
import { InlineControlHost } from '../windows/control/InlineControlHost';
import { publicAssetPath } from '../utils/paths.js';

export class SketchPageController {
  private fullscreenManager: FullscreenManager;
  private sketchFrame: SketchFrame | null = null;
  private cursorManager: CursorManager;
  private view: SketchPageView;
  private windowController: WindowController;
  private openWindowsTimeout: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;
  /** projection 中だけ #dc-inline-editor 内にマウントする ControlWindow（inline 経路）。 */
  private inlinePanel: ControlWindow | null = null;
  /** unsubscribe: projection-mode-change のリスナを destroy で外すため。 */
  private boundProjectionChange = (e: Event) => this.handleProjectionChange(e);

  constructor() {
    this.fullscreenManager = new FullscreenManager();
    this.cursorManager = new CursorManager();
    this.view = new SketchPageView();
    this.windowController = new WindowController();
  }

  async renderSketch(sketch: Sketch): Promise<void> {
    this.isDestroyed = false;

    // ビューのレンダリング（#sketch-stage を含む空のステージを描画）
    this.view.render(sketch);

    // スケッチ iframe を SketchFrame で差し込む
    const stage = document.getElementById('sketch-stage');
    if (stage) {
      this.sketchFrame = new SketchFrame(stage);
      // CursorManager / MouseEventHandler が #sketch-iframe で参照するので id を付ける（このページは frame 1 枚）
      this.sketchFrame.iframe.id = 'sketch-iframe';
      if (sketch.srcdoc) {
        // OP 由来など、組み立て済み HTML を直接 srcdoc にロードする経路
        await this.sketchFrame.loadSrcdoc(sketch.srcdoc, { tag: sketch.id });
      } else {
        await this.sketchFrame.load(publicAssetPath(sketch.path));
      }
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

    // 投影モードの開始／終了で inline ペインを mount／teardown
    window.addEventListener('projection-mode-change', this.boundProjectionChange);
  }

  private handleProjectionChange(event: Event): void {
    const active = !!(event as CustomEvent).detail?.active;
    if (active) this.mountInlineEditor();
    else this.unmountInlineEditor();
  }

  /**
   * #dc-inline-editor に ControlPanel をマウントする。
   * canonical state は WindowController が保持し、ペインはその mirror をレンダリングする
   * （WindowController.events 経由）。
   */
  private mountInlineEditor(): void {
    if (this.inlinePanel) return; // 既に mount 済み
    const aside = document.getElementById('dc-inline-editor');
    if (!aside) return;
    aside.removeAttribute('hidden');
    this.inlinePanel = new ControlWindow();
    this.inlinePanel.mountInline(aside, (shell) =>
      new InlineControlHost(window, shell, this.windowController),
    );
    // 既にストリームが流れていれば bind し直す（mount が broadcastStream より後に来た場合の保険）
    this.windowController.rebindStreamToInlinePanel();
  }

  private unmountInlineEditor(): void {
    if (!this.inlinePanel) return;
    this.inlinePanel.destroy(); // ControlHost の購読を全部外す（WindowController.events リーク防止）
    this.inlinePanel = null;
    const aside = document.getElementById('dc-inline-editor');
    if (aside) {
      aside.setAttribute('hidden', '');
      aside.innerHTML = '';
    }
  }

  private setupEventListeners(): void {
    // フルスクリーン状態の変更を監視
    this.fullscreenManager.onFullscreenChange((isFullscreen: boolean) => {
      this.cursorManager.setFullscreenMode(isFullscreen);
      this.view.updateFullscreenState(isFullscreen);
    });

    // ウィンドウ開くボタンのイベント
    this.view.onOpenWindowsToggle(() => this.openWindows());
  }

  private openWindows(): void {
    // クリックの user gesture 内で出力ウィンドウを開く。
    // 編集 UI は inline ペインとして main の右側に出てくる。
    this.windowController.openOutputWindow();
    // inline panel を即マウントしておく。startCanvasStreaming 内の broadcastStream が
    // 走るより前にペイン内 <video> を DOM に存在させて、bind を確実に届くようにするため。
    this.mountInlineEditor();

    // 出力ウィンドウが開かれた後、Canvas ストリーミングを開始（少し待って確実に）
    this.openWindowsTimeout = setTimeout(() => {
      this.openWindowsTimeout = null;
      if (this.isDestroyed) return;
      void this.startCanvasStreamingToWindows();
    }, 2000);
  }

  private async startCanvasStreamingToWindows(): Promise<void> {
    const frame = this.sketchFrame;
    if (!frame) return;
    // iframe内のcanvasが読み込まれる（p5 の setup() で生成される）のを待ってから開始
    const canvas = await frame.whenCanvasReady();
    if (this.isDestroyed) return;
    if (canvas) {
      this.windowController.startCanvasStreaming(frame.iframe);
    } else {
      console.error('SketchPageController: Canvas が見つからないため、プロジェクションを開始できません');
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
    return message;
  };

  private pagehideHandler = () => {
    this.windowController.closeAllWindows();
  };

  private setupBeforeUnloadWarning(): void {
    // ページ離脱時に常に警告を表示
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    // ページが破棄／非表示になる時に開いているウィンドウを全て閉じる
    // （unload は非推奨で bfcache も阻害するので pagehide のみ）
    window.addEventListener('pagehide', this.pagehideHandler);
  }

  setInternalNavigation(value: boolean): void {
    this.isInternalNavigation = value;
  }

  destroy(): void {
    this.isDestroyed = true;
    this.isInternalNavigation = true; // 内部ナビゲーション扱いで離脱警告を出さない

    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    window.removeEventListener('pagehide', this.pagehideHandler);
    window.removeEventListener('projection-mode-change', this.boundProjectionChange);

    if (this.openWindowsTimeout) {
      clearTimeout(this.openWindowsTimeout);
      this.openWindowsTimeout = null;
    }

    this.unmountInlineEditor();
    this.fullscreenManager.destroy();
    this.sketchFrame?.dispose();
    this.sketchFrame = null;
    this.cursorManager.destroy();
    this.view.destroy();
    this.windowController.destroy();
  }
}
