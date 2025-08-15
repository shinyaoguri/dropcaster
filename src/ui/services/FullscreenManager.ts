import { EventEmitter } from '../../core/events/EventEmitter';
import { UIElementController } from './UIElementController';
import { MouseEventHandler } from './MouseEventHandler';

export class FullscreenManager {
  private eventEmitter: EventEmitter;
  private isFullscreen = false;
  private uiHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly UI_HIDE_DELAY = 3000; // 3秒後にUI要素を非表示
  private uiController: UIElementController;
  private mouseHandler: MouseEventHandler;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.uiController = new UIElementController();
    this.mouseHandler = new MouseEventHandler();
  }

  initialize(): void {
    // フルスクリーン状態の変更を監視
    document.addEventListener('fullscreenchange', this.handleFullscreenChange.bind(this));
    
    // マウスイベントハンドラーを初期化
    this.mouseHandler.initialize(this.handleMouseActivity);
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
      this.mouseHandler.startListening();
    } else if (!this.isFullscreen && wasFullscreen) {
      // フルスクリーン終了時
      console.log('フルスクリーン終了: UI要素を表示状態に戻す');
      this.stopUIHideTimer();
      this.mouseHandler.stopListening();
      this.uiController.showElements();
    }
    
    this.eventEmitter.emit('fullscreenChange', this.isFullscreen);
  }

  private startUIHideTimer(): void {
    this.stopUIHideTimer(); // 既存のタイマーをクリア
    console.log('UI非表示タイマー開始:', this.UI_HIDE_DELAY + 'ms');
    this.uiHideTimeout = setTimeout(() => {
      console.log('UI非表示タイマー完了: UI要素を非表示');
      this.uiController.hideElements();
    }, this.UI_HIDE_DELAY);
  }

  private stopUIHideTimer(): void {
    if (this.uiHideTimeout) {
      console.log('UI非表示タイマーを停止');
      clearTimeout(this.uiHideTimeout);
      this.uiHideTimeout = null;
    }
  }

  private handleMouseActivity = (event: Event): void => {
    if (this.isFullscreen) {
      console.log('マウス操作を検知:', event.type, 'UI要素を表示');
      this.uiController.showElements();
      this.startUIHideTimer(); // タイマーをリセット
    }
  };

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
    this.mouseHandler.destroy();
    this.eventEmitter.removeAllListeners();
  }
}
