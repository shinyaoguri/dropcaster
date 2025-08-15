import { OverlayManager } from './OverlayManager';
import { CanvasSyncManager } from './CanvasSyncManager';
import { ResizeHandleManager } from './ResizeHandleManager';

export class ResizeManager {
  private overlayManager: OverlayManager;
  private canvasSyncManager: CanvasSyncManager;
  private handleManager: ResizeHandleManager;

  constructor() {
    this.overlayManager = new OverlayManager();
    this.canvasSyncManager = new CanvasSyncManager();
    this.handleManager = new ResizeHandleManager();
  }

  initialize(): void {
    this.overlayManager.initialize();
    this.setupResizeHandles();
  }

  private setupResizeHandles(): void {
    // オーバーレイが表示されるまで待機
    this.waitForOverlayAndSetup();
  }

  private waitForOverlayAndSetup(): void {
    const checkOverlay = () => {
      const overlay = document.getElementById('iframe-overlay');
      const mouseMonitor = document.getElementById('mouse-monitor-overlay');
      
      if (overlay && mouseMonitor && overlay.style.display !== 'none') {
        this.handleManager.initialize(overlay as HTMLDivElement, mouseMonitor as HTMLDivElement);
        this.handleManager.onResizeEnd(() => {
          const overlayElement = this.overlayManager.getOverlay();
          if (overlayElement) {
            this.canvasSyncManager.updateCanvasFromOverlay(overlayElement);
          }
        });
      } else {
        // まだ表示されていない場合は再試行
        setTimeout(checkOverlay, 100);
      }
    };
    
    checkOverlay();
  }

  syncOverlayWithCanvas(): void {
    this.overlayManager.syncWithCanvas();
  }

  destroy(): void {
    this.handleManager.destroy();
    this.overlayManager.destroy();
  }
}
