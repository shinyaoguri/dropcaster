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
import type {
  ControlHost,
  OutputBoundsSnapshot,
  TestPatternKindOrOff,
  Unsubscribe,
  VideoDimensions,
  WebglContextStatus,
} from './ControlHost';

export class ControlWindow extends BaseWindow {
  private sourceVideo: HTMLVideoElement | null = null;
  private mappingVideo: HTMLVideoElement | null = null;
  private selectionBox: HTMLDivElement | null = null;
  private croppedContainer: HTMLDivElement | null = null;
  private croppedVideo: HTMLVideoElement | null = null;
  // 非アクティブ mapping のプレビュー要素（active は cropped-container を流用）
  private inactivePreviews = new Map<string, { div: HTMLDivElement; video: HTMLVideoElement; sig: string }>();
  private videoActualDimensions = {
    width: 1,
    height: 1
  };

  /**
   * 出力ウィンドウ（プロジェクション出力用ポップアウト）と、それが載っているディスプレイの寸法・全画面状態。
   * WindowController から output-dimensions-update で push される。innerWidth/Height は quad の「出力1px」ステップにも使う。
   */
  private outputBounds = { innerWidth: 0, innerHeight: 0, screenWidth: 0, screenHeight: 0, isFullscreen: false };
  /** 矢印キーで微調整する対象（quad の隅 / ソース矩形）。null = 未選択。 */
  private keyboardSelection: { type: 'quad'; corner: CornerKey } | { type: 'source' } | null = null;
  /** マッピング領域（#mapping-area）の寸法変化を見張る observer。カラムリサイザのドラッグや
   *  ウィンドウサイズ変更に応じて matrix3d を再計算するために使う。 */
  private mappingAreaObserver: ResizeObserver | null = null;
  private mappingAreaResizeRafId: number | null = null;
  /** ウィンドウ resize 由来の再レイアウトを 1 フレームに 1 回へ間引くための rAF id。 */
  private resizeRafId: number | null = null;
  /** ホスト環境依存の I/O を集約した seam。null = 未初期化。 */
  private controlHost: ControlHost | null = null;
  /** host のイベント購読解除関数。dispose で全部呼ぶ。 */
  private hostUnsubs: Unsubscribe[] = [];

  /**
   * id / class ベースの DOM 探索はすべてこの要素配下で行う（inline マウント先要素）。
   * main 側の id と衝突しないようにするための seam。null = 未初期化。
   */
  private get scopeEl(): HTMLElement | null {
    return this.controlHost?.host ?? null;
  }

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

  /**
   * BaseWindow の契約上必要だが ControlWindow は inline 専用なので使われない。
   * mountInline() が唯一の起動経路。
   */
  protected initialize(): void {
    /* no-op */
  }

  /**
   * inline 起動：main 内ペインとしてマウントする。
   * outer は <aside> 等のマウント先要素。中身は getContent() で差し替えられ、
   * ControlHost は呼び出し側が hostBuilder で組み立てる（InlineControlHost を渡す想定）。
   * outer の ownerDocument の head に CSS を 1 度だけ注入する。
   */
  mountInline(outer: HTMLElement, hostBuilder: (shell: HTMLElement) => ControlHost): void {
    this.resizeRafId = null;
    outer.innerHTML = this.getContent();
    this.injectStylesInto(outer.ownerDocument);
    const shell = outer.querySelector('.dc-control-shell') as HTMLElement | null;
    if (!shell) return;
    this.mount(hostBuilder(shell));
  }

  /** host 確定後のセットアップを行う（mountInline から呼ばれる）。 */
  private mount(host: ControlHost): void {
    this.disposeHost(); // 既存 host があれば確実に剥がす
    this.controlHost = host;
    this.setupHostSubscriptions();
    this.setupControls();
    this.setupMessageListener();
    // 初期化時にアスペクト比を設定（出力ウィンドウの寸法は WindowController から後で push される）
    setTimeout(() => {
      this.updateSourceVideoAspectRatio();
      this.updateOutputViz();
    }, 100);
  }

  /** CSS を host の owner document へ 1 度だけ注入する（inline 起動用）。重複注入を防ぐ。 */
  private static injectedDocs = new WeakSet<Document>();
  private injectStylesInto(doc: Document): void {
    if (ControlWindow.injectedDocs.has(doc)) return;
    ControlWindow.injectedDocs.add(doc);
    const style = doc.createElement('style');
    style.textContent = this.getStyles();
    style.setAttribute('data-dropcaster', 'control-panel');
    doc.head.appendChild(style);
  }

  /** ControlHost の各イベントを購読し、対応する UI 更新メソッドへ転送する。 */
  private setupHostSubscriptions(): void {
    const h = this.controlHost;
    if (!h) return;
    this.hostUnsubs.push(
      h.onStateChange((s: MappingsState) => this.handleStateUpdate(s)),
      h.onVideoDimensionsChange((d: VideoDimensions) => this.handleVideoDimensionsUpdate(d)),
      h.onOutputBoundsChange((b: OutputBoundsSnapshot) => this.handleOutputBoundsUpdate(b)),
      h.onTestPatternChange((k: TestPatternKindOrOff) => this.updateTestPatternUI(k)),
      h.onWebglContextChange((status: WebglContextStatus) => this.updateWebglContextBanner(status)),
    );
  }

