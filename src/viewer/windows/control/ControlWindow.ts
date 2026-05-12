import { BaseWindow } from '../shared/BaseWindow';
import {
  applyVideoCrop,
  applyQuadTransform,
  defaultMappingsState,
  defaultQuad,
  translateQuad,
  cloneQuad,
  getActiveMapping,
  withAddedMapping,
  withRemovedMapping,
  withActiveSet,
  withMappingToggled,
  withMappingRenamed,
  parseMappingsState,
  isMappingEnabled,
  mappingColor,
  CORNER_KEYS,
  type Quad,
  type CornerKey,
  type MappingsState,
  type SourceRect,
} from '../../utils/mappingTransform';

export class ControlWindow extends BaseWindow {
  private sourceVideo: HTMLVideoElement | null = null;
  private mappingVideo: HTMLVideoElement | null = null;
  private selectionBox: HTMLDivElement | null = null;
  private croppedContainer: HTMLDivElement | null = null;
  private croppedVideo: HTMLVideoElement | null = null;
  // 非アクティブ mapping のプレビュー要素（active は cropped-container を流用）
  private inactivePreviews = new Map<string, { div: HTMLDivElement; video: HTMLVideoElement }>();
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
  
  // canonical state は親 (WindowController) が保持。これは mirror。
  // ローカル UI 操作では optimistic に書き換えて即座に state-mutation を送る。
  // state-update で親から再同期。
  private state: MappingsState = defaultMappingsState();
  // active な mapping の source / quad オブジェクトへの alias。
  // 既存ハンドラが this.sourceSelectionData.x = ... のように内部 mutation するので、
  // 同じ参照を保持して active 切替時に rebindActiveAliases() で貼り直す。
  private sourceSelectionData: SourceRect = this.state.mappings[0].source;
  private quadData: Quad = this.state.mappings[0].quad;

  private rebindActiveAliases(): void {
    const active = getActiveMapping(this.state);
    this.sourceSelectionData = active.source;
    this.quadData = active.quad;
  }

  /** active な entry の quad を新しいオブジェクトで差し替え、alias も同期。 */
  private setActiveQuad(quad: Quad): void {
    const active = getActiveMapping(this.state);
    active.quad = quad;
    this.quadData = quad;
  }

  /** active な entry の source を新しいオブジェクトで差し替え、alias も同期。 */
  private setActiveSource(source: SourceRect): void {
    const active = getActiveMapping(this.state);
    active.source = source;
    this.sourceSelectionData = source;
  }

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
              <h3>マッピング一覧</h3>
              <div id="mappings-list" class="mappings-list"></div>
              <button id="add-mapping-btn" class="tool-button">＋ 追加</button>
              <div class="io-buttons">
                <button id="export-mappings-btn" class="tool-button">保存</button>
                <button id="import-mappings-btn" class="tool-button">読み込み</button>
              </div>
            </div>

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
              <h3>テストパターン</h3>
              <p class="section-hint">プロジェクションの校正用にソース映像を一時的に差し替えます</p>
              <div class="test-pattern-buttons">
                <button class="tool-button test-pattern-btn active" data-pattern="off">通常</button>
                <button class="tool-button test-pattern-btn" data-pattern="white">白</button>
                <button class="tool-button test-pattern-btn" data-pattern="grid">グリッド</button>
                <button class="tool-button test-pattern-btn" data-pattern="smpte">カラーバー</button>
              </div>
            </div>

            <div class="tool-section">
              <h3>マッピング設定</h3>
              <div class="tool-item">
                <label>4隅 (% / ホモグラフィー)</label>
                <div class="tool-values quad-values">
                  <div class="tool-value"><span class="label">TL:</span><span id="mapping-tl-value">25, 25</span></div>
                  <div class="tool-value"><span class="label">TR:</span><span id="mapping-tr-value">75, 25</span></div>
                  <div class="tool-value"><span class="label">BL:</span><span id="mapping-bl-value">25, 75</span></div>
                  <div class="tool-value"><span class="label">BR:</span><span id="mapping-br-value">75, 75</span></div>
                </div>
              </div>
              <button id="reset-mapping-btn" class="tool-button">
                リセット
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
                      <div id="cropped-container">
                        <video id="cropped-video" autoplay muted playsinline></video>
                      </div>
                      <div class="quad-handle" data-corner="topLeft"></div>
                      <div class="quad-handle" data-corner="topRight"></div>
                      <div class="quad-handle" data-corner="bottomRight"></div>
                      <div class="quad-handle" data-corner="bottomLeft"></div>
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

