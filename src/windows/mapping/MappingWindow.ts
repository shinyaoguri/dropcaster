import { BaseWindow } from '../shared/BaseWindow';

export class MappingWindow extends BaseWindow {
  private sourceVideo: HTMLVideoElement | null = null;
  private croppedContainer: HTMLDivElement | null = null;
  private croppedVideo: HTMLVideoElement | null = null;
  private backgroundVideo: HTMLVideoElement | null = null;
  // videoActualDimensionsは現在使用されていないため削除
  
  private sourceSelectionData = {
    x: 0,
    y: 0,
    width: 100,
    height: 100
  };
  
  private transformData = {
    x: 25,
    y: 25,
    width: 50,
    height: 50,
    scale: 1
  };

  constructor() {
    super('mapping_window', 'マッピングウィンドウ');
  }

  protected initialize(): void {
    this.render();
    this.setupMappingArea();
    this.setupMessageListener();
  }

  protected getContent(): string {
    return `
      <div class="mapping-container">
        <video id="mapping-video" autoplay muted playsinline style="display: none;">
          <p>MediaStreamの読み込み中...</p>
        </video>
        <div id="mapping-area">
          <video id="background-video" autoplay muted playsinline></video>
          <div id="cropped-container">
            <video id="cropped-video" autoplay muted playsinline></video>
            <div class="handle handle-nw" data-handle="nw"></div>
            <div class="handle handle-ne" data-handle="ne"></div>
            <div class="handle handle-sw" data-handle="sw"></div>
            <div class="handle handle-se" data-handle="se"></div>
          </div>
        </div>
      </div>
    `;
  }

  protected getStyles(): string {
    return super.getStyles() + `
      .mapping-container {
        width: 100%;
        height: 100vh;
        background: #222;
        margin: 0;
        padding: 0;
        position: relative;
        overflow: hidden;
      }
      
      #mapping-area {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }

      #background-video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        opacity: 0.2;
        position: absolute;
        top: 0;
        left: 0;
      }

      #cropped-container {
        position: absolute;
        border: 2px solid #ff00ff;
        background: rgba(255, 0, 255, 0.1);
        cursor: move;
        min-width: 20px;
        min-height: 20px;
        overflow: hidden;
        /* デフォルトサイズと位置 */
        left: 25%;
        top: 25%;
        width: 50%;
        height: 50%;
      }

      #cropped-video {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: top left;
        /* object-fitは使用しない（transformで制御） */
      }

      .handle {
        position: absolute;
        width: 12px;
        height: 12px;
        background: #ff00ff;
        border: 2px solid #fff;
        border-radius: 50%;
        z-index: 10;
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
      
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    `;
  }

  protected setupEventListeners(): void {
    // MediaStreamはWindowControllerが直接設定
  }

  private setupMappingArea(): void {
    if (!this.window) return;

    const doc = this.window.document;
    this.sourceVideo = doc.getElementById('mapping-video') as HTMLVideoElement;
    this.backgroundVideo = doc.getElementById('background-video') as HTMLVideoElement;
    this.croppedContainer = doc.getElementById('cropped-container') as HTMLDivElement;
    this.croppedVideo = doc.getElementById('cropped-video') as HTMLVideoElement;

    if (!this.croppedContainer || !this.croppedVideo) return;

    // ドラッグとリサイズのハンドラーを設定
    this.setupDragHandlers();
    this.setupResizeHandlers();

    // 初期位置を設定
    this.updateCroppedArea();
    
    // ストリームが設定されるのを待つ
    setTimeout(() => {
      this.updateCroppedVideo();
    }, 1000);
  }

  private setupMessageListener(): void {
    if (!this.window) return;

    this.window.addEventListener('message', (event) => {
      const parentWindow = this.getParentWindow();
      if (parentWindow && event.source !== parentWindow) return;
      if (parentWindow && event.origin !== parentWindow.location.origin) return;

      switch (event.data.type) {
        case 'update-source-selection':
          this.handleSourceSelectionUpdate(event.data.data);
          break;
        case 'initialize-mapping':
          this.handleInitialize(event.data.data);
          break;
        case 'video-dimensions-update':
          this.handleVideoDimensionsUpdate(event.data.data);
          break;
      }
    });
  }

  private handleVideoDimensionsUpdate(_dimensions: any): void {
    // 現在は使用されていないため、何もしない
    this.updateVideoCrop();
  }

  private handleSourceSelectionUpdate(selectionData: any): void {
    this.sourceSelectionData = selectionData;
    this.updateVideoCrop();
    this.broadcastTransformChange();
  }

  private handleInitialize(data: any): void {
    if (data.source) {
      this.sourceSelectionData = data.source;
    }
    if (data.transform) {
      this.transformData = data.transform;
    }
    this.updateCroppedArea();
  }

  private setupDragHandlers(): void {
    if (!this.croppedContainer || !this.window) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('handle')) {
        return;
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = this.croppedContainer!.getBoundingClientRect();
      const parentRect = this.croppedContainer!.parentElement!.getBoundingClientRect();
      initialX = ((rect.left - parentRect.left) / parentRect.width) * 100;
      initialY = ((rect.top - parentRect.top) / parentRect.height) * 100;
      
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.croppedContainer) return;

      const parentRect = this.croppedContainer.parentElement!.getBoundingClientRect();
      const deltaX = ((e.clientX - startX) / parentRect.width) * 100;
      const deltaY = ((e.clientY - startY) / parentRect.height) * 100;