  /** 購読を全部外して host 自体も dispose する。inline 解除時に呼ぶ。 */
  private disposeHost(): void {
    this.hostUnsubs.forEach(u => { try { u(); } catch { /* ignore */ } });
    this.hostUnsubs = [];
    // host 実装が listener を抱えていれば外す（InlineControlHost は no-op）
    this.controlHost?.dispose?.();
    this.controlHost = null;
    // マッピング領域の ResizeObserver も解除
    this.mappingAreaObserver?.disconnect();
    this.mappingAreaObserver = null;
    if (this.mappingAreaResizeRafId !== null) {
      cancelAnimationFrame(this.mappingAreaResizeRafId);
      this.mappingAreaResizeRafId = null;
    }
  }

  /** inline 経路で mount された ControlWindow を外側から片付けるための public API。 */
  destroy(): void {
    this.disposeHost();
  }

  protected getContent(): string {
    // すべての要素を .dc-control-shell の subtree に閉じ込めるための wrapper。
    // 内部の selector を後段で @scope (.dc-control-shell) や明示 prefix で
    // スコープ化したとき、main にマウントしても main の CSS と干渉しないようにする。
    // Step 1 では wrapper だけ用意し、CSS 本体の prefix は Step 2 で必要に応じて行う。
    return `
      <div class="dc-control-shell">
      <div id="dc-webgl-lost-banner" class="dc-banner dc-banner-warn" hidden role="status">
        <span class="dc-banner-icon">⚠</span>
        <span class="dc-banner-text">
          WebGL コンテキストが失われました（GPU プロセスのクラッシュ等）。<br>
          2 秒以内に復帰しなければソースを自動リロードします。
        </span>
      </div>
      <div class="control-container">
        <!-- ツールカラム -->
        <div class="column tool-column" data-resize-target="tool">
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
              <p class="section-hint">枠をクリックで選択 → 矢印キーで微調整（Shift+矢印で10px）</p>
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
              <p class="section-hint">隅のハンドルをクリックで選択 → 矢印キーで微調整（Shift+矢印で10px）</p>
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

        <!-- tool ↔ source の区切りリサイザ -->
        <div class="dc-column-resizer" data-resize-edge="tool" title="ドラッグでツールカラムの幅を変更" aria-hidden="true"></div>

        <!-- ソースカラム -->
        <div class="column source-column" data-resize-target="source">
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

        <!-- source ↔ mapping の区切りリサイザ -->
        <div class="dc-column-resizer" data-resize-edge="source" title="ドラッグでソース／マッピング欄の比率を変更" aria-hidden="true"></div>

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
                <span id="display-size">—</span>
                <span class="separator">|</span>
                <span class="size-label">出力ウィンドウ:</span>
                <span id="window-size">—</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    `;
  }

  protected getStyles(): string {
    // すべてのスタイルを @scope (.dc-control-shell) で囲って、main にインライン
    // マウントしたときに main 側 DOM へスタイルが漏れないようにする。@scope 内では
    // body セレクタは（body が shell の祖先なので）マッチしない。
    //
    // BaseWindow.getStyles() の generic ルール（h1, button, .window-container 等）も
    // @scope 配下に閉じ込められるので main の同名要素には影響しない。
    return `@scope (.dc-control-shell) {
      ${super.getStyles()}

      /* ソースウィンドウが hidden になったときの警告バナー（B 対応） */
      .dc-banner {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: #b91c1c;
        color: #fff;
        font-size: 13px;
        line-height: 1.4;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      }
      .dc-banner[hidden] { display: none; }
      .dc-banner .dc-banner-icon { font-size: 18px; flex: 0 0 auto; }
      .dc-banner .dc-banner-text { flex: 1 1 auto; }
      #dc-webgl-lost-banner { background: #ca8a04; }

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
        width: 280px;
        min-width: 240px;
        max-width: 340px;
        background: #222;
        overflow-y: auto;
      }

      /* ソース選択（左ペイン）と warp 後プレビュー（右ペイン）は均等 flex で広げる。
         全画面エディタになったので、3 列ともゆとりのある幅で表示される。 */
      .source-column {
        flex: 1 1 0;
        min-width: 360px;
      }

      .mapping-column {
        flex: 1 1 0;
        min-width: 360px;
      }

      /* カラム間のドラッグリサイザ。control-container の flex 行の中に薄く入る。 */
      .dc-column-resizer {
        flex: 0 0 auto;
        width: 6px;
        background: #2a2a2a;
        border-left: 1px solid #444;
        border-right: 1px solid #444;
        cursor: col-resize;
        transition: background 0.12s ease;
        user-select: none;
        touch-action: none;
      }
      .dc-column-resizer:hover { background: #3b82f6; }
      .dc-column-resizer.dragging { background: #2563eb; }
      /* ドラッグ中は cursor とテキスト選択を本体側で抑止する（CSS の @scope 外では
         body セレクタが使えないため、JS で body.style を直書きして対応） */

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
        /* キャンバスのアスペクト比は --canvas-aspect として scope に注入される（JS から更新）。
           aspect-ratio + max-width/height で「コンテナに収まる最大サイズ・アスペクト固定」を実現。
           親 .source-preview-wrapper は flex 中央寄せなので、letterbox 部分は両端の余白になる。 */
        aspect-ratio: var(--canvas-aspect, 16 / 9);
        max-width: 100%;
        max-height: 100%;
        width: 100%;
        height: auto;
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

      /* 矢印キーで微調整中の選択枠（白いリング） */
      #selection-box.kbd-selected {
        box-shadow: 0 0 0 2px #fff, 0 0 6px rgba(0, 0, 0, 0.8);
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

      /* 矢印キーで微調整中の選択ハンドル（白いリング） */
      .quad-handle.kbd-selected {
        box-shadow: 0 0 0 3px #fff, 0 0 6px rgba(0, 0, 0, 0.8);
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

      /* レスポンシブ対応：横幅が足りないときは tool 列を絞る。それでも足りないときは
         スクロール（control-container は flex なので各列が min-width 維持） */
      @media (max-width: 1100px) {
        .tool-column {
          width: 220px;
          min-width: 200px;
        }
      }
      @media (max-width: 900px) {
        .tool-column {
          width: 200px;
          min-width: 180px;
          max-width: 220px;
        }
        .source-column, .mapping-column {
          min-width: 300px;
        }
      }
    }`;
  }

