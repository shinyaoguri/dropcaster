import { OverlayManager } from './OverlayManager';
import { ResizeHandleManager } from './ResizeHandleManager';

export class ResizeManager {
  private overlayManager: OverlayManager;
  private handleManager: ResizeHandleManager;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private readonly maxRetries = 20;

  constructor() {
    this.overlayManager = new OverlayManager();
    this.handleManager = new ResizeHandleManager();
  }

  initialize(): void {
    this.overlayManager.initialize();
    this.setupResizeHandles();
  }

  private setupResizeHandles(): void {
    // オーバーレイが表示されるまで待機
    this.retryCount = 0;
    this.waitForOverlayAndSetup();
  }

  private waitForOverlayAndSetup(): void {
    const checkOverlay = () => {
      const overlay = document.getElementById('iframe-overlay');
      const mouseMonitor = document.getElementById('mouse-monitor-overlay');
      const hasResizeHandles = !!overlay?.querySelector('.resize-handle');
      
      if (overlay && mouseMonitor && hasResizeHandles && overlay.style.display !== 'none') {
        this.handleManager.initialize(overlay as HTMLDivElement, mouseMonitor as HTMLDivElement);
      } else if (this.retryCount < this.maxRetries) {
        this.retryCount += 1;
        // まだ表示されていない場合は再試行
        this.retryTimeout = setTimeout(checkOverlay, 100);
      } else {
        this.retryTimeout = null;
      }
    };
    
    checkOverlay();
  }


  destroy(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.handleManager.destroy();
    this.overlayManager.destroy();
  }
}
