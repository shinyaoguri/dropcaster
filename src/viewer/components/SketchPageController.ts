import type { Sketch } from '../types/sketch.js';
import { FullscreenManager } from '../managers/FullscreenManager';
import { SketchFrame } from '../runtime/SketchFrame';
import { CursorManager } from '../managers/CursorManager';
import { SketchPageView } from './SketchPageView';
import { WindowController } from './WindowController';
import { BlackoutControl } from './BlackoutControl';
import { ControlWindow } from '../windows/control/ControlWindow';
import { InlineControlHost } from '../windows/control/InlineControlHost';
import { publicAssetPath } from '../utils/paths.js';
import { MappingWorkspace } from '../practice/MappingWorkspace';
import type { Project } from '../practice/project';
import type { MessageKey } from '../i18n/index.js';

export class SketchPageController {
  private fullscreenManager: FullscreenManager;
  private sketchFrame: SketchFrame | null = null;
  private cursorManager: CursorManager;
  private view: SketchPageView;
  private windowController: WindowController;
  private isDestroyed = false;
  /** projection 中だけ #dc-inline-editor 内にマウントする ControlWindow（inline 経路）。 */
  private inlinePanel: ControlWindow | null = null;
  private workspace: MappingWorkspace;
  private sketch: Sketch | null = null;
  private blackout: BlackoutControl | null = null;

  constructor() {
    this.fullscreenManager = new FullscreenManager();
    this.cursorManager = new CursorManager();
    this.view = new SketchPageView();
    this.windowController = new WindowController();
    this.workspace = new MappingWorkspace({ wc: this.windowController, getFrame: () => this.sketchFrame,
      mountEditor: () => this.mountInlineEditor(), unmountEditor: () => this.unmountInlineEditor(), getContext: () => ({ sketches: this.sketch ? [this.sketch] : [], currentIndex: 0, intervalSeconds: 30 }) });
  }

  async renderSketch(sketch: Sketch): Promise<void> {
    this.isDestroyed = false;
    this.sketch = sketch;

    // ビューのレンダリング（#sketch-stage を含む空のステージを描画）
    this.view.render(sketch);
    this.setupEventListeners();
    // ブラックアウト (#194): 右上のボタンと B キー。編集中も B は効く。
    this.blackout?.dispose();
    this.blackout = new BlackoutControl(this.windowController, document.getElementById('blackout-btn') as HTMLButtonElement | null);

    // スケッチ iframe を SketchFrame で差し込む
    const stage = document.getElementById('sketch-stage');
    if (stage) {
      this.sketchFrame = new SketchFrame(stage);
      // CursorManager / MouseEventHandler が #sketch-iframe で参照するので id を付ける（このページは frame 1 枚）
      this.sketchFrame.iframe.id = 'sketch-iframe';
    } else {
      console.warn('SketchPageController: #sketch-stage が見つかりません');
    }

    // 全画面の購読は作品の読み込みを待たない。⛶ は描画直後から押せるので、読み込み中の全画面も
    // 表示（.fullscreen・マッピングの入口・UI とカーソルの自動非表示）へ反映する (#103)
    this.fullscreenManager.initialize();
    this.cursorManager.initialize();

    if (this.sketchFrame) {
      if (sketch.srcdoc) {
        // OP 由来など、組み立て済み HTML を直接 srcdoc にロードする経路
        await this.sketchFrame.loadSrcdoc(sketch.srcdoc, { tag: sketch.id });
      } else {
        await this.sketchFrame.load(publicAssetPath(sketch.path));
      }
    }
    if (this.isDestroyed) return;

    // ページ離脱時の警告を設定
    this.setupBeforeUnloadWarning();

  }

  async openProject(project: Project): Promise<void> { await this.workspace.openProject(project); }
  reportMappingError(key: MessageKey): boolean { return !this.isDestroyed && this.workspace.report(key); }
  async startMapping(): Promise<void> { if (!this.isDestroyed) await this.workspace.start(); }

  /**
   * #dc-inline-editor に ControlPanel をマウントする。
   * canonical state は WindowController が保持し、ペインはその mirror をレンダリングする
   * （WindowController.events 経由）。
   */
  private mountInlineEditor(): ControlWindow | null {
    if (this.inlinePanel) return this.inlinePanel;
    const aside = document.getElementById('dc-inline-editor');
    if (!aside) return null;
    aside.removeAttribute('hidden');
    this.view.setMappingActive(true);
    this.inlinePanel = new ControlWindow();
    this.inlinePanel.mountInline(aside, (shell) =>
      new InlineControlHost(window, shell, this.windowController),
    );
    // 既にストリームが流れていれば bind し直す（mount が broadcastStream より後に来た場合の保険）
    this.windowController.rebindStreamToInlinePanel();
    return this.inlinePanel;
  }

  private unmountInlineEditor(): void {
    if (!this.inlinePanel) return;
    this.inlinePanel.destroy(); // ControlHost の購読を全部外す（WindowController.events リーク防止）
    this.inlinePanel = null;
    this.view.setMappingActive(false);
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

    this.view.onOpenWindowsToggle(() => this.workspace.toggle());
  }

  private isInternalNavigation = false;

  private beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    // 内部ナビゲーションの場合は警告を表示しない
    if (this.isInternalNavigation) {
      this.isInternalNavigation = false;
      return;
    }

    // モダンブラウザは security 上この message を表示せず汎用文言を出すので、内容は実質無視される
    const message = 'Leave this page?';

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

    this.workspace.dispose();
    this.blackout?.dispose(); this.blackout = null;
    this.unmountInlineEditor();
    this.fullscreenManager.destroy();
    this.sketchFrame?.dispose();
    this.sketchFrame = null;
    this.cursorManager.destroy();
    this.view.destroy();
    this.windowController.destroy();
  }
}
