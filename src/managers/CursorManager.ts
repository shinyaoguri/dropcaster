import { EventEmitter } from '../events/EventEmitter';
import { MouseEventHandler } from '../ui/services/MouseEventHandler';

export class CursorManager {
  private eventEmitter: EventEmitter;
  private cursorHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private isFullscreenMode = false;
  private readonly CURSOR_HIDE_DELAY = 3000; // 3秒後にカーソルを非表示
  private mouseHandler: MouseEventHandler;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.mouseHandler = new MouseEventHandler();
  }

  initialize(): void {
    // 初期状態ではカーソルを表示
    this.showCursor();
    
    // マウスイベントハンドラーを初期化
    this.mouseHandler.initialize(this.handleMouseActivity);
  }

  setFullscreenMode(isFullscreen: boolean): void {
    console.log('CursorManager: フルスクリーンモード設定:', isFullscreen);
    this.isFullscreenMode = isFullscreen;
    
    if (isFullscreen) {
      this.enableAutoHide();
    } else {
      this.disableAutoHide();
      this.showCursor();
    }
  }

  private enableAutoHide(): void {
    console.log('CursorManager: カーソル自動非表示を有効化');
    // マウス操作のイベントリスナーを追加
    this.mouseHandler.startListening();
    
    // 初期タイマーを開始
    this.resetCursorTimer();
  }

  private disableAutoHide(): void {
    console.log('CursorManager: カーソル自動非表示を無効化');
    // マウス操作のイベントリスナーを削除
    this.mouseHandler.stopListening();
    
    // タイマーをクリア
    if (this.cursorHideTimeout) {
      clearTimeout(this.cursorHideTimeout);
      this.cursorHideTimeout = null;
    }
  }


  private handleMouseActivity = (event: Event): void => {
    if (this.isFullscreenMode) {
      console.log('CursorManager: マウス操作を検知:', event.type, 'カーソルタイマーをリセット');
      this.resetCursorTimer();
    }
  };

  private resetCursorTimer(): void {
    if (this.cursorHideTimeout) {
      clearTimeout(this.cursorHideTimeout);
    }
    
    this.showCursor();
    this.cursorHideTimeout = setTimeout(() => {
      this.hideCursor();
    }, this.CURSOR_HIDE_DELAY);
    
    console.log('CursorManager: カーソルタイマーをリセット:', this.CURSOR_HIDE_DELAY + 'ms');
  }

  private hideCursor(): void {
    console.log('CursorManager: カーソルを非表示にします');
    document.body.style.cursor = 'none';
    
    // iframe内のカーソルも非表示にする
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentDocument) {
      try {
        iframe.contentDocument.body.style.cursor = 'none';
      } catch (e) {
        // CORSエラーの場合は無視
      }
    }
    
    this.eventEmitter.emit('cursorHidden');
  }

  private showCursor(): void {
    console.log('CursorManager: カーソルを表示します');
    document.body.style.cursor = 'auto';
    
    // iframe内のカーソルも表示する
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentDocument) {
      try {
        iframe.contentDocument.body.style.cursor = 'auto';
      } catch (e) {
        // CORSエラーの場合は無視
      }
    }
    
    this.eventEmitter.emit('cursorShown');
  }

  onCursorHidden(callback: () => void): void {
    this.eventEmitter.on('cursorHidden', callback);
  }

  onCursorShown(callback: () => void): void {
    this.eventEmitter.on('cursorShown', callback);
  }

  destroy(): void {
    this.disableAutoHide();
    this.mouseHandler.destroy();
    this.eventEmitter.removeAllListeners();
  }
}
