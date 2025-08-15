import { EventEmitter } from '../../core/events/EventEmitter';

export class FullscreenManager {
  private eventEmitter: EventEmitter;
  private isFullscreen = false;
  private uiHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly UI_HIDE_DELAY = 3000; // 3秒後にUI要素を非表示

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  initialize(): void {
    // フルスクリーン状態の変更を監視
    document.addEventListener('fullscreenchange', this.handleFullscreenChange.bind(this));
  }

  toggleFullscreen(container: HTMLElement): void {
    if (this.isFullscreen) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen().catch(err => {
        console.error('フルスクリーン化に失敗しました:', err);
      });
    }
  }

  private handleFullscreenChange(): void {
    const wasFullscreen = this.isFullscreen;
    this.isFullscreen = !!document.fullscreenElement;
    
    console.log('フルスクリーン状態変更:', this.isFullscreen);
    
    if (this.isFullscreen && !wasFullscreen) {
      // フルスクリーン開始時
      console.log('フルスクリーン開始: UI非表示タイマーを開始');
      this.startUIHideTimer();
      this.addMouseActivityListeners();
    } else if (!this.isFullscreen && wasFullscreen) {
      // フルスクリーン終了時
      console.log('フルスクリーン終了: UI要素を表示状態に戻す');
      this.stopUIHideTimer();
      this.removeMouseActivityListeners();
      this.showUIElements();
    }
    
    this.eventEmitter.emit('fullscreenChange', this.isFullscreen);
  }

  private startUIHideTimer(): void {
    this.stopUIHideTimer(); // 既存のタイマーをクリア
    console.log('UI非表示タイマー開始:', this.UI_HIDE_DELAY + 'ms');
    this.uiHideTimeout = setTimeout(() => {
      console.log('UI非表示タイマー完了: UI要素を非表示');
      this.hideUIElements();
    }, this.UI_HIDE_DELAY);
  }

  private stopUIHideTimer(): void {
    if (this.uiHideTimeout) {
      console.log('UI非表示タイマーを停止');
      clearTimeout(this.uiHideTimeout);
      this.uiHideTimeout = null;
    }
  }

  private addMouseActivityListeners(): void {
    console.log('マウス操作リスナーを追加');
    const events = ['mousemove', 'mousedown', 'wheel', 'mouseenter', 'keydown', 'keyup'];
    
    events.forEach(eventType => {
      document.addEventListener(eventType, this.handleMouseActivity.bind(this), { passive: true });
    });

    // iframe内のイベントも監視
    this.addIframeEventListeners();
  }

  private removeMouseActivityListeners(): void {
    console.log('マウス操作リスナーを削除');
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

    console.log('iframe内のイベントリスナーを追加');
    const events = ['mousemove', 'mousedown', 'wheel', 'keydown', 'keyup'];
    
    iframe.addEventListener('load', () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          events.forEach(eventType => {
            iframeDoc.addEventListener(eventType, this.handleMouseActivity.bind(this), { passive: true });
          });
          console.log('iframe内のイベントリスナー設定完了');
        }
      } catch (e) {
        console.log('iframe内のイベントリスナー設定に失敗:', e);
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
        console.log('iframe内のイベントリスナー削除完了');
      }
    } catch (e) {
      console.log('iframe内のイベントリスナー解除に失敗:', e);
    }
  }

  private handleMouseActivity = (event: Event): void => {
    if (this.isFullscreen) {
      console.log('マウス操作を検知:', event.type, 'UI要素を表示');
      this.showUIElements();
      this.startUIHideTimer(); // タイマーをリセット
    }
  };

  private hideUIElements(): void {
    console.log('UI要素を非表示にします');
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;

    if (fullscreenBtn) {
      fullscreenBtn.style.opacity = '0';
      fullscreenBtn.style.pointerEvents = 'none';
      console.log('フルスクリーンボタンを非表示');
    }
    if (windowSettingsBtn) {
      windowSettingsBtn.style.opacity = '0';
      windowSettingsBtn.style.pointerEvents = 'none';
      console.log('ウィンドウ設定ボタンを非表示');
    }
    if (overlayInfo) {
      overlayInfo.style.opacity = '0';
      overlayInfo.style.pointerEvents = 'none';
      console.log('ユーザー情報を非表示');
    }

    this.eventEmitter.emit('uiHidden');
  }

  private showUIElements(): void {
    console.log('UI要素を表示します');
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const windowSettingsBtn = document.getElementById('window-settings-btn') as HTMLButtonElement;
    const overlayInfo = document.querySelector('.sketch-overlay-info') as HTMLDivElement;

    if (fullscreenBtn) {
      fullscreenBtn.style.opacity = '1';
      fullscreenBtn.style.pointerEvents = 'auto';
      console.log('フルスクリーンボタンを表示');
    }
    if (windowSettingsBtn) {
      windowSettingsBtn.style.opacity = '1';
      windowSettingsBtn.style.pointerEvents = 'auto';
      console.log('ウィンドウ設定ボタンを表示');
    }
    if (overlayInfo) {
      overlayInfo.style.opacity = '1';
      overlayInfo.style.pointerEvents = 'auto';
      console.log('ユーザー情報を表示');
    }

    this.eventEmitter.emit('uiShown');
  }

  onFullscreenChange(callback: (isFullscreen: boolean) => void): void {
    this.eventEmitter.on('fullscreenChange', callback);
  }

  onUIHidden(callback: () => void): void {
    this.eventEmitter.on('uiHidden', callback);
  }

  onUIShown(callback: () => void): void {
    this.eventEmitter.on('uiShown', callback);
  }

  getFullscreenState(): boolean {
    return this.isFullscreen;
  }

  destroy(): void {
    this.stopUIHideTimer();
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange.bind(this));
    this.removeMouseActivityListeners();
    this.eventEmitter.removeAllListeners();
  }
}