      this.transformData.x = Math.max(0, Math.min(100 - this.transformData.width, initialX + deltaX));
      this.transformData.y = Math.max(0, Math.min(100 - this.transformData.height, initialY + deltaY));

      this.updateCroppedArea();
      this.broadcastTransformChange();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    this.croppedContainer.addEventListener('mousedown', handleMouseDown);
    this.window.document.addEventListener('mousemove', handleMouseMove);
    this.window.document.addEventListener('mouseup', handleMouseUp);
  }

  private setupResizeHandlers(): void {
    if (!this.croppedContainer || !this.window) return;

    const handles = this.croppedContainer.querySelectorAll('.handle');
    
    handles.forEach(handle => {
      let isResizing = false;
      let startX = 0;
      let startY = 0;
      let initialData = { x: 0, y: 0, width: 0, height: 0 };

      const handleMouseDown = (e: MouseEvent) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        initialData = { ...this.transformData };
        e.stopPropagation();
        e.preventDefault();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing || !this.croppedContainer) return;

        const parentRect = this.croppedContainer.parentElement!.getBoundingClientRect();
        const deltaX = ((e.clientX - startX) / parentRect.width) * 100;
        const deltaY = ((e.clientY - startY) / parentRect.height) * 100;

        const handleType = (handle as HTMLElement).dataset.handle;
        
        switch(handleType) {
          case 'nw':
            this.transformData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.transformData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.transformData.width = initialData.width - (this.transformData.x - initialData.x);
            this.transformData.height = initialData.height - (this.transformData.y - initialData.y);
            break;
          case 'ne':
            this.transformData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.transformData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            this.transformData.height = initialData.height - (this.transformData.y - initialData.y);
            break;
          case 'sw':
            this.transformData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.transformData.width = initialData.width - (this.transformData.x - initialData.x);
            this.transformData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'se':
            this.transformData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            this.transformData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
        }

        this.updateCroppedArea();
        this.broadcastTransformChange();
      };

      const handleMouseUp = () => {
        isResizing = false;
      };

      handle.addEventListener('mousedown', handleMouseDown as EventListener);
      this.window!.document.addEventListener('mousemove', handleMouseMove as EventListener);
      this.window!.document.addEventListener('mouseup', handleMouseUp as EventListener);
    });
  }

  private updateCroppedArea(): void {
    if (!this.croppedContainer) return;

    // コンテナの位置とサイズを更新
    this.croppedContainer.style.left = `${this.transformData.x}%`;
    this.croppedContainer.style.top = `${this.transformData.y}%`;
    this.croppedContainer.style.width = `${this.transformData.width}%`;
    this.croppedContainer.style.height = `${this.transformData.height}%`;

    // クロップされたビデオの位置を更新
    this.updateVideoCrop();
  }

  private updateCroppedVideo(): void {
    if (!this.croppedVideo) return;

    // ソースビデオがまだ設定されていない場合は、mapping-videoから取得
    if (!this.sourceVideo) {
      this.sourceVideo = this.window?.document.getElementById('mapping-video') as HTMLVideoElement;
    }

    if (!this.sourceVideo) return;

    // ソースビデオのストリームをコピー
    if (this.sourceVideo.srcObject && !this.croppedVideo.srcObject) {
      const stream = this.sourceVideo.srcObject as MediaStream;
      this.croppedVideo.srcObject = stream.clone();
      
      // 背景ビデオにも設定
      if (this.backgroundVideo && !this.backgroundVideo.srcObject) {
        this.backgroundVideo.srcObject = stream.clone();
      }

      this.croppedVideo.addEventListener('loadedmetadata', () => {
        this.updateVideoCrop();
      }, { once: true });
    }

    this.updateVideoCrop();
  }

  private updateVideoCrop(): void {
    if (!this.croppedVideo || !this.croppedContainer) return;

    // シンプルな相対座標変換
    // 選択領域をコンテナ全体に表示する
    const scale = 100 / this.sourceSelectionData.width;
    
    // 選択領域の開始位置分だけオフセット
    const translateX = -this.sourceSelectionData.x * scale;
    const translateY = -this.sourceSelectionData.y * scale;

    // ビデオのサイズと位置を設定
    this.croppedVideo.style.width = `${scale * 100}%`;
    this.croppedVideo.style.height = `${scale * 100}%`;
    this.croppedVideo.style.transform = `translate(${translateX}%, ${translateY}%)`;
    
    // 背景ビデオにも同じクロップを適用（薄く表示）
    if (this.backgroundVideo) {
      this.backgroundVideo.style.width = '100%';
      this.backgroundVideo.style.height = '100%';
      this.backgroundVideo.style.transform = 'none';
    }
    
    console.log('MappingWindow: updateVideoCrop', {
      scale,
      translateX,
      translateY,
      sourceSelection: this.sourceSelectionData
    });
  }

  private broadcastTransformChange(): void {
    const targetWindow = this.getParentWindow();
    
    if (targetWindow) {
      try {
        targetWindow.postMessage({
          type: 'mapping-transform-change',
          data: {
            ...this.transformData,
            sourceSelection: this.sourceSelectionData
          }
        }, targetWindow.location.origin);
      } catch (error) {
        console.error('MappingWindow: メッセージ送信エラー', error);
      }
    }
  }

}
