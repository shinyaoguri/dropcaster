import { UIElementController } from '../ui/services/UIElementController';
import { MouseEventHandler } from '../ui/services/MouseEventHandler';

// fullscreenchange を監視し、フルスクリーン中は一定時間操作が無ければ UI 要素（ボタン等）を隠す。
// フルスクリーン状態の変化は onFullscreenChange で通知する。
export class FullscreenManager {
  private fullscreenChangeCallback: ((isFullscreen: boolean) => void) | null = null;
  private isFullscreen = false;
  private uiHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly UI_HIDE_DELAY = 3000; // 3秒後にUI要素を非表示
  private uiController: UIElementController;
  private mouseHandler: MouseEventHandler;
  private boundFullscreenChange = this.handleFullscreenChange.bind(this);

  constructor() {
    this.uiController = new UIElementController();
    this.mouseHandler = new MouseEventHandler();
  }

  initialize(): void {
    document.addEventListener('fullscreenchange', this.boundFullscreenChange);
    this.mouseHandler.initialize(this.handleMouseActivity);
  }

  private handleFullscreenChange(): void {
    const wasFullscreen = this.isFullscreen;
    this.isFullscreen = !!document.fullscreenElement;

    if (this.isFullscreen && !wasFullscreen) {
      this.startUIHideTimer();
      this.mouseHandler.startListening();
    } else if (!this.isFullscreen && wasFullscreen) {
      this.stopUIHideTimer();
      this.mouseHandler.stopListening();
      this.uiController.showElements();
    }

    this.fullscreenChangeCallback?.(this.isFullscreen);
  }

  private startUIHideTimer(): void {
    this.stopUIHideTimer();
    this.uiHideTimeout = setTimeout(() => this.uiController.hideElements(), this.UI_HIDE_DELAY);
  }

  private stopUIHideTimer(): void {
    if (this.uiHideTimeout) {
      clearTimeout(this.uiHideTimeout);
      this.uiHideTimeout = null;
    }
  }

  private handleMouseActivity = (): void => {
    if (this.isFullscreen) {
      this.uiController.showElements();
      this.startUIHideTimer();
    }
  };

  onFullscreenChange(callback: (isFullscreen: boolean) => void): void {
    this.fullscreenChangeCallback = callback;
  }

  destroy(): void {
    this.stopUIHideTimer();
    document.removeEventListener('fullscreenchange', this.boundFullscreenChange);
    this.mouseHandler.destroy();
    this.fullscreenChangeCallback = null;
  }
}
