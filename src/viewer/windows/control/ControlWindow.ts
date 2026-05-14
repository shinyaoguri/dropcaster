import { BaseWindow } from '../shared/BaseWindow';
import { CONTROL_PANEL_HTML } from './ControlWindow.template';
import { CONTROL_PANEL_CSS } from './ControlWindow.styles';
import { ColumnResizers } from './panels/ColumnResizers';
import { OutputVizPanel } from './panels/OutputVizPanel';
import { InactivePreviewPool } from './panels/InactivePreviewPool';
import { KeyboardNudge } from './panels/KeyboardNudge';
import { MappingsListPanel } from './panels/MappingsListPanel';
import { MappingsController } from './MappingsController';
import {
  applyVideoCrop,
  applyQuadTransform,
  defaultMappingsState,
  defaultQuad,
  translateQuad,
  cloneQuad,
  getActiveMapping,
  withActiveSet,
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
  private inactivePreviews = new InactivePreviewPool();
  private videoActualDimensions = {
    width: 1,
    height: 1
  };

  /**
   * 出力ウィンドウ（プロジェクション出力用ポップアウト）と、それが載っているディスプレイの寸法・全画面状態。
   * WindowController から output-dimensions-update で push される。innerWidth/Height は quad の「出力1px」ステップにも使う。
   */
  private outputBounds = { innerWidth: 0, innerHeight: 0, screenWidth: 0, screenHeight: 0, isFullscreen: false };
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
  private columnResizers = new ColumnResizers();
  private outputViz = new OutputVizPanel();
  private keyboardNudge = new KeyboardNudge();
  private mappingsList = new MappingsListPanel();
  private ctrl = new MappingsController({
    getState: () => this.state,
    getActiveSource: () => this.sourceSelectionData,
    getActiveQuad: () => this.quadData,
    setActiveQuad: (q) => this.setActiveQuad(q),
    replaceState: (next) => this.replaceState(next),
    commit: () => this.broadcastStateMutation(),
  });

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
    setTimeout(() => this.outputViz.refresh(), 100);
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
    this.columnResizers.destroy();
    this.outputViz.destroy();
    this.inactivePreviews.destroy();
    this.keyboardNudge.destroy();
    this.mappingsList.destroy();
  }

  /** inline 経路で mount された ControlWindow を外側から片付けるための public API。 */
  destroy(): void {
    this.disposeHost();
  }

  protected getContent(): string {
    return CONTROL_PANEL_HTML;
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
${CONTROL_PANEL_CSS}
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
        this.outputViz.refreshAspectRatio();
        this.inactivePreviews.rebindStreams();
      });
    }

    // ソース選択ボックスの設定
    this.setupSelectionBox();

    // マッピング領域の設定
    this.setupMappingArea();

    // ツールボタンの設定
    this.setupToolButtons();

    // 矢印キーによる微調整
    if (this.hostDoc) {
      this.keyboardNudge.attach(scope, this.hostDoc, this.ctrl, {
        getQuadRefSize: () => this.quadStepRefSize(),
        getSourceRefSize: () => this.sourceStepRefSize(),
        getSelectionBox: () => this.selectionBox,
        onAfterMutate: (type) => {
          if (type === 'quad') this.updateQuadTransform();
          else this.updateAfterSourceChange();
          this.updateToolValues();
        },
      });
    }

    // カラム間のドラッグリサイザ（前回保存幅の復元含む）
    if (this.scopeEl && this.hostDoc) {
      this.columnResizers.attach(this.scopeEl, this.hostDoc);
    }

    // 出力ウィンドウ枠 + canvas アスペクト比の可視化
    this.outputViz.attach(scope, {
      getOutputBounds: () => this.outputBounds,
      getVideoDimensions: () => this.videoActualDimensions,
      getSourceVideo: () => this.sourceVideo,
      onWindowFrameReflow: () => this.updateQuadTransform(),
    });

    // マッピング一覧と add / export / import ボタン
    if (this.hostDoc) {
      this.mappingsList.attach(scope, this.hostDoc, this.ctrl, {
        getHostWin: () => this.hostWin,
      });
    }

    // 初期値を更新
    this.updateToolValues();
  }

  private setupSelectionBox(): void {
    if (!this.selectionBox || !this.sourceVideo) return;

    // ビデオが読み込まれたら初期位置を設定
    this.sourceVideo.addEventListener('loadedmetadata', () => {
      this.initializeSelectionBox();
      this.outputViz.refreshAspectRatio();
    });

    // 選択ボックスのドラッグ処理
    this.setupSourceDragHandlers();
    // リサイズハンドルの処理
    this.setupSourceResizeHandlers();
  }

  private setupMappingArea(): void {
    if (!this.croppedContainer || !this.croppedVideo) return;

    // 非 active mapping のプレビュー pool を cropped-container の親 (#mapping-area) に attach
    const stage = this.croppedContainer.parentElement;
    const doc = this.hostDoc;
    if (stage && doc) {
      this.inactivePreviews.attach(stage, doc, {
        getSourceVideo: () => this.sourceVideo,
        getActiveContainer: () => this.croppedContainer,
        onActivate: (id) => this.replaceState(withActiveSet(this.state, id)),
      });
    }

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

    // ディスプレイサイズを更新
    this.outputViz.refreshOutputViz();
  }

  /** ホスト要素のオーナードキュメント（要素生成・ファイル取得 UI に使う）。 */
  private get hostDoc(): Document | null {
    return this.scopeEl?.ownerDocument ?? null;
  }

  /** ホスト要素のオーナーウィンドウ（alert などに使う）。 */
  private get hostWin(): Window | null {
    return this.hostDoc?.defaultView ?? null;
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

      this.keyboardNudge.setSelection({ type: 'source' });
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
        this.keyboardNudge.setSelection({ type: 'source' });
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
      this.keyboardNudge.clearSelection();
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
        this.keyboardNudge.setSelection({ type: 'quad', corner });
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
    this.inactivePreviews.sync(this.state);
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
    this.inactivePreviews.sync(this.state);

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
        this.outputViz.refreshAspectRatio();
        this.updateQuadTransform();
      });
    });

    // タブを閉じる直前に host 購読を畳む
    win.addEventListener('pagehide', () => this.disposeHost());
  }

  /** ControlHost から push される「出力ウィンドウ＋ディスプレイ寸法／全画面状態」を反映。 */
  private handleOutputBoundsUpdate(b: OutputBoundsSnapshot): void {
    this.outputBounds = { ...b };
    this.outputViz.refreshOutputViz();
  }

  private handleVideoDimensionsUpdate(dimensions: VideoDimensions): void {
    this.videoActualDimensions = dimensions;
    this.updateVideoCrop();
    this.outputViz.refreshAspectRatio();
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
    this.keyboardNudge.clearSelection();
    this.updateSelectionBox();
    this.updateQuadTransform();
    this.updateToolValues();
    this.mappingsList.rerender();
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
    this.keyboardNudge.clearSelection();
    this.updateSelectionBox();
    this.updateQuadTransform();
    this.updateToolValues();
    this.mappingsList.rerender();
    this.broadcastStateMutation();
  }
}
