import { EventEmitter } from '../../core/events/EventEmitter';

export class CursorManager {
  private eventEmitter: EventEmitter;
  private cursorHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private isFullscreenMode = false;
  private readonly CURSOR_HIDE_DELAY = 3000; // 3秒後にカーソルを非表示

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  initialize(): void {
    // 初期状態ではカーソルを表示
    this.showCursor();
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
    this.addMouseEventListeners();
    
    // 初期タイマーを開始
    this.resetCursorTimer();
  }

  private disableAutoHide(): void {
    console.log('CursorManager: カーソル自動非表示を無効化');
    // マウス操作のイベントリスナーを削除
    this.removeMouseEventListeners();
    
    // タイマーをクリア
    if (this.cursorHideTimeout) {
      clearTimeout(this.cursorHideTimeout);
      this.cursorHideTimeout = null;
    }
  }

  private addMouseEventListeners(): void {
    console.log('CursorManager: マウス操作リスナーを追加');
    const events = ['mousemove', 'mousedown', 'wheel', 'mouseenter', 'keydown', 'keyup'];
    
    events.forEach(eventType => {
      document.addEventListener(eventType, this.handleMouseActivity.bind(this), { passive: true });
    });

    // iframe内のイベントも監視
    this.addIframeEventListeners();
  }

  private removeMouseEventListeners(): void {
    console.log('CursorManager: マウス操作リスナーを削除');
    const events = ['mousemove', 'mousedown', 'wheel', 'mouseenter', 'keydown', 'keyup'];
    
    events.forEach(eventType => {
      document.removeEventListener(eventType, this.handleMouseActivity.bind(this));
    });

    // iframe内のイベントリスナーも削除
    this.removeIframeEventListeners();
  }

  private addIframeEventListeners(): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe) return;

    console.log('CursorManager: iframe内のイベントリスナーを追加');
    const events = ['mousemove', 'mousedown', 'wheel', 'keydown', 'keyup'];
    
    iframe.addEventListener('load', () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          events.forEach(eventType => {
            iframeDoc.addEventListener(eventType, this.handleMouseActivity.bind(this), { passive: true });
          });
          console.log('CursorManager: iframe内のイベントリスナー設定完了');
        }
      } catch (e) {
        console.log('CursorManager: iframe内のイベントリスナー設定に失敗:', e);
      }
    });
  }

  private removeIframeEventListeners(): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe) return;

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const events = ['mousemove', 'mousedown', 'wheel', 'keydown', 'keyup'];
        events.forEach(eventType => {
          iframeDoc.removeEventListener(eventType, this.handleMouseActivity.bind(this));
        });
        console.log('CursorManager: iframe内のイベントリスナー削除完了');
      }
    } catch (e) {
      console.log('CursorManager: iframe内のイベントリスナー解除に失敗:', e);
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
    this.eventEmitter.removeAllListeners();
  }
}
