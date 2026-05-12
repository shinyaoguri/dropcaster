import { MouseEventHandler } from '../ui/services/MouseEventHandler';

// フルスクリーン中、マウスが一定時間動かなかったらカーソルを隠す（スケッチ iframe 内も含む）。
export class CursorManager {
  private cursorHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private isFullscreenMode = false;
  private readonly CURSOR_HIDE_DELAY = 3000; // 3秒後にカーソルを非表示
  private mouseHandler: MouseEventHandler;

  constructor() {
    this.mouseHandler = new MouseEventHandler();
  }

  initialize(): void {
    this.showCursor();
    this.mouseHandler.initialize(this.handleMouseActivity);
  }

  setFullscreenMode(isFullscreen: boolean): void {
    this.isFullscreenMode = isFullscreen;
    if (isFullscreen) {
      this.enableAutoHide();
    } else {
      this.disableAutoHide();
      this.showCursor();
    }
  }

  private enableAutoHide(): void {
    this.mouseHandler.startListening();
    this.resetCursorTimer();
  }

  private disableAutoHide(): void {
    this.mouseHandler.stopListening();
    if (this.cursorHideTimeout) {
      clearTimeout(this.cursorHideTimeout);
      this.cursorHideTimeout = null;
    }
  }

  private handleMouseActivity = (): void => {
    if (this.isFullscreenMode) this.resetCursorTimer();
  };

  private resetCursorTimer(): void {
    if (this.cursorHideTimeout) clearTimeout(this.cursorHideTimeout);
    this.showCursor();
    this.cursorHideTimeout = setTimeout(() => this.hideCursor(), this.CURSOR_HIDE_DELAY);
  }

  private setCursor(value: 'none' | 'auto'): void {
    document.body.style.cursor = value;
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement | null;
    try {
      if (iframe?.contentDocument?.body) iframe.contentDocument.body.style.cursor = value;
    } catch {
      /* cross-origin など。無視 */
    }
  }

  private hideCursor(): void { this.setCursor('none'); }
  private showCursor(): void { this.setCursor('auto'); }

  destroy(): void {
    this.disableAutoHide();
    this.mouseHandler.destroy();
  }
}
