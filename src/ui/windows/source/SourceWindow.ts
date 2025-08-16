import { BaseWindow } from '../shared/BaseWindow';

export class SourceWindow extends BaseWindow {
  private selectionBox: HTMLDivElement | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoContainer: HTMLDivElement | null = null;
  private selectionData = {
    x: 0,
    y: 0,
    width: 100,
    height: 100
  };
  private videoActualDimensions = {
    width: 1920,
    height: 1080
  };

  constructor() {
    super('source_window', 'ソースウィンドウ');
  }

  protected initialize(): void {
    this.render();
    this.setupSelectionBox();
  }

  protected getContent(): string {
    return `
      <div class="video-container" id="video-container">
        <div class="video-wrapper">
          <video id="source-video" autoplay muted playsinline>
            <p>MediaStreamの読み込み中...</p>
          </video>
          <div id="selection-overlay">
            <div id="selection-box">
            <div class="handle handle-nw" data-handle="nw"></div>
            <div class="handle handle-ne" data-handle="ne"></div>
            <div class="handle handle-sw" data-handle="sw"></div>
            <div class="handle handle-se" data-handle="se"></div>
            <div class="edge edge-n" data-edge="n"></div>
            <div class="edge edge-e" data-edge="e"></div>
            <div class="edge edge-s" data-edge="s"></div>
            <div class="edge edge-w" data-edge="w"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  protected getStyles(): string {
    return super.getStyles() + `
      .video-container {
        width: 100%;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        margin: 0;
        padding: 20px;
        position: relative;
        box-sizing: border-box;
      }
      
      .video-wrapper {
        position: relative;
        width: 100%;
        max-width: 100%;
        max-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      #source-video {
        display: block;
        width: 100%;
        height: auto;
        max-width: 100%;
        max-height: calc(100vh - 40px);
        object-fit: contain;
        background: #000;
      }

      #selection-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10;
      }

