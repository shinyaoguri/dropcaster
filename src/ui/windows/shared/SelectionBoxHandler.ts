export interface SelectionData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';

export class SelectionBoxHandler {
  private selectionBox: HTMLElement;
  private container: HTMLElement;
  private selectionData: SelectionData;
  private onChangeCallback?: (data: SelectionData) => void;
  
  private isDragging = false;
  private isResizing = false;
  private startX = 0;
  private startY = 0;
  private initialData: SelectionData = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    selectionBox: HTMLElement,
    container: HTMLElement,
    initialData: SelectionData = { x: 0, y: 0, width: 100, height: 100 }
  ) {
    this.selectionBox = selectionBox;
    this.container = container;
    this.selectionData = { ...initialData };
    
    this.setupEventListeners();
    this.updatePosition();
  }

  private setupEventListeners(): void {
    // ドラッグハンドラーの設定
    this.selectionBox.addEventListener('mousedown', (e) => this.handleDragStart(e));
    
    // リサイズハンドラーの設定
    const handles = this.selectionBox.querySelectorAll('.handle, .edge');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => this.handleResizeStart(e as MouseEvent));
    });
    
    // ドキュメント全体でのマウス移動・離しイベント
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', () => this.handleMouseUp());
  }

  private handleDragStart(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.classList.contains('handle') || target.classList.contains('edge')) {
      return;
    }
    
    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.initialData = { ...this.selectionData };
    e.preventDefault();
  }

  private handleResizeStart(e: MouseEvent): void {
    this.isResizing = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.initialData = { ...this.selectionData };
    e.stopPropagation();
    e.preventDefault();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.isDragging) {
      this.handleDrag(e);
    } else if (this.isResizing) {
      this.handleResize(e);
    }
  }

  private handleDrag(e: MouseEvent): void {
    const containerRect = this.container.getBoundingClientRect();
    const deltaX = ((e.clientX - this.startX) / containerRect.width) * 100;
    const deltaY = ((e.clientY - this.startY) / containerRect.height) * 100;
    
    this.selectionData.x = Math.max(0, Math.min(100 - this.selectionData.width, this.initialData.x + deltaX));
    this.selectionData.y = Math.max(0, Math.min(100 - this.selectionData.height, this.initialData.y + deltaY));
    
    this.updatePosition();
    this.notifyChange();
  }

  private handleResize(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const handleType = (target.dataset.handle || target.dataset.edge) as ResizeHandle;
    
    if (!handleType) return;
    
    const containerRect = this.container.getBoundingClientRect();
    const deltaX = ((e.clientX - this.startX) / containerRect.width) * 100;
    const deltaY = ((e.clientY - this.startY) / containerRect.height) * 100;
    
    this.applyResize(handleType, deltaX, deltaY);
    this.updatePosition();
    this.notifyChange();
  }

  private applyResize(handleType: ResizeHandle, deltaX: number, deltaY: number): void {
    const minSize = 5; // 最小サイズ
    
    switch(handleType) {
      case 'nw':
        this.selectionData.x = Math.max(0, Math.min(this.initialData.x + this.initialData.width - minSize, this.initialData.x + deltaX));
        this.selectionData.y = Math.max(0, Math.min(this.initialData.y + this.initialData.height - minSize, this.initialData.y + deltaY));
        this.selectionData.width = this.initialData.width - (this.selectionData.x - this.initialData.x);
        this.selectionData.height = this.initialData.height - (this.selectionData.y - this.initialData.y);
        break;
      case 'ne':
        this.selectionData.y = Math.max(0, Math.min(this.initialData.y + this.initialData.height - minSize, this.initialData.y + deltaY));
        this.selectionData.width = Math.max(minSize, Math.min(100 - this.initialData.x, this.initialData.width + deltaX));
        this.selectionData.height = this.initialData.height - (this.selectionData.y - this.initialData.y);
        break;
      case 'sw':
        this.selectionData.x = Math.max(0, Math.min(this.initialData.x + this.initialData.width - minSize, this.initialData.x + deltaX));
        this.selectionData.width = this.initialData.width - (this.selectionData.x - this.initialData.x);
        this.selectionData.height = Math.max(minSize, Math.min(100 - this.initialData.y, this.initialData.height + deltaY));
        break;
      case 'se':
        this.selectionData.width = Math.max(minSize, Math.min(100 - this.initialData.x, this.initialData.width + deltaX));
        this.selectionData.height = Math.max(minSize, Math.min(100 - this.initialData.y, this.initialData.height + deltaY));
        break;
      case 'n':
        this.selectionData.y = Math.max(0, Math.min(this.initialData.y + this.initialData.height - minSize, this.initialData.y + deltaY));
        this.selectionData.height = this.initialData.height - (this.selectionData.y - this.initialData.y);
        break;
      case 'e':
        this.selectionData.width = Math.max(minSize, Math.min(100 - this.initialData.x, this.initialData.width + deltaX));
        break;
      case 's':
        this.selectionData.height = Math.max(minSize, Math.min(100 - this.initialData.y, this.initialData.height + deltaY));
        break;
      case 'w':
        this.selectionData.x = Math.max(0, Math.min(this.initialData.x + this.initialData.width - minSize, this.initialData.x + deltaX));
        this.selectionData.width = this.initialData.width - (this.selectionData.x - this.initialData.x);
        break;
    }
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    this.isResizing = false;
  }

  private updatePosition(): void {
    this.selectionBox.style.left = `${this.selectionData.x}%`;
    this.selectionBox.style.top = `${this.selectionData.y}%`;
    this.selectionBox.style.width = `${this.selectionData.width}%`;
    this.selectionBox.style.height = `${this.selectionData.height}%`;
  }

  private notifyChange(): void {
    if (this.onChangeCallback) {
      this.onChangeCallback(this.selectionData);
    }
  }

  public onChange(callback: (data: SelectionData) => void): void {
    this.onChangeCallback = callback;
  }

  public setData(data: SelectionData): void {
    this.selectionData = { ...data };
    this.updatePosition();
  }

  public getData(): SelectionData {
    return { ...this.selectionData };
  }

  public reset(): void {
    this.setData({ x: 0, y: 0, width: 100, height: 100 });
    this.notifyChange();
  }
}