  protected setupEventListeners(): void {
    // ストリームの設定はWindowControllerが直接行う
  }

  private setupControls(): void {
    const scope = this.scopeEl;
    if (!scope) return;

    // ビデオ要素を取得（scope = ControlHost.host：inline マウント先要素）
    this.sourceVideo = scope.querySelector('#source-video') as HTMLVideoElement;
    this.mappingVideo = scope.querySelector('#mapping-video') as HTMLVideoElement;
    this.croppedContainer = scope.querySelector('#cropped-container') as HTMLDivElement;
    this.croppedVideo = scope.querySelector('#cropped-video') as HTMLVideoElement;
    this.selectionBox = scope.querySelector('#selection-box') as HTMLDivElement;

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

    // 矢印キーによる微調整
    this.setupKeyboardNudge();

    // カラム間のドラッグリサイザ（前回保存幅の復元含む）
    this.setupColumnResizers();

    // 初期値を更新
    this.updateToolValues();
  }

  /**
   * 3 カラム（tool / source / mapping）の間に置かれた .dc-column-resizer を
   * マウスでドラッグして幅を調整できるようにする。
   *   - tool 側リサイザ: tool-column の width を直接書き換える（min/max は CSS でクランプ）。
   *     source・mapping は flex で残りを分け合う。
   *   - source 側リサイザ: source-column の flex-basis を書き換えて、source vs mapping の
   *     比率を変える。mapping は flex 維持で残りを取る。
   *
   * ユーザの設定は localStorage に保存し、次回マウント時に復元する。
   */
  private setupColumnResizers(): void {
    const scope = this.scopeEl;
    const doc = this.hostDoc;
    if (!scope || !doc) return;

    const toolCol  = scope.querySelector<HTMLElement>('.tool-column');
    const sourceCol = scope.querySelector<HTMLElement>('.source-column');
    const mappingCol = scope.querySelector<HTMLElement>('.mapping-column');
    if (!toolCol || !sourceCol || !mappingCol) return;

    // localStorage から前回の幅を復元
    this.restoreColumnWidths(toolCol, sourceCol);

    const resizers = scope.querySelectorAll<HTMLElement>('.dc-column-resizer');
    resizers.forEach(resizer => {
      const edge = resizer.dataset.resizeEdge; // 'tool' or 'source'
      if (edge !== 'tool' && edge !== 'source') return;

      resizer.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startToolW = toolCol.getBoundingClientRect().width;
        const startSourceW = sourceCol.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        const prevCursor = doc.body.style.cursor;
        const prevUserSelect = doc.body.style.userSelect;
        doc.body.style.cursor = 'col-resize';
        doc.body.style.userSelect = 'none';

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          if (edge === 'tool') {
            // tool-column の幅を直接変更（CSS の min/max にクランプされる）
            toolCol.style.width = `${Math.max(180, startToolW + dx)}px`;
          } else {
            // source-column を「固定 width で flex-basis に展開」して、source vs mapping の比率を決める。
            // mapping-column は flex:1 のまま残りを取る。
            const nextSourceW = Math.max(280, startSourceW + dx);
            sourceCol.style.flex = '0 0 auto';
            sourceCol.style.width = `${nextSourceW}px`;
          }
        };

        const onUp = () => {
          resizer.classList.remove('dragging');
          doc.body.style.cursor = prevCursor;
          doc.body.style.userSelect = prevUserSelect;
          doc.removeEventListener('mousemove', onMove);
          doc.removeEventListener('mouseup', onUp);
          this.persistColumnWidths(toolCol, sourceCol);
        };

        doc.addEventListener('mousemove', onMove);
        doc.addEventListener('mouseup', onUp);
      });
    });
  }

  /** カラム幅を localStorage に保存（key: dropcaster.control.columnWidths.v1）。 */
  private persistColumnWidths(toolCol: HTMLElement, sourceCol: HTMLElement): void {
    try {
      const payload = {
        tool: toolCol.getBoundingClientRect().width,
        source: sourceCol.getBoundingClientRect().width,
      };
      localStorage.setItem('dropcaster.control.columnWidths.v1', JSON.stringify(payload));
    } catch { /* ignore quota / private mode */ }
  }

  /** localStorage から前回保存した幅を復元（無ければ何もしない）。 */
  private restoreColumnWidths(toolCol: HTMLElement, sourceCol: HTMLElement): void {
    try {
      const raw = localStorage.getItem('dropcaster.control.columnWidths.v1');
      if (!raw) return;
      const data = JSON.parse(raw) as { tool?: number; source?: number };
      if (typeof data.tool === 'number' && data.tool > 0) {
        toolCol.style.width = `${data.tool}px`;
      }
      if (typeof data.source === 'number' && data.source > 0) {
        sourceCol.style.flex = '0 0 auto';
        sourceCol.style.width = `${data.source}px`;
      }
    } catch { /* ignore parse error */ }
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

    // #mapping-area の寸法変化を監視して matrix3d を再計算する。カラム間ドラッグリサイザでの
    // 幅変更に追従させるため。matrix3d は親の getBoundingClientRect ベースで毎回計算するので、
    // ピクセル寸法が変わったらやり直さないと warp が静止したまま %ベースのハンドル位置だけ
    // ずれて見える（user 報告: ハンドル位置が同期されない）。
    this.observeMappingAreaResize();

    // ストリームが設定されるのを待つ
    setTimeout(() => {
      this.updateCroppedVideo();
    }, 1000);
  }

  private observeMappingAreaResize(): void {
    // 旧 observer があれば disconnect（再 mount 時の保険）
    this.mappingAreaObserver?.disconnect();
    this.mappingAreaObserver = null;

    const target = this.scopeEl?.querySelector('#mapping-area') as HTMLElement | null;
    if (!target) return;

    const win = this.controlHost?.window ?? window;
    this.mappingAreaObserver = new ResizeObserver(() => {
      // 1 frame に 1 回へコアレス（ドラッグ中は連続発火するので毎回 matrix3d を更新しない）
      if (this.mappingAreaResizeRafId !== null) return;
      this.mappingAreaResizeRafId = win.requestAnimationFrame(() => {
        this.mappingAreaResizeRafId = null;
        this.updateQuadTransform();
      });
    });
    this.mappingAreaObserver.observe(target);
  }

  private setupToolButtons(): void {
    const scope = this.scopeEl;
    if (!scope) return;

    // リセットボタン
    const resetSourceBtn = scope.querySelector('#reset-source-btn');
    if (resetSourceBtn) {
      resetSourceBtn.addEventListener('click', () => {
        this.setActiveSource({ x: 0, y: 0, width: 100, height: 100 });
        this.updateAfterSourceChange();
        this.updateToolValues();
        this.broadcastStateMutation();
      });
    }

    const resetMappingBtn = scope.querySelector('#reset-mapping-btn');
    if (resetMappingBtn) {
      resetMappingBtn.addEventListener('click', () => {
        this.setActiveQuad(defaultQuad());
        this.updateQuadTransform();
        this.updateToolValues();
        this.broadcastStateMutation();
      });
    }

    // テストパターンボタン（off / white / grid / smpte）
    const testPatternBtns = scope.querySelectorAll('.test-pattern-btn');
    testPatternBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const kind = (e.currentTarget as HTMLElement).dataset.pattern as
          TestPatternKindOrOff | undefined;
        if (!kind) return;
        // optimistic に active 表示を切り替え（parent から test-pattern-update が返って確定）
        this.updateTestPatternUI(kind);
        this.controlHost?.requestTestPattern(kind);
      });
    });

    // マッピング追加ボタン
    const addMappingBtn = scope.querySelector('#add-mapping-btn');
    if (addMappingBtn) {
      addMappingBtn.addEventListener('click', () => {
        this.replaceState(withAddedMapping(this.state));
      });
    }

    // 保存（JSON ダウンロード）
    const exportBtn = scope.querySelector('#export-mappings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportMappingsToFile());
    }

    // 読み込み（JSON ファイルピッカー）
    const importBtn = scope.querySelector('#import-mappings-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.importMappingsFromFile());
    }

    // 初期一覧を描画
    this.renderMappingsList();

    // ディスプレイサイズを更新
    this.updateOutputViz();
  }

  /** マッピング一覧の HTML を再生成し、クリック・削除ハンドラを貼り直す。 */
  private renderMappingsList(): void {
    const listEl = this.scopeEl?.querySelector('#mappings-list') as HTMLElement | null;
    if (!listEl) return;

    const canRemove = this.state.mappings.length > 1;
    const doc = this.hostDoc ?? document;

    // インポート JSON や localStorage 経由で `m.id` / `m.name` に細工した文字列が
    // 混入しても XSS にならないよう、innerHTML テンプレート補間ではなく
    // DOM API（textContent / dataset / style.setProperty）で組み立てる。
    listEl.replaceChildren();

    this.state.mappings.forEach((m, idx) => {
      const isActive = m.id === this.state.activeId;
      const enabled = isMappingEnabled(m);
      const displayName = m.name ?? `Mapping ${idx + 1}`;
      const color = mappingColor(idx);

      const item = doc.createElement('div');
      item.className = `mapping-list-item${isActive ? ' active' : ''}${enabled ? '' : ' disabled'}`;
      item.dataset.id = m.id;
      item.style.setProperty('--mapping-color', color);

      const chip = doc.createElement('span');
      chip.className = 'color-chip';
      item.appendChild(chip);

      const nameSpan = doc.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = displayName;
      item.appendChild(nameSpan);

      const toggleBtn = doc.createElement('button');
      toggleBtn.className = `toggle-btn${enabled ? ' enabled' : ''}`;
      toggleBtn.dataset.id = m.id;
      toggleBtn.title = enabled ? '出力中（クリックで停止）' : '停止中（クリックで出力）';
      toggleBtn.textContent = enabled ? '●' : '○';
      item.appendChild(toggleBtn);

      const removeBtn = doc.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.dataset.id = m.id;
      removeBtn.title = '削除';
      removeBtn.textContent = '×';
      if (!canRemove) removeBtn.disabled = true;
      item.appendChild(removeBtn);

      listEl.appendChild(item);
    });

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
        if (!id) return;
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

  /** ホスト要素のオーナードキュメント（要素生成・ファイル取得 UI に使う）。 */
  private get hostDoc(): Document | null {
    return this.scopeEl?.ownerDocument ?? null;
  }

  /** ホスト要素のオーナーウィンドウ（alert などに使う）。 */
  private get hostWin(): Window | null {
    return this.hostDoc?.defaultView ?? null;
  }

  private exportMappingsToFile(): void {
    const doc = this.hostDoc;
    if (!doc) return;
    const json = JSON.stringify(this.state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `dropcaster-mappings-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importMappingsFromFile(): void {
    const doc = this.hostDoc;
    if (!doc) return;
    const input = doc.createElement('input');
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
              this.hostWin?.alert('読み込みに失敗しました（フォーマット不正）');
              return;
            }
            this.replaceState(parsed);
          } catch (error) {
            this.hostWin?.alert('読み込みに失敗しました（JSON 解析失敗）');
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
    const doc = this.hostDoc;
    if (!doc) return;
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
    const scope = this.scopeEl;
    if (!scope) return;

    // ソース値の更新
    const sourceX = scope.querySelector('#source-x-value');
    const sourceY = scope.querySelector('#source-y-value');
    const sourceW = scope.querySelector('#source-w-value');
    const sourceH = scope.querySelector('#source-h-value');

    if (sourceX) sourceX.textContent = this.sourceSelectionData.x.toFixed(1);
    if (sourceY) sourceY.textContent = this.sourceSelectionData.y.toFixed(1);
    if (sourceW) sourceW.textContent = this.sourceSelectionData.width.toFixed(1);
    if (sourceH) sourceH.textContent = this.sourceSelectionData.height.toFixed(1);

    // マッピング: 4隅の値を更新
    const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
    const tl = scope.querySelector('#mapping-tl-value');
    const tr = scope.querySelector('#mapping-tr-value');
    const bl = scope.querySelector('#mapping-bl-value');
    const br = scope.querySelector('#mapping-br-value');
    if (tl) tl.textContent = fmt(this.quadData.topLeft);
    if (tr) tr.textContent = fmt(this.quadData.topRight);
    if (bl) bl.textContent = fmt(this.quadData.bottomLeft);
    if (br) br.textContent = fmt(this.quadData.bottomRight);
  }

  private initializeSelectionBox(): void {
    if (!this.sourceVideo || !this.selectionBox) return;

    // デフォルトで全体を選択
    this.setActiveSource({ x: 0, y: 0, width: 100, height: 100 });

    this.updateAfterSourceChange();
    this.broadcastStateMutation();
  }

  private setupSourceDragHandlers(): void {
    const doc = this.hostDoc;
    if (!this.selectionBox || !doc) return;

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

      this.setKeyboardSelection({ type: 'source' });
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

      this.updateAfterSourceChange();
      this.updateToolValues();
      this.broadcastStateMutation();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    this.selectionBox.addEventListener('mousedown', handleMouseDown);
    doc.addEventListener('mousemove', handleMouseMove);
    doc.addEventListener('mouseup', handleMouseUp);
  }

  private setupSourceResizeHandlers(): void {
    const doc = this.hostDoc;
    if (!this.selectionBox || !doc) return;

    const handles = this.selectionBox.querySelectorAll('.handle, .edge');
    
    handles.forEach(handle => {
      let isResizing = false;
      let startX = 0;
      let startY = 0;
      let initialData = { x: 0, y: 0, width: 0, height: 0 };

      const handleMouseDown = (e: MouseEvent) => {
        this.setKeyboardSelection({ type: 'source' });
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

        this.updateAfterSourceChange();
        this.updateToolValues();
        this.broadcastStateMutation();
      };

      const handleMouseUp = () => {
        isResizing = false;
      };

      handle.addEventListener('mousedown', handleMouseDown as EventListener);
      doc.addEventListener('mousemove', handleMouseMove as EventListener);
      doc.addEventListener('mouseup', handleMouseUp as EventListener);
    });
  }

  // quad 全体を平行移動（cropped-container の見た目領域をドラッグ）
  private setupMappingDragHandlers(): void {
    const doc = this.hostDoc;
    if (!this.croppedContainer || !doc) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialQuad: Quad = defaultQuad();

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('quad-handle')) return;

      // 隅ハンドルではなく quad 本体のドラッグ — 隅の矢印キー選択は解除
      this.clearKeyboardSelection();
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
    doc.addEventListener('mousemove', handleMouseMove);
    doc.addEventListener('mouseup', handleMouseUp);
  }

  // 4隅ハンドル: それぞれを独立に動かしてホモグラフィー変形を作る
  private setupQuadHandleHandlers(): void {
    const scope = this.scopeEl;
    const doc = this.hostDoc;
    if (!scope || !doc || !this.croppedContainer) return;
    const parent = this.croppedContainer.parentElement;
    if (!parent) return;

    const handles = scope.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle');
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
        this.setKeyboardSelection({ type: 'quad', corner });
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
      doc.addEventListener('mousemove', onMouseMove);
      doc.addEventListener('mouseup', onMouseUp);
    });
  }

  // ── 矢印キーによる微調整（クリックで選択 → 矢印キーで 1px、Shift+矢印で 10px）─────────
  private setupKeyboardNudge(): void {
    const doc = this.hostDoc;
    if (!doc) return;
    doc.addEventListener('keydown', (e) => this.handleNudgeKey(e));
  }

  private setKeyboardSelection(sel: { type: 'quad'; corner: CornerKey } | { type: 'source' } | null): void {
    this.keyboardSelection = sel;
    this.updateKeyboardSelectionUI();
  }

  private clearKeyboardSelection(): void {
    if (!this.keyboardSelection) return;
    this.keyboardSelection = null;
    this.updateKeyboardSelectionUI();
  }

  /** 選択中のハンドル / 枠に .kbd-selected を付け替える。 */
  private updateKeyboardSelectionUI(): void {
    const scope = this.scopeEl;
    if (!scope) return;
    const sel = this.keyboardSelection;
    scope
      .querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle')
      .forEach(h => h.classList.toggle('kbd-selected', sel?.type === 'quad' && h.dataset.corner === sel.corner));
    this.selectionBox?.classList.toggle('kbd-selected', sel?.type === 'source');
  }

  /** quad の「出力1px」の基準サイズ。出力ウィンドウのビューポート → ソース canvas 寸法 → 1920×1080 でフォールバック。 */
  private quadStepRefSize(): { width: number; height: number } {
    const { innerWidth: ow, innerHeight: oh } = this.outputBounds;
    if (ow > 16 && oh > 16) return { width: ow, height: oh };
    const { width: vw, height: vh } = this.videoActualDimensions;
    if (vw > 16 && vh > 16) return { width: vw, height: vh };
    return { width: 1920, height: 1080 };
  }

  /** source 矩形の「ソース1px」の基準サイズ（= キャプチャ canvas 寸法）。未取得なら 1920×1080。 */
  private sourceStepRefSize(): { width: number; height: number } {
    const { width: vw, height: vh } = this.videoActualDimensions;
    if (vw > 16 && vh > 16) return { width: vw, height: vh };
    return { width: 1920, height: 1080 };
  }

  private handleNudgeKey(e: KeyboardEvent): void {
    if (!this.keyboardSelection) return;
    // テキスト入力中は矢印キーを奪わない（マッピング名のインライン編集など）
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;

    let dirX = 0, dirY = 0;
    switch (e.key) {
      case 'ArrowLeft':  dirX = -1; break;
      case 'ArrowRight': dirX =  1; break;
      case 'ArrowUp':    dirY = -1; break;
      case 'ArrowDown':  dirY =  1; break;
      default: return;
    }
    e.preventDefault();
    const pixels = e.shiftKey ? 10 : 1;

    if (this.keyboardSelection.type === 'quad') {
      const corner = this.keyboardSelection.corner;
      const ref = this.quadStepRefSize();
      const p = this.quadData[corner];
      this.setActiveQuad({
        ...this.quadData,
        [corner]: {
          x: p.x + (dirX * pixels * 100) / ref.width,
          y: p.y + (dirY * pixels * 100) / ref.height,
        },
      });
      this.updateQuadTransform();
      this.updateToolValues();
      this.broadcastStateMutation();
    } else {
      const ref = this.sourceStepRefSize();
      const s = this.sourceSelectionData;
      s.x = Math.max(0, Math.min(100 - s.width,  s.x + (dirX * pixels * 100) / ref.width));
      s.y = Math.max(0, Math.min(100 - s.height, s.y + (dirY * pixels * 100) / ref.height));
      this.updateAfterSourceChange();
      this.updateToolValues();
      this.broadcastStateMutation();
    }
  }

  private updateSelectionBox(): void {
    if (!this.selectionBox) return;

    this.selectionBox.style.left = `${this.sourceSelectionData.x}%`;
    this.selectionBox.style.top = `${this.sourceSelectionData.y}%`;
    this.selectionBox.style.width = `${this.sourceSelectionData.width}%`;
    this.selectionBox.style.height = `${this.sourceSelectionData.height}%`;
  }

  /**
   * ソース矩形を変更した直後に呼ぶまとめ更新ヘルパー。
   * ソース側の選択枠と、マッピング側のクロップ済み <video>（および非 active プレビュー）の
   * クロップ表示を同時に再計算する。
   *
   * ソース矩形のドラッグ／リサイズ／矢印キー nudge は同じ依存関係（active mapping の source rect）
   * を持つので、3 箇所がバラバラに呼んでいた updateSelectionBox + 補助呼び出しをここに集約する。
   */
  private updateAfterSourceChange(): void {
    this.updateSelectionBox();
    // #cropped-video は source rect を clip-path で切り取って見せているので、変更を即反映する
    // （抜けるとマッピング側プレビューが古い source 表示のままになる）。
    this.updateVideoCrop();
    // 非 active mapping のプレビュー warp は source も含めた signature で memoize されているので、
    // source が変わったタイミングで再評価する。
    this.syncInactivePreviews();
  }

  private updateQuadTransform(): void {
    if (!this.croppedContainer) return;

    // matrix3d を再計算してコンテナへ適用
    applyQuadTransform(this.croppedContainer, this.quadData);

    // active な mapping の色を CSS 変数として伝播（cropped-container と quad-handle に効く）
    const activeIdx = this.state.mappings.findIndex(m => m.id === this.state.activeId);
    const activeColor = mappingColor(activeIdx >= 0 ? activeIdx : 0);
    this.croppedContainer.style.setProperty('--mapping-color', activeColor);
    this.scopeEl
      ?.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle')
      .forEach(h => h.style.setProperty('--mapping-color', activeColor));

    // 非アクティブ mapping のプレビューを同期
    this.syncInactivePreviews();

    // 4 隅ハンドル位置を quad に追従させる
    this.updateQuadHandlePositions();

    // クロップされたビデオは quad とは独立で source rect を埋める
    this.updateVideoCrop();
  }

  private updateQuadHandlePositions(): void {
    const scope = this.scopeEl;
    if (!scope) return;
    const handles = scope.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle');
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
    if (!this.croppedContainer) return;
    const stage = this.croppedContainer.parentElement;
    if (!stage) return;
    const doc = this.hostDoc;
    if (!doc) return;
    // ステージのピクセルサイズ（変わると quad の px 位置が変わるので sig に含める）
    const stageRect = stage.getBoundingClientRect();
    const stageSig = `${Math.round(stageRect.width)}x${Math.round(stageRect.height)}`;

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
        entry = { div, video, sig: '' };
        this.inactivePreviews.set(m.id, entry);
      }

      // 入力（index ＝色, quad, source, ステージサイズ）が前回と同じなら DOM を触らない。
      // active な quad をドラッグ中、毎フレーム全 inactive preview を再 warp するのを防ぐ。
      const sig = `${stageSig}|${i}|${m.quad.topLeft.x},${m.quad.topLeft.y},${m.quad.topRight.x},${m.quad.topRight.y},${m.quad.bottomRight.x},${m.quad.bottomRight.y},${m.quad.bottomLeft.x},${m.quad.bottomLeft.y}|${m.source.x},${m.source.y},${m.source.width},${m.source.height}`;
      if (sig !== entry.sig) {
        entry.sig = sig;
        entry.div.style.setProperty('--mapping-color', mappingColor(i));
        applyQuadTransform(entry.div, m.quad);
        applyVideoCrop(entry.video, m.source);
      }
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
      this.mappingVideo = this.scopeEl?.querySelector('#mapping-video') as HTMLVideoElement;
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

  /**
   * window スコープのイベント（resize / pagehide）を張る。
   * host の window は main の window（inline マウント）。state 系の購読は
   * controlHost が引き受け setupHostSubscriptions() でイベントハンドラへ橋渡しする。
   */
  private setupMessageListener(): void {
    const win = this.controlHost?.window;
    if (!win) return;

    // ウィンドウリサイズ時にアスペクト比とホモグラフィー行列を再計算（1 フレーム 1 回に間引く）
    win.addEventListener('resize', () => {
      if (this.resizeRafId !== null) return;
      this.resizeRafId = win.requestAnimationFrame(() => {
        this.resizeRafId = null;
        this.updateSourceVideoAspectRatio();
        this.updateQuadTransform();
      });
    });

    // タブを閉じる直前に host 購読を畳む
    win.addEventListener('pagehide', () => this.disposeHost());
  }

  /** ControlHost から push される「出力ウィンドウ＋ディスプレイ寸法／全画面状態」を反映。 */
  private handleOutputBoundsUpdate(b: OutputBoundsSnapshot): void {
    this.outputBounds = { ...b };
    this.updateOutputViz();
  }

  private handleVideoDimensionsUpdate(dimensions: VideoDimensions): void {
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
    this.clearKeyboardSelection();
    this.updateSelectionBox();
    this.updateQuadTransform();
    this.updateToolValues();
    this.renderMappingsList();
  }

  /** WebGL コンテキストの ロスト／復帰 を受けてバナーを切り替える。 */
  private updateWebglContextBanner(status: WebglContextStatus): void {
    const el = this.scopeEl?.querySelector('#dc-webgl-lost-banner');
    if (!el) return;
    if (status === 'lost') el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  /** テストパターンボタンの active 表示を kind に合わせて切り替える（state は親が持っている）。 */
  private updateTestPatternUI(kind: TestPatternKindOrOff): void {
    this.scopeEl?.querySelectorAll('.test-pattern-btn').forEach(el => {
      const btn = el as HTMLElement;
      btn.classList.toggle('active', btn.dataset.pattern === kind);
    });
  }

  /**
   * ローカル mutation 後に呼ぶ。alias 経由で source/quad オブジェクトを直接書き換えると
   * active な entry の同じ参照が更新される（state は同じインスタンス）。
   * 連続発火（ドラッグ移動・矢印キー連打）の間引きや親への送信は ControlHost が責任を持つ。
   */
  private broadcastStateMutation(): void {
    this.controlHost?.emitStateMutation(this.state);
  }

  /** プログラム的に state を差し替える時に使う（active 切替・追加・削除など）。 */
  private replaceState(next: MappingsState): void {
    this.state = next;
    this.rebindActiveAliases();
    this.clearKeyboardSelection();
    this.updateSelectionBox();
    this.updateQuadTransform();
    this.updateToolValues();
    this.renderMappingsList();
    this.broadcastStateMutation();
  }
  
  /**
   * 「ディスプレイに対する出力ウィンドウの大きさ」と全画面状態を可視化する。
   * 表示するのはプロジェクション出力に使う出力ウィンドウ（メインの操作ウィンドウではない）。
   * 寸法・全画面状態は WindowController から output-dimensions-update で push される。
   */
  private updateOutputViz(): void {
    const scope = this.scopeEl;
    if (!scope) return;
    const { innerWidth: w, innerHeight: h, screenWidth: sw, screenHeight: sh, isFullscreen } = this.outputBounds;

    // ステータスバッジ（ウィンドウ／フルスクリーン）はデータが無くても更新できる
    const displayMode = scope.querySelector('#display-mode');
    if (displayMode) displayMode.textContent = isFullscreen ? 'フルスクリーン' : 'ウィンドウ';
    const displayStatus = scope.querySelector('.display-status');
    if (displayStatus) {
      displayStatus.classList.remove('fullscreen', 'window');
      displayStatus.classList.add(isFullscreen ? 'fullscreen' : 'window');
    }

    // 出力ウィンドウがまだ開いていない等で寸法が無いときはプレースホルダのまま
    if (sw <= 0 || sh <= 0) return;

    const displaySize = scope.querySelector('#display-size');
    if (displaySize) displaySize.textContent = `${sw}x${sh}`;
    const displayFrame = scope.querySelector('#display-frame') as HTMLDivElement | null;
    if (displayFrame) displayFrame.style.aspectRatio = `${sw / sh}`;

    const windowSize = scope.querySelector('#window-size');
    if (windowSize) windowSize.textContent = w > 0 && h > 0 ? `${w}x${h}` : '—';

    const windowFrame = scope.querySelector('#window-frame') as HTMLDivElement | null;
    if (windowFrame) {
      const wPct = w > 0 ? Math.min(100, (w / sw) * 100) : 100;
      const hPct = h > 0 ? Math.min(100, (h / sh) * 100) : 100;
      windowFrame.style.position = 'absolute';
      windowFrame.style.left = '50%';
      windowFrame.style.top = '50%';
      windowFrame.style.transform = 'translate(-50%, -50%)';
      windowFrame.style.width = `${wPct}%`;
      windowFrame.style.height = `${hPct}%`;
      windowFrame.classList.toggle('fullscreen', isFullscreen);
    }

    // #window-frame（= #mapping-area の祖先）のサイズが変わったので quad の matrix3d を再計算
    this.updateQuadTransform();
  }

  /**
   * ソース canvas のアスペクト比を CSS カスタムプロパティ --canvas-aspect として scope に注入する。
   * .canvas-frame 側で `aspect-ratio: var(--canvas-aspect)` + `max-width/height: 100%` を当てて
   * いるので、レイアウトとリサイズの追従はブラウザ任せ（カラム幅をドラッグしても比率は固定）。
   *
   * 旧実装は wrapper の getBoundingClientRect から frame サイズを毎回 px で算出していたが、
   * カラムリサイザを足したときに「ドラッグ中に再計算が走らずアスペクト比が崩れる」問題が出るので
   * CSS aspect-ratio 任せに切り替えた。
   */
  private updateSourceVideoAspectRatio(): void {
    const scope = this.scopeEl;
    if (!scope) return;
    const canvasWidth = this.videoActualDimensions.width || (this.sourceVideo?.videoWidth) || 1920;
    const canvasHeight = this.videoActualDimensions.height || (this.sourceVideo?.videoHeight) || 1080;
    if (canvasWidth <= 0 || canvasHeight <= 0) return;
    scope.style.setProperty('--canvas-aspect', `${canvasWidth} / ${canvasHeight}`);
  }
}