      #selection-box {
        position: absolute;
        border: 2px solid #00ff00;
        background: rgba(0, 255, 0, 0.1);
        pointer-events: auto;
        cursor: move;
        min-width: 20px;
        min-height: 20px;
      }

      .handle {
        position: absolute;
        width: 12px;
        height: 12px;
        background: #00ff00;
        border: 2px solid #fff;
        border-radius: 50%;
        pointer-events: auto;
      }

      .handle-nw {
        top: -6px;
        left: -6px;
        cursor: nw-resize;
      }

      .handle-ne {
        top: -6px;
        right: -6px;
        cursor: ne-resize;
      }

      .handle-sw {
        bottom: -6px;
        left: -6px;
        cursor: sw-resize;
      }

      .handle-se {
        bottom: -6px;
        right: -6px;
        cursor: se-resize;
      }

      .edge {
        position: absolute;
        background: transparent;
        pointer-events: auto;
      }

      .edge-n, .edge-s {
        height: 6px;
        left: 6px;
        right: 6px;
      }

      .edge-n {
        top: -3px;
        cursor: n-resize;
      }

      .edge-s {
        bottom: -3px;
        cursor: s-resize;
      }

      .edge-e, .edge-w {
        width: 6px;
        top: 6px;
        bottom: 6px;
      }

      .edge-e {
        right: -3px;
        cursor: e-resize;
      }

      .edge-w {
        left: -3px;
        cursor: w-resize;
      }
      
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    `;
  }

  protected setupEventListeners(): void {
    // 初期化メッセージのリスナーを追加
    window.addEventListener('message', (event) => {
      switch (event.data.type) {
        case 'initialize-selection':
          this.selectionData = event.data.data;
          this.updateSelectionBox();
          this.broadcastSelectionChange();
          break;
          
        case 'trigger-broadcast':
          this.broadcastSelectionChange();
          break;
      }
    });
  }

  private setupSelectionBox(): void {
    if (!this.window) return;

    const doc = this.window.document;
    this.videoElement = doc.getElementById('source-video') as HTMLVideoElement;
    this.selectionBox = doc.getElementById('selection-box') as HTMLDivElement;
    this.videoContainer = doc.getElementById('video-container') as HTMLDivElement;

    if (!this.selectionBox || !this.videoElement) return;

    // ビデオが読み込まれたら初期位置を設定
    this.videoElement.addEventListener('loadedmetadata', () => {
      this.videoActualDimensions = {
        width: this.videoElement!.videoWidth || 1920,
        height: this.videoElement!.videoHeight || 1080
      };
      this.updateVideoAspectRatio();
      this.initializeSelectionBox();
      this.broadcastVideoDimensions();
    });

    // ウィンドウリサイズ時にアスペクト比を維持
    this.window.addEventListener('resize', () => {
      this.updateVideoAspectRatio();
    });

    // 選択ボックスのドラッグ処理
    this.setupDragHandlers();
    // リサイズハンドルの処理
    this.setupResizeHandlers();
  }

  private initializeSelectionBox(): void {
    if (!this.videoElement || !this.selectionBox) return;

    const videoRect = this.videoElement.getBoundingClientRect();
    
    // デフォルトで全体を選択
    this.selectionData = {
      x: 0,
      y: 0,
      width: 100,
      height: 100
    };

    this.updateSelectionBox();
    this.broadcastSelectionChange();
  }

  private setupDragHandlers(): void {
    if (!this.selectionBox || !this.window) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('handle') || target.classList.contains('edge')) {
        return; // ハンドルやエッジの場合はドラッグしない
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.selectionData.x;
      initialY = this.selectionData.y;
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.videoElement) return;

      const videoRect = this.videoElement.getBoundingClientRect();
      const deltaX = ((e.clientX - startX) / videoRect.width) * 100;
      const deltaY = ((e.clientY - startY) / videoRect.height) * 100;

      this.selectionData.x = Math.max(0, Math.min(100 - this.selectionData.width, initialX + deltaX));
      this.selectionData.y = Math.max(0, Math.min(100 - this.selectionData.height, initialY + deltaY));

      this.updateSelectionBox();
      this.broadcastSelectionChange();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    this.selectionBox.addEventListener('mousedown', handleMouseDown);
    this.window.document.addEventListener('mousemove', handleMouseMove);
    this.window.document.addEventListener('mouseup', handleMouseUp);
  }

  private setupResizeHandlers(): void {
    if (!this.selectionBox || !this.window) return;

    const handles = this.selectionBox.querySelectorAll('.handle, .edge');
    
    handles.forEach(handle => {
      let isResizing = false;
      let startX = 0;
      let startY = 0;
      let initialData = { x: 0, y: 0, width: 0, height: 0 };

      const handleMouseDown = (e: MouseEvent) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        initialData = { ...this.selectionData };
        e.stopPropagation();
        e.preventDefault();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing || !this.videoElement) return;

        const videoRect = this.videoElement.getBoundingClientRect();
        const deltaX = ((e.clientX - startX) / videoRect.width) * 100;
        const deltaY = ((e.clientY - startY) / videoRect.height) * 100;

        const handleType = (handle as HTMLElement).dataset.handle || (handle as HTMLElement).dataset.edge;
        
        switch(handleType) {
          case 'nw':
            this.selectionData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.selectionData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.selectionData.width = initialData.width - (this.selectionData.x - initialData.x);
            this.selectionData.height = initialData.height - (this.selectionData.y - initialData.y);
            break;
          case 'ne':
            this.selectionData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.selectionData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            this.selectionData.height = initialData.height - (this.selectionData.y - initialData.y);
            break;
          case 'sw':
            this.selectionData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.selectionData.width = initialData.width - (this.selectionData.x - initialData.x);
            this.selectionData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'se':
            this.selectionData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            this.selectionData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'n':
            this.selectionData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.selectionData.height = initialData.height - (this.selectionData.y - initialData.y);
            break;
          case 'e':
            this.selectionData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            break;
          case 's':
            this.selectionData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'w':
            this.selectionData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.selectionData.width = initialData.width - (this.selectionData.x - initialData.x);
            break;
        }

        this.updateSelectionBox();
        this.broadcastSelectionChange();
      };

      const handleMouseUp = () => {
        isResizing = false;
      };

      handle.addEventListener('mousedown', handleMouseDown as EventListener);
      this.window!.document.addEventListener('mousemove', handleMouseMove as EventListener);
      this.window!.document.addEventListener('mouseup', handleMouseUp as EventListener);
    });
  }

  private updateSelectionBox(): void {
    if (!this.selectionBox) return;

    this.selectionBox.style.left = `${this.selectionData.x}%`;
    this.selectionBox.style.top = `${this.selectionData.y}%`;
    this.selectionBox.style.width = `${this.selectionData.width}%`;
    this.selectionBox.style.height = `${this.selectionData.height}%`;
  }

  private broadcastSelectionChange(): void {
    const targetWindow = this.getParentWindow();
    
    if (targetWindow) {
      try {
        targetWindow.postMessage({
          type: 'source-selection-change',
          data: this.selectionData
        }, '*');
      } catch (error) {
        console.error('SourceWindow: メッセージ送信エラー', error);
      }
    }
  }

  public getSelectionData() {
    return this.selectionData;
  }

  private updateVideoAspectRatio(): void {
    if (!this.videoElement || !this.window) return;
    
    const wrapper = this.window.document.querySelector('.video-wrapper') as HTMLDivElement;
    if (!wrapper) return;
    
    const aspectRatio = this.videoActualDimensions.width / this.videoActualDimensions.height;
    
    // コンテナのサイズを取得
    const containerWidth = this.videoContainer?.clientWidth || window.innerWidth;
    const containerHeight = this.videoContainer?.clientHeight || window.innerHeight;
    const containerPadding = 40; // padding: 20px * 2
    
    const maxWidth = containerWidth - containerPadding;
    const maxHeight = containerHeight - containerPadding;
    
    // アスペクト比を維持しつつ、コンテナ内に収まる最大サイズを計算
    let videoWidth: number;
    let videoHeight: number;
    
    // コンテナのアスペクト比とビデオのアスペクト比を比較
    const containerAspectRatio = maxWidth / maxHeight;
    
    if (aspectRatio > containerAspectRatio) {
      // ビデオの方が横長の場合、幅を基準に
      videoWidth = maxWidth;
      videoHeight = videoWidth / aspectRatio;
    } else {
      // ビデオの方が縦長または同じ場合、高さを基準に
      videoHeight = maxHeight;
      videoWidth = videoHeight * aspectRatio;
    }
    
    // wrapperのサイズを設定
    wrapper.style.width = `${videoWidth}px`;
    wrapper.style.height = `${videoHeight}px`;
    
    console.log('SourceWindow: ビデオアスペクト比更新', {
      actualDimensions: `${this.videoActualDimensions.width}x${this.videoActualDimensions.height}`,
      aspectRatio: aspectRatio.toFixed(3),
      containerSize: `${maxWidth.toFixed(0)}x${maxHeight.toFixed(0)}`,
      displaySize: `${videoWidth.toFixed(0)}x${videoHeight.toFixed(0)}`,
      fitMethod: aspectRatio > containerAspectRatio ? '幅基準' : '高さ基準'
    });
  }

  private broadcastVideoDimensions(): void {
    const targetWindow = this.getParentWindow();
    
    if (targetWindow) {
      try {
        targetWindow.postMessage({
          type: 'video-dimensions-update',
          data: this.videoActualDimensions
        }, '*');
      } catch (error) {
        console.error('SourceWindow: ビデオサイズ通知エラー', error);
      }
    }
  }
}