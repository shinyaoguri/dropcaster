import { BaseWindow } from '../shared/BaseWindow';

export class ControlWindow extends BaseWindow {
  private sourceVideo: HTMLVideoElement | null = null;
  private mappingVideo: HTMLVideoElement | null = null;
  private selectionBox: HTMLDivElement | null = null;
  private croppedContainer: HTMLDivElement | null = null;
  private croppedVideo: HTMLVideoElement | null = null;
  private backgroundVideo: HTMLVideoElement | null = null;
  
  private videoActualDimensions = {
    width: 1,
    height: 1
  };
  
  private windowBounds = {
    x: 0,
    y: 0,
    width: 100,
    height: 100
  };
  
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
    super('control_window', '統合操作ウィンドウ');
  }

  protected initialize(): void {
    this.render();
    this.setupControls();
    this.setupMessageListener();
    // 初期化時にアスペクト比を設定
    setTimeout(() => {
      this.updateSourceVideoAspectRatio();
      this.updateDisplayFrameAspectRatio(); // 物理ディスプレイのアスペクト比を設定
    }, 100);
  }

  protected getContent(): string {
    return `
      <div class="control-container">
        <!-- ツールカラム -->
        <div class="column tool-column">
          <div class="column-header">
            <h2>ツール</h2>
          </div>
          <div class="tool-content">
            <div class="tool-section">
              <h3>ソース設定</h3>
              <div class="tool-item">
                <label>選択領域</label>
                <div class="tool-values">
                  <div class="tool-value">
                    <span class="label">X:</span>
                    <span id="source-x-value">0</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">Y:</span>
                    <span id="source-y-value">0</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">幅:</span>
                    <span id="source-w-value">100</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">高さ:</span>
                    <span id="source-h-value">100</span>%
                  </div>
                </div>
              </div>
              <button id="reset-source-btn" class="tool-button">
                リセット
              </button>
            </div>
            
            <div class="tool-section">
              <h3>マッピング設定</h3>
              <div class="tool-item">
                <label>表示位置</label>
                <div class="tool-values">
                  <div class="tool-value">
                    <span class="label">X:</span>
                    <span id="mapping-x-value">25</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">Y:</span>
                    <span id="mapping-y-value">25</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">幅:</span>
                    <span id="mapping-w-value">50</span>%
                  </div>
                  <div class="tool-value">
                    <span class="label">高さ:</span>
                    <span id="mapping-h-value">50</span>%
                  </div>
                </div>
              </div>
              <button id="reset-mapping-btn" class="tool-button">
                リセット
              </button>
            </div>
            
            <div class="tool-section">
              <h3>プリセット</h3>
              <button class="tool-button preset-btn" data-preset="fullscreen">
                全画面
              </button>
              <button class="tool-button preset-btn" data-preset="pip">
                ピクチャインピクチャ
              </button>
              <button class="tool-button preset-btn" data-preset="center">
                中央配置
              </button>
              <button class="tool-button preset-btn" data-preset="corner">
                コーナー配置
              </button>
            </div>
            
          </div>
        </div>

        <!-- ソースカラム -->
        <div class="column source-column">
          <div class="column-header">
            <h2>ソース選択</h2>
          </div>
          <div class="video-container">
            <div class="source-preview-wrapper">
              <div class="canvas-frame">
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
          </div>
        </div>

        <!-- マッピングカラム -->
        <div class="column mapping-column">
          <div class="column-header">
            <h2>マッピングプレビュー</h2>
          </div>
          <div class="mapping-container">
            <div class="display-status">
              <span class="status-indicator" id="display-mode-indicator"></span>
              <span class="status-text" id="display-mode">ウィンドウ</span>
            </div>
            <div class="display-frame-wrapper">
              <div class="display-frame" id="display-frame">
                <div class="window-frame" id="window-frame">
                  <div class="window-titlebar">
                    <div class="window-controls">
                      <span class="window-control close"></span>
                      <span class="window-control minimize"></span>
                      <span class="window-control maximize"></span>
                    </div>
                    <span class="window-title">Dropcaster</span>
                  </div>
                  <div class="window-content">
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
                </div>
              </div>
              <div class="display-size-info">
                <span class="size-label">ディスプレイ:</span>
                <span id="display-size">1920x1080</span>
                <span class="separator">|</span>
                <span class="size-label">ウィンドウ:</span>
                <span id="window-size">1200x700</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  protected getStyles(): string {
    return super.getStyles() + `
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }

      .control-container {
        display: flex;
        width: 100%;
        height: 100vh;
        background: #1a1a1a;
        margin: 0;
        padding: 0;
      }

      .column {
        display: flex;
        flex-direction: column;
        border-right: 1px solid #333;
      }

      .column:last-child {
        border-right: none;
      }

      .tool-column {
        width: 250px;
        min-width: 200px;
        max-width: 300px;
        background: #222;
      }

      .source-column {
        flex: 1;
        min-width: 300px;
      }

      .mapping-column {
        flex: 1;
        min-width: 300px;
      }

      .column-header {
        padding: 15px;
        background: #2a2a2a;
        border-bottom: 1px solid #444;
      }

      .column-header h2 {
        margin: 0;
        font-size: 16px;
        color: #fff;
        font-weight: 500;
      }

      /* ツールカラムのスタイル */
      .tool-content {
        flex: 1;
        overflow-y: auto;
        padding: 15px;
      }

      .tool-section {
        margin-bottom: 25px;
        padding-bottom: 20px;
        border-bottom: 1px solid #333;
      }

      .tool-section:last-child {
        border-bottom: none;
      }

      .tool-section h3 {
        margin: 0 0 15px 0;
        font-size: 14px;
        color: #aaa;
        text-transform: uppercase;
        font-weight: 500;
      }

      .tool-item {
        margin-bottom: 15px;
      }

      .tool-item label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        color: #888;
      }

      .tool-values {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .tool-value {
        display: flex;
        align-items: center;
        padding: 5px 8px;
        background: #333;
        border-radius: 4px;
        font-size: 12px;
      }

      .tool-value .label {
        color: #888;
        margin-right: 5px;
      }

      .tool-value span:last-child {
        color: #fff;
        font-weight: 500;
      }

      .tool-button {
        width: 100%;
        padding: 8px 12px;
        background: #444;
        border: 1px solid #555;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }

      .tool-button:hover {
        background: #555;
        border-color: #666;
      }

      .tool-button:active {
        background: #333;
      }

      .preset-btn {
        margin-bottom: 8px;
      }
      
      .display-status {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 10;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        background: rgba(51, 51, 51, 0.9);
        backdrop-filter: blur(4px);
        border-radius: 12px;
        font-size: 11px;
      }
      
      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #888;
        transition: background 0.3s;
      }
      
      .display-status.fullscreen .status-indicator {
        background: #27c93f;
        box-shadow: 0 0 4px rgba(39, 201, 63, 0.5);
      }
      
      .display-status.window .status-indicator {
        background: #ffbd2e;
        box-shadow: 0 0 4px rgba(255, 189, 46, 0.5);
      }
      
      .status-text {
        color: #ccc;
        font-weight: 500;
      }

      /* ソースカラムのスタイル */
      .video-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        position: relative;
        overflow: hidden;
        padding: 20px;
      }
      
      .source-preview-wrapper {
        width: 100%;
        height: calc(100% - 40px); /* ヘッダー分を引く */
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      }
      
      .canvas-frame {
        position: relative;
        border: 2px solid #444;
        border-radius: 4px;
        background: #000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        /* サイズはJavaScriptで動的に設定される */
      }
      
      #source-video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: fill;  /* canvas-frameのサイズに完全にフィット */
        background: #000;
      }

      #selection-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
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

      /* マッピングカラムのスタイル */
      .mapping-container {
        flex: 1;
        background: #1a1a1a;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      
      .display-frame-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        max-height: calc(100% - 40px); /* サイズ情報の高さを考慮 */
      }
      
      .display-frame {
        position: relative;
        width: 100%;
        max-width: 100%;
        /* aspect-ratioはJavaScriptで動的に設定される */
        border: 2px solid #444;
        border-radius: 4px;
        background: #111;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      /* ウィンドウ枠 */
      .window-frame {
        position: absolute;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
        /* デフォルトで中央配置 */
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 85%;
        height: 85%;
      }
      
      .window-frame.fullscreen {
        width: 100%;
        height: 100%;
        border-radius: 0;
        border: none;
      }
      
      .window-titlebar {
        height: 28px;
        background: #2a2a2a;
        border-bottom: 1px solid #444;
        display: flex;
        align-items: center;
        padding: 0 10px;
        flex-shrink: 0;
      }
      
      .window-frame.fullscreen .window-titlebar {
        display: none;
      }
      
      .window-controls {
        display: flex;
        gap: 8px;
        margin-right: 10px;
      }
      
      .window-control {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        display: inline-block;
      }
      
      .window-control.close {
        background: #ff5f56;
      }
      
      .window-control.minimize {
        background: #ffbd2e;
      }
      
      .window-control.maximize {
        background: #27c93f;
      }
      
      .window-title {
        font-size: 11px;
        color: #999;
        flex: 1;
        text-align: center;
      }
      
      .window-content {
        flex: 1;
        position: relative;
        background: #000;
        overflow: hidden;
        padding: 0;  /* paddingを明示的に0に */
      }
      
      #mapping-area {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }
      
      .display-size-info {
        font-size: 12px;
        color: #888;
        text-align: center;
        padding: 5px 10px;
        background: #2a2a2a;
        border-radius: 4px;
        border: 1px solid #333;
      }
      
      .display-size-info .separator {
        margin: 0 8px;
        color: #555;
      }
      
      .display-size-info .size-label {
        color: #aaa;
        font-weight: 500;
        margin-right: 4px;
      }

      #mapping-video {
        display: none;  /* 非表示（ストリームのソースとして使用） */
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
        object-fit: fill;  /* クロップされた映像は全体を表示 */
      }

      /* ハンドルの共通スタイル */
      .handle {
        position: absolute;
        width: 12px;
        height: 12px;
        border: 2px solid #fff;
        border-radius: 50%;
        pointer-events: auto;
        z-index: 10;
      }

      .source-column .handle {
        background: #00ff00;
      }

      .mapping-column .handle {
        background: #ff00ff;
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

      /* エッジハンドル */
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

      /* レスポンシブ対応 */
      @media (max-width: 900px) {
        .tool-column {
          width: 200px;
          min-width: 150px;
        }
      }
    `;
  }

  protected setupEventListeners(): void {
    // ストリームの設定はWindowControllerが直接行う
  }

  private setupControls(): void {
    if (!this.window) return;

    const doc = this.window.document;
    
    // ビデオ要素を取得
    this.sourceVideo = doc.getElementById('source-video') as HTMLVideoElement;
    this.mappingVideo = doc.getElementById('mapping-video') as HTMLVideoElement;
    this.backgroundVideo = doc.getElementById('background-video') as HTMLVideoElement;
    this.croppedContainer = doc.getElementById('cropped-container') as HTMLDivElement;
    this.croppedVideo = doc.getElementById('cropped-video') as HTMLVideoElement;
    this.selectionBox = doc.getElementById('selection-box') as HTMLDivElement;

    // sourceVideoのメタデータ読み込み時にアスペクト比を更新
    if (this.sourceVideo) {
      this.sourceVideo.addEventListener('loadedmetadata', () => {
        this.videoActualDimensions = {
          width: this.sourceVideo!.videoWidth || 1920,
          height: this.sourceVideo!.videoHeight || 1080
        };
        this.updateSourceVideoAspectRatio();
      });
    }

    // ソース選択ボックスの設定
    this.setupSelectionBox();
    
    // マッピング領域の設定
    this.setupMappingArea();
    
    // ツールボタンの設定
    this.setupToolButtons();
    
    // 初期値を更新
    this.updateToolValues();
  }

  private setupSelectionBox(): void {
    if (!this.selectionBox || !this.sourceVideo) return;

    // ビデオが読み込まれたら初期位置を設定
    this.sourceVideo.addEventListener('loadedmetadata', () => {
      this.initializeSelectionBox();
      this.updateSourceVideoAspectRatio();
    });

    // 選択ボックスのドラッグ処理
    this.setupSourceDragHandlers();
    // リサイズハンドルの処理
    this.setupSourceResizeHandlers();
  }

  private setupMappingArea(): void {
    if (!this.croppedContainer || !this.croppedVideo) return;

    // ドラッグとリサイズのハンドラーを設定
    this.setupMappingDragHandlers();
    this.setupMappingResizeHandlers();

    // 初期位置を設定
    this.updateCroppedArea();
    
    // ストリームが設定されるのを待つ
    setTimeout(() => {
      this.updateCroppedVideo();
    }, 1000);
  }

  private setupToolButtons(): void {
    if (!this.window) return;
    const doc = this.window.document;

    // リセットボタン
    const resetSourceBtn = doc.getElementById('reset-source-btn');
    if (resetSourceBtn) {
      resetSourceBtn.addEventListener('click', () => {
        this.sourceSelectionData = { x: 0, y: 0, width: 100, height: 100 };
        this.updateSelectionBox();
        this.updateToolValues();
        this.broadcastSelectionChange();
      });
    }

    const resetMappingBtn = doc.getElementById('reset-mapping-btn');
    if (resetMappingBtn) {
      resetMappingBtn.addEventListener('click', () => {
        this.transformData = { x: 25, y: 25, width: 50, height: 50, scale: 1 };
        this.updateCroppedArea();
        this.updateToolValues();
        this.broadcastTransformChange();
      });
    }

    // プリセットボタン
    const presetBtns = doc.querySelectorAll('.preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = (e.target as HTMLElement).dataset.preset;
        this.applyPreset(preset!);
      });
    });
    
    // ディスプレイサイズを更新
    this.updateDisplayInfo();
  }

  private applyPreset(preset: string): void {
    switch(preset) {
      case 'fullscreen':
        this.transformData = { x: 0, y: 0, width: 100, height: 100, scale: 1 };
        break;
      case 'pip':
        this.transformData = { x: 70, y: 5, width: 25, height: 25, scale: 1 };
        break;
      case 'center':
        this.transformData = { x: 25, y: 25, width: 50, height: 50, scale: 1 };
        break;
      case 'corner':
        this.transformData = { x: 5, y: 5, width: 30, height: 30, scale: 1 };
        break;
    }
    this.updateCroppedArea();
    this.updateToolValues();
    this.broadcastTransformChange();
  }

  private updateToolValues(): void {
    if (!this.window) return;
    const doc = this.window.document;

    // ソース値の更新
    const sourceX = doc.getElementById('source-x-value');
    const sourceY = doc.getElementById('source-y-value');
    const sourceW = doc.getElementById('source-w-value');
    const sourceH = doc.getElementById('source-h-value');

    if (sourceX) sourceX.textContent = this.sourceSelectionData.x.toFixed(1);
    if (sourceY) sourceY.textContent = this.sourceSelectionData.y.toFixed(1);
    if (sourceW) sourceW.textContent = this.sourceSelectionData.width.toFixed(1);
    if (sourceH) sourceH.textContent = this.sourceSelectionData.height.toFixed(1);

    // マッピング値の更新
    const mappingX = doc.getElementById('mapping-x-value');
    const mappingY = doc.getElementById('mapping-y-value');
    const mappingW = doc.getElementById('mapping-w-value');
    const mappingH = doc.getElementById('mapping-h-value');

    if (mappingX) mappingX.textContent = this.transformData.x.toFixed(1);
    if (mappingY) mappingY.textContent = this.transformData.y.toFixed(1);
    if (mappingW) mappingW.textContent = this.transformData.width.toFixed(1);
    if (mappingH) mappingH.textContent = this.transformData.height.toFixed(1);
  }

  private initializeSelectionBox(): void {
    if (!this.sourceVideo || !this.selectionBox) return;

    // デフォルトで全体を選択
    this.sourceSelectionData = {
      x: 0,
      y: 0,
      width: 100,
      height: 100
    };

    this.updateSelectionBox();
    this.broadcastSelectionChange();
  }

  private setupSourceDragHandlers(): void {
    if (!this.selectionBox || !this.window) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('handle') || target.classList.contains('edge')) {
        return;
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.sourceSelectionData.x;
      initialY = this.sourceSelectionData.y;
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.sourceVideo) return;

      const videoRect = this.sourceVideo.getBoundingClientRect();
      const deltaX = ((e.clientX - startX) / videoRect.width) * 100;
      const deltaY = ((e.clientY - startY) / videoRect.height) * 100;

      this.sourceSelectionData.x = Math.max(0, Math.min(100 - this.sourceSelectionData.width, initialX + deltaX));
      this.sourceSelectionData.y = Math.max(0, Math.min(100 - this.sourceSelectionData.height, initialY + deltaY));

      this.updateSelectionBox();
      this.updateToolValues();
      this.broadcastSelectionChange();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    this.selectionBox.addEventListener('mousedown', handleMouseDown);
    this.window.document.addEventListener('mousemove', handleMouseMove);
    this.window.document.addEventListener('mouseup', handleMouseUp);
  }

  private setupSourceResizeHandlers(): void {
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
        initialData = { ...this.sourceSelectionData };
        e.stopPropagation();
        e.preventDefault();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing || !this.sourceVideo) return;

        const videoRect = this.sourceVideo.getBoundingClientRect();
        const deltaX = ((e.clientX - startX) / videoRect.width) * 100;
        const deltaY = ((e.clientY - startY) / videoRect.height) * 100;

        const handleType = (handle as HTMLElement).dataset.handle || (handle as HTMLElement).dataset.edge;
        
        switch(handleType) {
          case 'nw':
            this.sourceSelectionData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.sourceSelectionData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.sourceSelectionData.width = initialData.width - (this.sourceSelectionData.x - initialData.x);
            this.sourceSelectionData.height = initialData.height - (this.sourceSelectionData.y - initialData.y);
            break;
          case 'ne':
            this.sourceSelectionData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.sourceSelectionData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            this.sourceSelectionData.height = initialData.height - (this.sourceSelectionData.y - initialData.y);
            break;
          case 'sw':
            this.sourceSelectionData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.sourceSelectionData.width = initialData.width - (this.sourceSelectionData.x - initialData.x);
            this.sourceSelectionData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'se':
            this.sourceSelectionData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            this.sourceSelectionData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'n':
            this.sourceSelectionData.y = Math.max(0, Math.min(initialData.y + initialData.height - 5, initialData.y + deltaY));
            this.sourceSelectionData.height = initialData.height - (this.sourceSelectionData.y - initialData.y);
            break;
          case 'e':
            this.sourceSelectionData.width = Math.max(5, Math.min(100 - initialData.x, initialData.width + deltaX));
            break;
          case 's':
            this.sourceSelectionData.height = Math.max(5, Math.min(100 - initialData.y, initialData.height + deltaY));
            break;
          case 'w':
            this.sourceSelectionData.x = Math.max(0, Math.min(initialData.x + initialData.width - 5, initialData.x + deltaX));
            this.sourceSelectionData.width = initialData.width - (this.sourceSelectionData.x - initialData.x);
            break;
        }

        this.updateSelectionBox();
        this.updateToolValues();
        this.broadcastSelectionChange();
      };

      const handleMouseUp = () => {
        isResizing = false;
      };

      handle.addEventListener('mousedown', handleMouseDown);
      this.window!.document.addEventListener('mousemove', handleMouseMove);
      this.window!.document.addEventListener('mouseup', handleMouseUp);
    });
  }

  private setupMappingDragHandlers(): void {
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
      this.updateToolValues();
      this.broadcastTransformChange();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    this.croppedContainer.addEventListener('mousedown', handleMouseDown);
    this.window.document.addEventListener('mousemove', handleMouseMove);
    this.window.document.addEventListener('mouseup', handleMouseUp);
  }

  private setupMappingResizeHandlers(): void {
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
        this.updateToolValues();
        this.broadcastTransformChange();
      };

      const handleMouseUp = () => {
        isResizing = false;
      };

      handle.addEventListener('mousedown', handleMouseDown);
      this.window!.document.addEventListener('mousemove', handleMouseMove);
      this.window!.document.addEventListener('mouseup', handleMouseUp);
    });
  }

  private updateSelectionBox(): void {
    if (!this.selectionBox) return;

    this.selectionBox.style.left = `${this.sourceSelectionData.x}%`;
    this.selectionBox.style.top = `${this.sourceSelectionData.y}%`;
    this.selectionBox.style.width = `${this.sourceSelectionData.width}%`;
    this.selectionBox.style.height = `${this.sourceSelectionData.height}%`;
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
    if (!this.mappingVideo) {
      this.mappingVideo = this.window?.document.getElementById('mapping-video') as HTMLVideoElement;
    }

    if (!this.mappingVideo) return;

    // ソースビデオのストリームをコピー
    if (this.mappingVideo.srcObject && !this.croppedVideo.srcObject) {
      const stream = this.mappingVideo.srcObject as MediaStream;
      this.croppedVideo.srcObject = stream.clone();
      
      // 背景ビデオにも設定
      if (this.backgroundVideo && !this.backgroundVideo.srcObject) {
        this.backgroundVideo.srcObject = stream.clone();
      }

      this.croppedVideo.addEventListener('loadedmetadata', () => {
        this.videoActualDimensions = {
          width: this.croppedVideo!.videoWidth || 1920,
          height: this.croppedVideo!.videoHeight || 1080
        };
        this.updateVideoCrop();
      }, { once: true });
    }

    this.updateVideoCrop();
  }

  private updateVideoCrop(): void {
    if (!this.croppedVideo || !this.croppedContainer) return;

    // シンプルな相対座標変換
    const scale = 100 / this.sourceSelectionData.width;
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
  }

  private setupMessageListener(): void {
    if (!this.window) return;

    this.window.addEventListener('message', (event) => {
      switch (event.data.type) {
        case 'update-source-selection':
          this.handleSourceSelectionUpdate(event.data.data);
          break;
        case 'initialize-control':
          this.handleInitialize(event.data.data);
          break;
        case 'video-dimensions-update':
          this.handleVideoDimensionsUpdate(event.data.data);
          break;
        case 'window-bounds-update':
          this.handleWindowBoundsUpdate(event.data.data);
          break;
      }
    });
    
    // ウィンドウリサイズ時にアスペクト比を再計算
    this.window.addEventListener('resize', () => {
      this.updateSourceVideoAspectRatio();
      // display-frameは物理ディスプレイのアスペクト比を維持
      this.updateWindowBounds();
    });
    
    // 親ウィンドウの情報を取得
    this.updateWindowBounds();
  }

  private handleVideoDimensionsUpdate(dimensions: any): void {
    this.videoActualDimensions = dimensions;
    this.updateVideoCrop();
    this.updateSourceVideoAspectRatio();
    // display-frameは物理ディスプレイのアスペクト比を維持するので更新しない
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
    this.updateSelectionBox();
    this.updateToolValues();
  }

  private broadcastSelectionChange(): void {
    const targetWindow = this.getParentWindow();
    
    if (targetWindow) {
      try {
        targetWindow.postMessage({
          type: 'source-selection-change',
          data: this.sourceSelectionData
        }, '*');
      } catch (error) {
        console.error('ControlWindow: ソース選択メッセージ送信エラー', error);
      }
    }

    // 内部でも直接更新
    this.updateVideoCrop();
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
        }, '*');
      } catch (error) {
        console.error('ControlWindow: マッピング変更メッセージ送信エラー', error);
      }
    }
  }

  public setSourceVideo(video: HTMLVideoElement): void {
    this.sourceVideo = video;
    this.updateCroppedVideo();
  }
  
  private updateDisplayInfo(): void {
    if (!this.window) return;
    const doc = this.window.document;
    
    // ディスプレイサイズを表示
    const displaySize = doc.getElementById('display-size');
    if (displaySize) {
      const width = window.screen.width;
      const height = window.screen.height;
      displaySize.textContent = `${width}x${height}`;
    }
    
    // ウィンドウサイズを更新
    this.updateWindowBounds();
    
    // フルスクリーン状態を監視
    const targetWindow = this.getParentWindow();
    if (targetWindow) {
      // 親ウィンドウのフルスクリーン状態を確認
      const checkFullscreen = () => {
        const isFullscreen = targetWindow.document.fullscreenElement !== null;
        this.updateFullscreenUI(isFullscreen);
      };
      
      // 初回チェック
      setTimeout(checkFullscreen, 500);
      
      // フルスクリーン変更を監視
      targetWindow.addEventListener('fullscreenchange', () => {
        checkFullscreen();
      });
      
      // ウィンドウリサイズを監視
      targetWindow.addEventListener('resize', () => {
        this.updateWindowBounds();
      });
    }
  }
  
  private updateFullscreenUI(isFullscreen: boolean): void {
    if (!this.window) return;
    const doc = this.window.document;
    
    const displayMode = doc.getElementById('display-mode');
    const displayStatus = doc.querySelector('.display-status');
    const displayFrame = doc.getElementById('display-frame');
    const windowFrame = doc.getElementById('window-frame');
    
    if (displayMode) {
      displayMode.textContent = isFullscreen ? 'フルスクリーン' : 'ウィンドウ';
    }
    
    if (displayStatus) {
      displayStatus.classList.remove('fullscreen', 'window');
      displayStatus.classList.add(isFullscreen ? 'fullscreen' : 'window');
    }
    
    // ウィンドウフレームのスタイルを調整
    if (windowFrame) {
      if (isFullscreen) {
        windowFrame.classList.add('fullscreen');
      } else {
        windowFrame.classList.remove('fullscreen');
      }
    }
    
    // ディスプレイフレームのスタイルを調整
    // フルスクリーン時も通常時も最大サイズを使用
    if (displayFrame) {
      displayFrame.style.width = '100%';
      displayFrame.style.maxWidth = '100%';
    }
  }
  
  private updateWindowBounds(): void {
    const targetWindow = this.getParentWindow();
    if (!targetWindow) return;
    
    // ウィンドウのサイズと位置を取得
    const screenWidth = targetWindow.screen.width;
    const screenHeight = targetWindow.screen.height;
    const windowWidth = targetWindow.innerWidth;  // innerWidthを使用
    const windowHeight = targetWindow.innerHeight;  // innerHeightを使用
    const windowX = targetWindow.screenX;
    const windowY = targetWindow.screenY;
    
    // パーセンテージで保存
    this.windowBounds = {
      x: (windowX / screenWidth) * 100,
      y: (windowY / screenHeight) * 100,
      width: (windowWidth / screenWidth) * 100,
      height: (windowHeight / screenHeight) * 100
    };
    
    // ウィンドウサイズ表示を更新
    if (this.window) {
      const doc = this.window.document;
      const windowSize = doc.getElementById('window-size');
      if (windowSize) {
        windowSize.textContent = `${windowWidth}x${windowHeight}`;
      }
      
      // ウィンドウフレームの位置を更新
      this.updateWindowFramePosition();
    }
  }
  
  private updateWindowFramePosition(): void {
    if (!this.window) return;
    const doc = this.window.document;
    const windowFrame = doc.getElementById('window-frame');
    const displayFrame = doc.getElementById('display-frame');
    
    if (windowFrame && displayFrame) {
      // ディスプレイ内でのウィンドウの相対サイズを計算
      const relativeWidth = Math.min(this.windowBounds.width, 100);
      const relativeHeight = Math.min(this.windowBounds.height, 100);
      
      // フルスクリーンでない場合のみサイズを調整
      const targetWindow = this.getParentWindow();
      const isFullscreen = targetWindow && targetWindow.document.fullscreenElement !== null;
      
      if (isFullscreen) {
        // フルスクリーン時は100%
        windowFrame.style.width = '100%';
        windowFrame.style.height = '100%';
        windowFrame.style.left = '50%';
        windowFrame.style.top = '50%';
        windowFrame.style.transform = 'translate(-50%, -50%)';
      } else {
        // 通常時は相対サイズを反映
        windowFrame.style.width = `${relativeWidth}%`;
        windowFrame.style.height = `${relativeHeight}%`;
        windowFrame.style.position = 'absolute';
        windowFrame.style.left = '50%';
        windowFrame.style.top = '50%';
        windowFrame.style.transform = 'translate(-50%, -50%)';
      }
      
      console.log('ControlWindow: ウィンドウフレーム更新', {
        relativeWidth: `${relativeWidth}%`,
        relativeHeight: `${relativeHeight}%`,
        isFullscreen,
        windowBounds: this.windowBounds
      });
    }
  }
  
  private handleWindowBoundsUpdate(bounds: any): void {
    this.windowBounds = bounds;
    this.updateWindowFramePosition();
  }
  
  private updateDisplayFrameAspectRatio(): void {
    if (!this.window) return;
    
    const doc = this.window.document;
    const displayFrame = doc.getElementById('display-frame') as HTMLDivElement;
    
    if (!displayFrame) return;
    
    // 物理的なディスプレイのアスペクト比を取得
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    
    if (screenWidth && screenHeight) {
      const screenAspectRatio = screenWidth / screenHeight;
      
      // display-frameのアスペクト比を物理ディスプレイに合わせる
      displayFrame.style.aspectRatio = `${screenAspectRatio}`;
      
      console.log('ControlWindow: display-frameのアスペクト比を更新', {
        screenSize: `${screenWidth}x${screenHeight}`,
        screenAspectRatio: screenAspectRatio.toFixed(3),
        method: '物理ディスプレイのアスペクト比'
      });
    }
  }
  
  private updateSourceVideoAspectRatio(): void {
    if (!this.window) return;
    
    const doc = this.window.document;
    const canvasFrame = doc.querySelector('.canvas-frame') as HTMLDivElement;
    const sourcePreviewWrapper = doc.querySelector('.source-preview-wrapper') as HTMLDivElement;
    
    if (!canvasFrame || !sourcePreviewWrapper) return;
    
    // スケッチCanvasの実際のアスペクト比を取得（ビデオストリームから）
    const canvasWidth = this.videoActualDimensions.width || (this.sourceVideo?.videoWidth) || 1920;
    const canvasHeight = this.videoActualDimensions.height || (this.sourceVideo?.videoHeight) || 1080;
    
    if (canvasWidth && canvasHeight) {
      const canvasAspectRatio = canvasWidth / canvasHeight;
      
      // wrapperのサイズを取得
      const wrapperRect = sourcePreviewWrapper.getBoundingClientRect();
      const wrapperWidth = wrapperRect.width - 40; // padding: 20px * 2
      const wrapperHeight = wrapperRect.height - 40; // padding: 20px * 2
      
      // アスペクト比を維持しつつ、wrapper内に収まる最大サイズを計算
      let frameWidth: number;
      let frameHeight: number;
      
      const wrapperAspectRatio = wrapperWidth / wrapperHeight;
      
      if (canvasAspectRatio > wrapperAspectRatio) {
        // Canvasの方が横長の場合、幅を基準に
        frameWidth = wrapperWidth;
        frameHeight = frameWidth / canvasAspectRatio;
      } else {
        // Canvasの方が縦長または同じ場合、高さを基準に
        frameHeight = wrapperHeight;
        frameWidth = frameHeight * canvasAspectRatio;
      }
      
      // canvas-frameのサイズを設定
      canvasFrame.style.width = `${frameWidth}px`;
      canvasFrame.style.height = `${frameHeight}px`;
      canvasFrame.style.maxWidth = '100%';
      canvasFrame.style.maxHeight = '100%';
      
      console.log('ControlWindow: Canvas同期 - ソースビデオ更新', {
        canvasSize: `${canvasWidth}x${canvasHeight}`,
        canvasAspectRatio: canvasAspectRatio.toFixed(3),
        wrapperSize: `${wrapperWidth.toFixed(0)}x${wrapperHeight.toFixed(0)}`,
        frameSize: `${frameWidth.toFixed(0)}x${frameHeight.toFixed(0)}`,
        fitMethod: canvasAspectRatio > wrapperAspectRatio ? '幅基準' : '高さ基準'
      });
    }
  }
}