      .section-hint {
        margin: 0 0 8px 0;
        font-size: 11px;
        color: #aaa;
        line-height: 1.4;
      }

      .test-pattern-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .test-pattern-btn.active {
        background: #2563eb;
        border-color: #3b82f6;
        color: #fff;
      }

      .test-pattern-btn.active:hover {
        background: #1d4ed8;
        border-color: #2563eb;
      }

      /* マッピング一覧 */
      .mappings-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
      }

      .io-buttons {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }

      .io-buttons .tool-button {
        flex: 1;
      }

      .mapping-list-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: #333;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        color: #ccc;
        transition: all 0.15s;
      }

      .mapping-list-item:hover {
        background: #3a3a3a;
      }

      .mapping-list-item.active {
        background: rgba(255, 255, 255, 0.06);
        border-color: var(--mapping-color, #ff00ff);
        color: #fff;
      }

      .mapping-list-item .color-chip {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--mapping-color, #ff00ff);
        flex-shrink: 0;
      }

      .mapping-list-item .toggle-btn {
        background: transparent;
        border: 1px solid #555;
        color: #999;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .mapping-list-item .toggle-btn.enabled {
        background: var(--mapping-color, #ff00ff);
        border-color: var(--mapping-color, #ff00ff);
        color: #000;
      }

      .mapping-list-item.disabled {
        opacity: 0.5;
      }

      .mapping-list-item.disabled .name {
        text-decoration: line-through;
      }

      .mapping-list-item .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: none;
      }

      .mapping-list-item .name-input {
        flex: 1;
        background: #222;
        border: 1px solid var(--mapping-color, #ff00ff);
        color: #fff;
        font-size: 12px;
        padding: 1px 4px;
        border-radius: 3px;
        outline: none;
        min-width: 0;
      }

      .mapping-list-item .remove-btn {
        background: transparent;
        border: none;
        color: #888;
        cursor: pointer;
        font-size: 14px;
        padding: 0 4px;
        line-height: 1;
      }

      .mapping-list-item .remove-btn:hover {
        color: #ff5555;
      }

      .mapping-list-item .remove-btn:disabled {
        color: #555;
        cursor: not-allowed;
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
      
      #cropped-container {
        position: absolute;
        border: 2px solid var(--mapping-color, #ff00ff);
        background: transparent;
        cursor: move;
        overflow: hidden;
        /* 単位矩形を matrix3d で 4 隅に写像する */
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        transform-origin: top left;
        backface-visibility: hidden;
        will-change: transform;
        pointer-events: auto;
      }

      .quad-handle {
        position: absolute;
        width: 14px;
        height: 14px;
        background: var(--mapping-color, #ff00ff);
        border: 2px solid #fff;
        border-radius: 50%;
        z-index: 20;
        cursor: grab;
        /* 4 隅の % 位置に置いた中心が一致するよう中央合わせ */
        margin-left: -7px;
        margin-top: -7px;
        box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
      }

      .quad-handle.dragging {
        cursor: grabbing;
        background: #ffffff;
        border-color: var(--mapping-color, #ff00ff);
      }

      /* 非アクティブ mapping のプレビュー */
      .preview-mapping.inactive {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        transform-origin: top left;
        backface-visibility: hidden;
        border: 1px dashed var(--mapping-color, rgba(255, 0, 255, 0.5));
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
      }

      .preview-mapping.inactive:hover {
        border-style: solid;
      }

      .preview-mapping.inactive > video {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: top left;
        object-fit: fill;
        width: 100%;
        height: 100%;
        opacity: 0.55;
        pointer-events: none;
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
    this.croppedContainer = doc.getElementById('cropped-container') as HTMLDivElement;
    this.croppedVideo = doc.getElementById('cropped-video') as HTMLVideoElement;
    this.selectionBox = doc.getElementById('selection-box') as HTMLDivElement;

    // sourceVideoのメタデータ読み込み時にアスペクト比を更新し、
    // すでに作成済みの非アクティブプレビュー video にも stream を bind する
    if (this.sourceVideo) {
      this.sourceVideo.addEventListener('loadedmetadata', () => {
        this.videoActualDimensions = {
          width: this.sourceVideo!.videoWidth || 1920,
          height: this.sourceVideo!.videoHeight || 1080
        };
        this.updateSourceVideoAspectRatio();
        this.refreshInactivePreviewStreams();
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

    // ドラッグ（quad全体平行移動）と4隅ハンドル（独立操作）
    this.setupMappingDragHandlers();
    this.setupQuadHandleHandlers();

    // 初期位置を設定
    this.updateQuadTransform();

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
        this.setActiveSource({ x: 0, y: 0, width: 100, height: 100 });
        this.updateSelectionBox();
        this.updateToolValues();
        this.broadcastStateMutation();
      });
    }

    const resetMappingBtn = doc.getElementById('reset-mapping-btn');
    if (resetMappingBtn) {
      resetMappingBtn.addEventListener('click', () => {
        this.setActiveQuad(defaultQuad());
        this.updateQuadTransform();
        this.updateToolValues();
        this.broadcastStateMutation();
      });
    }

    // テストパターンボタン（off / white / grid / smpte）
    const testPatternBtns = doc.querySelectorAll('.test-pattern-btn');
    testPatternBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const kind = (e.currentTarget as HTMLElement).dataset.pattern;
        if (!kind) return;
        // optimistic に active 表示を切り替え（parent から test-pattern-update が返って確定）
        this.updateTestPatternUI(kind);
        this.sendTestPatternRequest(kind);
      });
    });

    // マッピング追加ボタン
    const addMappingBtn = doc.getElementById('add-mapping-btn');
    if (addMappingBtn) {
      addMappingBtn.addEventListener('click', () => {
        this.replaceState(withAddedMapping(this.state));
      });
    }

    // 保存（JSON ダウンロード）
    const exportBtn = doc.getElementById('export-mappings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportMappingsToFile());
    }

    // 読み込み（JSON ファイルピッカー）
    const importBtn = doc.getElementById('import-mappings-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.importMappingsFromFile());
    }

    // 初期一覧を描画
    this.renderMappingsList();

    // ディスプレイサイズを更新
    this.updateDisplayInfo();
  }

  /** マッピング一覧の HTML を再生成し、クリック・削除ハンドラを貼り直す。 */
  private renderMappingsList(): void {
    if (!this.window) return;
    const listEl = this.window.document.getElementById('mappings-list');
    if (!listEl) return;

    const canRemove = this.state.mappings.length > 1;
    listEl.innerHTML = this.state.mappings
      .map((m, idx) => {
        const isActive = m.id === this.state.activeId;
        const enabled = isMappingEnabled(m);
        const name = m.name ?? `Mapping ${idx + 1}`;
        const color = mappingColor(idx);
        const cls = `mapping-list-item${isActive ? ' active' : ''}${enabled ? '' : ' disabled'}`;
        return `
          <div class="${cls}" data-id="${m.id}" style="--mapping-color: ${color}">
            <span class="color-chip"></span>
            <span class="name">${name}</span>
            <button class="toggle-btn${enabled ? ' enabled' : ''}" data-id="${m.id}"
              title="${enabled ? '出力中（クリックで停止）' : '停止中（クリックで出力）'}"
            >${enabled ? '●' : '○'}</button>
            <button class="remove-btn" data-id="${m.id}" ${canRemove ? '' : 'disabled'}
              title="削除">×</button>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll<HTMLDivElement>('.mapping-list-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // toggle / remove ボタンへのクリックは別ハンドラで処理
        const target = e.target as HTMLElement;
        if (target.classList.contains('remove-btn')) return;
        if (target.classList.contains('toggle-btn')) return;
        const id = item.dataset.id!;
        if (id !== this.state.activeId) {
          this.replaceState(withActiveSet(this.state, id));
        }
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        this.replaceState(withMappingToggled(this.state, id));
      });
    });

    // 名前のダブルクリックでインライン編集
    listEl.querySelectorAll<HTMLSpanElement>('.mapping-list-item .name').forEach(nameSpan => {
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const item = nameSpan.closest('.mapping-list-item') as HTMLDivElement | null;
        const id = item?.dataset.id;
        if (!id || !this.window) return;
        this.startInlineRename(nameSpan, id);
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        this.replaceState(withRemovedMapping(this.state, id));
      });
    });
  }

  private exportMappingsToFile(): void {
    if (!this.window) return;
    const json = JSON.stringify(this.state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = this.window.document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `dropcaster-mappings-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importMappingsFromFile(): void {
    if (!this.window) return;
    const input = this.window.document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text()
        .then(text => {
          try {
            const parsed = parseMappingsState(JSON.parse(text));
            if (!parsed) {
              this.window?.alert('読み込みに失敗しました（フォーマット不正）');
              return;
            }
            this.replaceState(parsed);
          } catch (error) {
            this.window?.alert('読み込みに失敗しました（JSON 解析失敗）');
            console.error('ControlWindow: JSON parse error', error);
          }
        })
        .catch(error => {
          console.error('ControlWindow: file read error', error);
        });
    });
    input.click();
  }

  private startInlineRename(nameSpan: HTMLElement, id: string): void {
    if (!this.window) return;
    const doc = this.window.document;
    const input = doc.createElement('input');
    input.className = 'name-input';
    input.type = 'text';
    input.value = nameSpan.textContent ?? '';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      this.replaceState(withMappingRenamed(this.state, id, input.value));
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      this.renderMappingsList(); // 元の表示に戻す
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
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

    // マッピング: 4隅の値を更新
    const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
    const tl = doc.getElementById('mapping-tl-value');
    const tr = doc.getElementById('mapping-tr-value');
    const bl = doc.getElementById('mapping-bl-value');
    const br = doc.getElementById('mapping-br-value');
    if (tl) tl.textContent = fmt(this.quadData.topLeft);
    if (tr) tr.textContent = fmt(this.quadData.topRight);
    if (bl) bl.textContent = fmt(this.quadData.bottomLeft);
    if (br) br.textContent = fmt(this.quadData.bottomRight);
  }

  private initializeSelectionBox(): void {
    if (!this.sourceVideo || !this.selectionBox) return;

    // デフォルトで全体を選択
    this.setActiveSource({ x: 0, y: 0, width: 100, height: 100 });

    this.updateSelectionBox();
    this.broadcastStateMutation();
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
      this.broadcastStateMutation();
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
        this.broadcastStateMutation();
      };

      const handleMouseUp = () => {
        isResizing = false;
      };

      handle.addEventListener('mousedown', handleMouseDown as EventListener);
      this.window!.document.addEventListener('mousemove', handleMouseMove as EventListener);
      this.window!.document.addEventListener('mouseup', handleMouseUp as EventListener);
    });
  }

  // quad 全体を平行移動（cropped-container の見た目領域をドラッグ）
  private setupMappingDragHandlers(): void {
    if (!this.croppedContainer || !this.window) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialQuad: Quad = defaultQuad();

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('quad-handle')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialQuad = cloneQuad(this.quadData);
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.croppedContainer) return;
      const parent = this.croppedContainer.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const dx = ((e.clientX - startX) / parentRect.width) * 100;
      const dy = ((e.clientY - startY) / parentRect.height) * 100;
      this.setActiveQuad(translateQuad(initialQuad, dx, dy));
      this.updateQuadTransform();
      this.updateToolValues();
      this.broadcastStateMutation();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    this.croppedContainer.addEventListener('mousedown', handleMouseDown);
    this.window.document.addEventListener('mousemove', handleMouseMove);
    this.window.document.addEventListener('mouseup', handleMouseUp);
  }

  // 4隅ハンドル: それぞれを独立に動かしてホモグラフィー変形を作る
  private setupQuadHandleHandlers(): void {
    if (!this.window || !this.croppedContainer) return;
    const parent = this.croppedContainer.parentElement;
    if (!parent) return;

    const handles = this.window.document.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle');
    handles.forEach(handle => {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initialPoint = { x: 0, y: 0 };
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) return;

      const onMouseDown = (e: MouseEvent) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialPoint = { ...this.quadData[corner] };
        handle.classList.add('dragging');
        e.stopPropagation();
        e.preventDefault();
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width <= 0 || parentRect.height <= 0) return;
        const dx = ((e.clientX - startX) / parentRect.width) * 100;
        const dy = ((e.clientY - startY) / parentRect.height) * 100;
        this.setActiveQuad({
          ...this.quadData,
          [corner]: { x: initialPoint.x + dx, y: initialPoint.y + dy },
        });
        this.updateQuadTransform();
        this.updateToolValues();
        this.broadcastStateMutation();
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('dragging');
      };

      handle.addEventListener('mousedown', onMouseDown);
      this.window!.document.addEventListener('mousemove', onMouseMove);
      this.window!.document.addEventListener('mouseup', onMouseUp);
    });
  }

  private updateSelectionBox(): void {
    if (!this.selectionBox) return;

    this.selectionBox.style.left = `${this.sourceSelectionData.x}%`;
    this.selectionBox.style.top = `${this.sourceSelectionData.y}%`;
    this.selectionBox.style.width = `${this.sourceSelectionData.width}%`;
    this.selectionBox.style.height = `${this.sourceSelectionData.height}%`;
  }

  private updateQuadTransform(): void {
    if (!this.croppedContainer) return;

    // matrix3d を再計算してコンテナへ適用
    applyQuadTransform(this.croppedContainer, this.quadData);

    // active な mapping の色を CSS 変数として伝播（cropped-container と quad-handle に効く）
    const activeIdx = this.state.mappings.findIndex(m => m.id === this.state.activeId);
    const activeColor = mappingColor(activeIdx >= 0 ? activeIdx : 0);
    this.croppedContainer.style.setProperty('--mapping-color', activeColor);
    if (this.window) {
      this.window.document
        .querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle')
        .forEach(h => h.style.setProperty('--mapping-color', activeColor));
    }

    // 非アクティブ mapping のプレビューを同期
    this.syncInactivePreviews();

    // 4 隅ハンドル位置を quad に追従させる
    this.updateQuadHandlePositions();

    // クロップされたビデオは quad とは独立で source rect を埋める
    this.updateVideoCrop();
  }

  private updateQuadHandlePositions(): void {
    if (!this.window) return;
    const handles = this.window.document.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle');
    handles.forEach(handle => {
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) return;
      const p = this.quadData[corner];
      handle.style.left = `${p.x}%`;
      handle.style.top = `${p.y}%`;
    });
  }

  /**
   * 非 active な mapping ごとに preview-mapping div を生成・更新・削除する。
   * cropped-container の前（DOM 順）に挿入することで、active なプレビューが
   * 上に描画される。クリックでその mapping を active 化。
   */
  private syncInactivePreviews(): void {
    if (!this.window || !this.croppedContainer) return;
    const stage = this.croppedContainer.parentElement;
    if (!stage) return;
    const doc = this.window.document;

    const inactiveIds = new Set(
      this.state.mappings.filter(m => m.id !== this.state.activeId).map(m => m.id)
    );

    // 不要になった preview を削除（消滅・active 化）
    for (const [id, { div }] of this.inactivePreviews) {
      if (!inactiveIds.has(id)) {
        div.remove();
        this.inactivePreviews.delete(id);
      }
    }

    // 各非 active mapping を反映
    for (let i = 0; i < this.state.mappings.length; i++) {
      const m = this.state.mappings[i];
      if (m.id === this.state.activeId) continue;

      let entry = this.inactivePreviews.get(m.id);
      if (!entry) {
        const div = doc.createElement('div');
        div.className = 'preview-mapping inactive';
        div.dataset.mappingId = m.id;
        const video = doc.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        div.appendChild(video);
        // active container の前 = 描画上は active より後ろ
        stage.insertBefore(div, this.croppedContainer);
        // クリックで active 化（drag は不可）
        div.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.replaceState(withActiveSet(this.state, m.id));
        });
        this.bindStreamToInactiveVideo(video);
        entry = { div, video };
        this.inactivePreviews.set(m.id, entry);
      }

      // 色を CSS 変数に
      entry.div.style.setProperty('--mapping-color', mappingColor(i));
      applyQuadTransform(entry.div, m.quad);
      applyVideoCrop(entry.video, m.source);
    }
  }

  private bindStreamToInactiveVideo(video: HTMLVideoElement): void {
    if (!this.sourceVideo || !this.sourceVideo.srcObject) return;
    if (video.srcObject === this.sourceVideo.srcObject) return;
    video.srcObject = this.sourceVideo.srcObject;
    video.play().catch(error => {
      console.warn('ControlWindow: inactive preview の再生失敗', error);
    });
  }

  private refreshInactivePreviewStreams(): void {
    this.inactivePreviews.forEach(({ video }) => this.bindStreamToInactiveVideo(video));
  }

  private updateCroppedVideo(): void {
    if (!this.croppedVideo) return;

    // ソースビデオがまだ設定されていない場合は、mapping-videoから取得
    if (!this.mappingVideo) {
      this.mappingVideo = this.window?.document.getElementById('mapping-video') as HTMLVideoElement;
    }

    if (!this.mappingVideo) return;

    // 同じ MediaStream を共有 bind（clone なし、同期再生される）
    if (this.mappingVideo.srcObject && !this.croppedVideo.srcObject) {
      this.croppedVideo.srcObject = this.mappingVideo.srcObject;

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
    applyVideoCrop(this.croppedVideo, this.sourceSelectionData);
  }

  private setupMessageListener(): void {
    if (!this.window) return;

    this.window.addEventListener('message', (event) => {
      const parentWindow = this.getParentWindow();
      if (parentWindow && event.source !== parentWindow) return;
      if (parentWindow && event.origin !== parentWindow.location.origin) return;

      switch (event.data.type) {
        case 'state-update':
          this.handleStateUpdate(event.data.data);
          break;
        case 'video-dimensions-update':
          this.handleVideoDimensionsUpdate(event.data.data);
          break;
        case 'test-pattern-update':
          this.updateTestPatternUI(event.data.data?.kind ?? 'off');
          break;
      }
    });
    
    // ウィンドウリサイズ時にアスペクト比とホモグラフィー行列を再計算
    this.window.addEventListener('resize', () => {
      this.updateSourceVideoAspectRatio();
      this.updateQuadTransform();
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

  /**
   * 親 (WindowController) からの canonical state push を mirror に反映。
   * active alias を貼り直して UI 全体を再描画。
   */
  private handleStateUpdate(state: MappingsState): void {
    if (!state || !Array.isArray(state.mappings) || state.mappings.length === 0) return;
    this.state = state;
    this.rebindActiveAliases();
    this.updateSelectionBox();
    this.updateQuadTransform();
    this.updateToolValues();
    this.renderMappingsList();
  }

  /** テストパターンボタンの active 表示を kind に合わせて切り替える（state は親が持っている）。 */
  private updateTestPatternUI(kind: string): void {
    if (!this.window) return;
    this.window.document.querySelectorAll('.test-pattern-btn').forEach(el => {
      const btn = el as HTMLElement;
      btn.classList.toggle('active', btn.dataset.pattern === kind);
    });
  }

  /** ユーザーがテストパターン切り替えボタンを押したことを親に伝える。 */
  private sendTestPatternRequest(kind: string): void {
    const targetWindow = this.getParentWindow();
    if (!targetWindow) return;
    try {
      // targetOrigin は '*'：このウィンドウは about:blank で origin が 'null' になり得る。
      // 受信側（WindowController.messageHandler）が event.origin を検証している。
      targetWindow.postMessage({
        type: 'test-pattern-set',
        data: { kind },
      }, '*');
    } catch (error) {
      console.error('ControlWindow: test-pattern-set 送信エラー', error);
    }
  }

  /**
   * ローカル mutation 後に呼ぶ。alias 経由で source/quad オブジェクトを直接書き換えると
   * active な entry の同じ参照が更新される（state は同じインスタンス）。
   * postMessage は structured clone でコピーされて親に届くので、双方向の流入はない。
   * targetOrigin は '*'（受信側で origin 検証。OutputWindow の requestStream と同じ理由）。
   */
  private broadcastStateMutation(): void {
    const targetWindow = this.getParentWindow();
    if (!targetWindow) return;
    try {
      targetWindow.postMessage({
        type: 'state-mutation',
        data: this.state satisfies MappingsState,
      }, '*');
    } catch (error) {
      console.error('ControlWindow: state-mutation 送信エラー', error);
    }
  }

  /** プログラム的に state を差し替える時に使う（active 切替・追加・削除など）。 */
  private replaceState(next: MappingsState): void {
    this.state = next;
    this.rebindActiveAliases();
    this.updateSelectionBox();
    this.updateQuadTransform();
    this.updateToolValues();
    this.renderMappingsList();
    this.broadcastStateMutation();
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
