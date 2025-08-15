export class ResizeHandleManager {
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
  private onResizeEndCallback: (() => void) | null = null;

  constructor() {
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleMouseUp = this.handleMouseUp.bind(this);
  }

  initialize(overlay: HTMLDivElement, mouseMonitor: HTMLDivElement): void {
    this.overlay = overlay;
    this.mouseMonitor = mouseMonitor;
    this.setupHandles();
  }

  onResizeEnd(callback: () => void): void {
    this.onResizeEndCallback = callback;
  }

  private setupHandles(): void {
    if (!this.overlay) return;

    const handles = this.overlay.querySelectorAll('.resize-handle');
    
    handles.forEach(handle => {
      const handleElement = handle as HTMLElement;
      const handleType = handleElement.dataset.handle;
      
      if (handleType) {
        handleElement.addEventListener('mousedown', (e) => {
          this.startResize(e, handleType);
        });
      }
    });

    console.log('iframe外側オーバーレイのリサイズハンドルを設定しました');
  }

  private startResize(e: MouseEvent, handleType: string): void {
    e.preventDefault();
    e.stopPropagation();

    if (!this.overlay) return;

    this.isResizing = true;
    this.currentHandle = handleType;
    
    const rect = this.overlay.getBoundingClientRect();
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startWidth = rect.width;
    this.startHeight = rect.height;
    this.startLeft = rect.left;
    this.startTop = rect.top;

    const handleElement = this.overlay.querySelector(`[data-handle="${handleType}"]`) as HTMLElement;
    if (handleElement) {
      handleElement.classList.add('dragging');
    }

    document.body.style.cursor = this.getCursorStyle(handleType);
    this.startMouseMonitoring();
    
    console.log('リサイズ開始:', handleType, '開始位置:', this.startX, this.startY);
  }

  private startMouseMonitoring(): void {
    if (!this.mouseMonitor) return;
    
    this.mouseMonitor.addEventListener('mousemove', this.boundHandleMouseMove);
    this.mouseMonitor.addEventListener('mouseup', this.boundHandleMouseUp);
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
  }

  private stopMouseMonitoring(): void {
    if (!this.mouseMonitor) return;
    
    this.mouseMonitor.removeEventListener('mousemove', this.boundHandleMouseMove);
    this.mouseMonitor.removeEventListener('mouseup', this.boundHandleMouseUp);
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isResizing || !this.currentHandle || !this.overlay) return;

    const deltaX = e.clientX - this.startX;
    const deltaY = e.clientY - this.startY;

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
    
    if (this.currentHandle && this.overlay) {
      const handleElement = this.overlay.querySelector(`[data-handle="${this.currentHandle}"]`) as HTMLElement;
      if (handleElement) {
        handleElement.classList.remove('dragging');
      }
    }

    document.body.style.cursor = 'auto';
    this.stopMouseMonitoring();
    
    if (this.onResizeEndCallback) {
      this.onResizeEndCallback();
    }
    
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
    this.stopMouseMonitoring();
    this.overlay = null;
    this.mouseMonitor = null;
    this.onResizeEndCallback = null;
  }
}