import { BaseWindow } from '../shared/BaseWindow';
import { CONTROL_PANEL_HTML } from './ControlWindow.template';
import { CONTROL_PANEL_CSS } from './ControlWindow.styles';
import { ColumnResizers } from './panels/ColumnResizers';
import { OutputVizPanel } from './panels/OutputVizPanel';
import { InactivePreviewPool } from './panels/InactivePreviewPool';
import { KeyboardNudge } from './panels/KeyboardNudge';
import { MappingsListPanel } from './panels/MappingsListPanel';
import { SourceCropPanel } from './panels/SourceCropPanel';
import { MappingAreaPanel } from './panels/MappingAreaPanel';
import { MappingsController } from './MappingsController';
import {
  withActiveSet,
  type MappingsState,
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
  private sourceCrop = new SourceCropPanel();
  private mappingArea = new MappingAreaPanel();
  // canonical state（および active alias）は MappingsController が所有する。
  // ローカル mutation 後の broadcast 経路（commit）だけ親側から差し込む。
  private ctrl = new MappingsController((state) => this.controlHost?.emitStateMutation(state));

  /**
   * id / class ベースの DOM 探索はすべてこの要素配下で行う（inline マウント先要素）。
   * main 側の id と衝突しないようにするための seam。null = 未初期化。
   */
  private get scopeEl(): HTMLElement | null {
    return this.controlHost?.host ?? null;
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
    // state が丸ごと差し替わった時の UI 一括再描画。disposeHost で外れる。
    this.hostUnsubs.push(this.ctrl.onChange(() => this.refreshAllFromState()));
    // 初期化時にアスペクト比を設定（出力ウィンドウの寸法は WindowController から後で push される）
    setTimeout(() => this.outputViz.refresh(), 100);
  }

  /**
   * state が外部 push (applyExternal) や programmatic replace で丸ごと変わった時の
   * UI 全体再描画。drag/nudge 中の in-place mutation では発火しない（panel が自前で
   * 必要な部分だけ refresh する）。
   */
  private refreshAllFromState(): void {
    this.keyboardNudge.clearSelection();
    this.sourceCrop.refresh();
    this.mappingArea.refreshTransform();
    this.updateToolValues();
    this.mappingsList.rerender();
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
      h.onStateChange((s: MappingsState) => this.ctrl.applyExternal(s)),
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
    this.columnResizers.destroy();
    this.outputViz.destroy();
    this.inactivePreviews.destroy();
    this.keyboardNudge.destroy();
    this.mappingsList.destroy();
    this.sourceCrop.destroy();
    this.mappingArea.destroy();
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

    // ソースビデオは inactive preview の bind と aspect 計算で参照する。
    // cropped-container / cropped-video / mapping-video は MappingAreaPanel が
    // 自前で querySelector するのでここでは取得しない。
    this.sourceVideo = scope.querySelector('#source-video') as HTMLVideoElement;

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

    // ソース選択ボックスのドラッグ／リサイズ／リセット／初期化
    if (this.hostDoc) {
      this.sourceCrop.attach(scope, this.hostDoc, this.ctrl, {
        getSourceVideo: () => this.sourceVideo,
        setKeyboardSourceSelection: () => this.keyboardNudge.setSelection({ type: 'source' }),
        onSourceChanged: () => {
          this.mappingArea.refreshVideoCrop();
          this.inactivePreviews.sync(this.ctrl.getState());
          this.updateToolValues();
        },
      });
    }

    // マッピング領域: quad ドラッグ / 4 隅ハンドル / リセット / resize observer / stream bind
    if (this.hostDoc && this.controlHost) {
      this.mappingArea.attach(scope, this.hostDoc, this.controlHost.window, this.ctrl, {
        setKeyboardQuadSelection: (corner) => this.keyboardNudge.setSelection({ type: 'quad', corner }),
        clearKeyboardSelection: () => this.keyboardNudge.clearSelection(),
        onQuadChanged: () => {
          this.inactivePreviews.sync(this.ctrl.getState());
          this.updateToolValues();
        },
        onCroppedVideoMetadata: (d) => { this.videoActualDimensions = d; },
      });
    }

    // 非 active mapping のプレビュー pool を mapping-area に attach
    const stage = this.mappingArea.getStage();
    if (stage && this.hostDoc) {
      this.inactivePreviews.attach(stage, this.hostDoc, {
        getSourceVideo: () => this.sourceVideo,
        getActiveContainer: () => this.mappingArea.getCroppedContainer(),
        onActivate: (id) => this.ctrl.replaceState(withActiveSet(this.ctrl.getState(), id)),
      });
    }

    // ツールボタンの設定
    this.setupToolButtons();

    // 矢印キーによる微調整
    if (this.hostDoc) {
      this.keyboardNudge.attach(scope, this.hostDoc, this.ctrl, {
        getQuadRefSize: () => this.quadStepRefSize(),
        getSourceRefSize: () => this.sourceStepRefSize(),
        getSelectionBox: () => this.sourceCrop.getSelectionBox(),
        onAfterMutate: (type) => {
          if (type === 'quad') this.mappingArea.refreshTransform();
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
      onWindowFrameReflow: () => this.mappingArea.refreshTransform(),
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

  private setupToolButtons(): void {
    const scope = this.scopeEl;
    if (!scope) return;

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

    const source = this.ctrl.getActiveSource();
    const quad = this.ctrl.getActiveQuad();

    // ソース値の更新
    const sourceX = scope.querySelector('#source-x-value');
    const sourceY = scope.querySelector('#source-y-value');
    const sourceW = scope.querySelector('#source-w-value');
    const sourceH = scope.querySelector('#source-h-value');

    if (sourceX) sourceX.textContent = source.x.toFixed(1);
    if (sourceY) sourceY.textContent = source.y.toFixed(1);
    if (sourceW) sourceW.textContent = source.width.toFixed(1);
    if (sourceH) sourceH.textContent = source.height.toFixed(1);

    // マッピング: 4隅の値を更新
    const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
    const tl = scope.querySelector('#mapping-tl-value');
    const tr = scope.querySelector('#mapping-tr-value');
    const bl = scope.querySelector('#mapping-bl-value');
    const br = scope.querySelector('#mapping-br-value');
    if (tl) tl.textContent = fmt(quad.topLeft);
    if (tr) tr.textContent = fmt(quad.topRight);
    if (bl) bl.textContent = fmt(quad.bottomLeft);
    if (br) br.textContent = fmt(quad.bottomRight);
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

  /**
   * ソース矩形を変更した直後に呼ぶまとめ更新ヘルパー。
   * ソース側の選択枠と、マッピング側のクロップ済み <video>（および非 active プレビュー）の
   * クロップ表示を同時に再計算する。
   *
   * ソース矩形のドラッグ／リサイズ／矢印キー nudge は同じ依存関係（active mapping の source rect）
   * を持つので、3 箇所がバラバラに呼んでいた updateSelectionBox + 補助呼び出しをここに集約する。
   */
  private updateAfterSourceChange(): void {
    this.sourceCrop.refresh();
    // #cropped-video は source rect を clip-path で切り取って見せているので、変更を即反映する
    // （抜けるとマッピング側プレビューが古い source 表示のままになる）。
    this.mappingArea.refreshVideoCrop();
    // 非 active mapping のプレビュー warp は source も含めた signature で memoize されているので、
    // source が変わったタイミングで再評価する。
    this.inactivePreviews.sync(this.ctrl.getState());
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
        this.mappingArea.refreshTransform();
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
    this.mappingArea.refreshVideoCrop();
    this.outputViz.refreshAspectRatio();
    // display-frameは物理ディスプレイのアスペクト比を維持するので更新しない
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

}
