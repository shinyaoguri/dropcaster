import { OverlayManager } from './OverlayManager';
import { ResizeHandleManager } from './ResizeHandleManager';

export class ResizeManager {
  private overlayManager: OverlayManager;
  private handleManager: ResizeHandleManager;

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
    this.waitForOverlayAndSetup();
  }

  private waitForOverlayAndSetup(): void {
    const checkOverlay = () => {
      const overlay = document.getElementById('iframe-overlay');
      const mouseMonitor = document.getElementById('mouse-monitor-overlay');
      
      if (overlay && mouseMonitor && overlay.style.display !== 'none') {
        this.handleManager.initialize(overlay as HTMLDivElement, mouseMonitor as HTMLDivElement);
      } else {
        // まだ表示されていない場合は再試行
        setTimeout(checkOverlay, 100);
      }
    };
    
    checkOverlay();
  }


  destroy(): void {
    this.handleManager.destroy();
    this.overlayManager.destroy();
  }
}
