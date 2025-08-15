export class ResizeManager {
  private isResizing = false;
  private currentHandle: string | null = null;
  private startX = 0;
  private startY = 0;
  private startWidth = 0;
  private startHeight = 0;
  private startLeft = 0;
  private startTop = 0;
  private overlay: HTMLDivElement | null = null;
  private mouseMonitor: HTMLDivElement | null = null;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: () => void;

  constructor() {
    // イベントハンドラーを事前にバインド
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
  }

  initialize(): void {
    this.setupResizeHandles();
  }

  private setupResizeHandles(): void {
    // iframeの外側に配置されたオーバーレイのハンドルを設定
    this.waitForOverlayAndSetup();
  }

  private waitForOverlayAndSetup(): void {
    // オーバーレイが表示されるまで待機
    const checkOverlay = () => {
      const overlay = document.getElementById('iframe-overlay');
      const mouseMonitor = document.getElementById('mouse-monitor-overlay');
      
      if (overlay && mouseMonitor && overlay.style.display !== 'none') {
        this.overlay = overlay as HTMLDivElement;
        this.mouseMonitor = mouseMonitor as HTMLDivElement;
        this.setupHandles();
      } else {
        // まだ表示されていない場合は再試行
        setTimeout(checkOverlay, 100);
      }
    };
    
    checkOverlay();
  }

  private setupHandles(): void {
    if (!this.overlay) return;

    const handles = this.overlay.querySelectorAll('.resize-handle');
    
    handles.forEach(handle => {
      const handleElement = handle as HTMLElement;
      const handleType = handleElement.dataset.handle;
      
      if (handleType) {
        // マウスダウンイベント
        handleElement.addEventListener('mousedown', (e) => {
          this.startResize(e, handleType);
        });
      }
    });

    console.log('iframe外側オーバーレイのリサイズハンドルを設定しました（マウス監視対応）');
  }

  private startResize(e: MouseEvent, handleType: string): void {
    e.preventDefault();
    e.stopPropagation();

    if (!this.overlay) return;

    this.isResizing = true;
    this.currentHandle = handleType;
    
    // 現在の位置とサイズを取得
    const rect = this.overlay.getBoundingClientRect();
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startWidth = rect.width;
    this.startHeight = rect.height;
    this.startLeft = rect.left;
    this.startTop = rect.top;

    // ドラッグ中のスタイルを適用
    const handleElement = this.overlay.querySelector(`[data-handle="${handleType}"]`) as HTMLElement;
    if (handleElement) {
      handleElement.classList.add('dragging');
    }

    // カーソルスタイルを設定
    document.body.style.cursor = this.getCursorStyle(handleType);
    
    // マウス監視を開始
    this.startMouseMonitoring();
    
    console.log('リサイズ開始:', handleType, '開始位置:', this.startX, this.startY);
  }

  private startMouseMonitoring(): void {
    if (!this.mouseMonitor) return;
    
    // マウス監視用divにイベントリスナーを追加
    this.mouseMonitor.addEventListener('mousemove', this.boundHandleMouseMove);
    this.mouseMonitor.addEventListener('mouseup', this.boundHandleMouseUp);
    
    // ドキュメント全体にもイベントリスナーを追加（念のため）
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
  }

  private stopMouseMonitoring(): void {
    if (!this.mouseMonitor) return;
    
    // マウス監視用divからイベントリスナーを削除
    this.mouseMonitor.removeEventListener('mousemove', this.boundHandleMouseMove);
    this.mouseMonitor.removeEventListener('mouseup', this.boundHandleMouseUp);
    
    // ドキュメント全体からもイベントリスナーを削除
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
  }

  private handleMouseMove(e: MouseEvent): void {
    // リサイズ中でない場合は何もしない
    if (!this.isResizing || !this.currentHandle || !this.overlay) return;

    const deltaX = e.clientX - this.startX;
    const deltaY = e.clientY - this.startY;

    // ハンドルの種類に応じてリサイズ処理
    switch (this.currentHandle) {
      case 'top-left':
        this.resizeTopLeft(deltaX, deltaY);
        break;
      case 'top-right':
        this.resizeTopRight(deltaX, deltaY);
        break;
      case 'bottom-left':
        this.resizeBottomLeft(deltaX, deltaY);
        break;
      case 'bottom-right':
        this.resizeBottomRight(deltaX, deltaY);
        break;
    }
  }

  private handleMouseUp(): void {
    if (!this.isResizing) return;

    this.isResizing = false;
    
    // ドラッグ中のスタイルを解除
    if (this.currentHandle && this.overlay) {
      const handleElement = this.overlay.querySelector(`[data-handle="${this.currentHandle}"]`) as HTMLElement;
      if (handleElement) {
        handleElement.classList.remove('dragging');
      }
    }

    // カーソルスタイルをリセット
    document.body.style.cursor = 'auto';
    
    // マウス監視を停止
    this.stopMouseMonitoring();
    
    console.log('リサイズ終了:', this.currentHandle);
    this.currentHandle = null;
  }

  private resizeTopLeft(deltaX: number, deltaY: number): void {
    if (!this.overlay) return;
    
    const newWidth = Math.max(100, this.startWidth - deltaX);
    const newHeight = Math.max(100, this.startHeight - deltaY);
    const newLeft = this.startLeft + (this.startWidth - newWidth);
    const newTop = this.startTop + (this.startHeight - newHeight);

    this.overlay.style.width = `${newWidth}px`;
    this.overlay.style.height = `${newHeight}px`;
    this.overlay.style.left = `${newLeft}px`;
    this.overlay.style.top = `${newTop}px`;
  }

  private resizeTopRight(deltaX: number, deltaY: number): void {
    if (!this.overlay) return;
    
    const newWidth = Math.max(100, this.startWidth + deltaX);
    const newHeight = Math.max(100, this.startHeight - deltaY);
    const newTop = this.startTop + (this.startHeight - newHeight);

    this.overlay.style.width = `${newWidth}px`;
    this.overlay.style.height = `${newHeight}px`;
    this.overlay.style.top = `${newTop}px`;
  }

  private resizeBottomLeft(deltaX: number, deltaY: number): void {
    if (!this.overlay) return;
    
    const newWidth = Math.max(100, this.startWidth - deltaX);
    const newHeight = Math.max(100, this.startHeight + deltaY);
    const newLeft = this.startLeft + (this.startWidth - newWidth);

    this.overlay.style.width = `${newWidth}px`;
    this.overlay.style.height = `${newHeight}px`;
    this.overlay.style.left = `${newLeft}px`;
  }

  private resizeBottomRight(deltaX: number, deltaY: number): void {
    if (!this.overlay) return;
    
    const newWidth = Math.max(100, this.startWidth + deltaX);
    const newHeight = Math.max(100, this.startHeight + deltaY);

    this.overlay.style.width = `${newWidth}px`;
    this.overlay.style.height = `${newHeight}px`;
  }

  private getCursorStyle(handleType: string): string {
    switch (handleType) {
      case 'top-left': return 'nw-resize';
      case 'top-right': return 'ne-resize';
      case 'bottom-left': return 'sw-resize';
      case 'bottom-right': return 'se-resize';
      default: return 'auto';
    }
  }

  destroy(): void {
    this.isResizing = false;
    this.currentHandle = null;
    
    // マウス監視を停止
    this.stopMouseMonitoring();
    
    this.overlay = null;
    this.mouseMonitor = null;
  }
}
