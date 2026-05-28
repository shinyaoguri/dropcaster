import { BaseWindow } from '../shared/BaseWindow';
import { controlPanelHtml, applyControlTranslations } from './ControlWindow.template';
import { onLangChange, t } from '../../i18n/index.js';
import { CONTROL_PANEL_CSS } from './ControlWindow.styles';
import { ColumnResizers } from './panels/ColumnResizers';
import { OutputVizPanel } from './panels/OutputVizPanel';
import { InactivePreviewPool } from './panels/InactivePreviewPool';
import { KeyboardNudge } from './panels/KeyboardNudge';
import { LayoutPanel } from './panels/LayoutPanel';
import { MappingsListPanel } from './panels/MappingsListPanel';
import { OutputSettingsPanel } from './panels/OutputSettingsPanel';
import { SourceCropPanel } from './panels/SourceCropPanel';
import { MappingAreaPanel } from './panels/MappingAreaPanel';
import { MaskEditPanel } from './panels/MaskEditPanel';
import { MappingsController } from './MappingsController';
import {
  isMaskEntry,
  withActiveOutputSet,
  withActiveSet,
  type MappingsState,
} from '../../utils/mappingTransform';
import { RafThrottle } from '../../utils/rafThrottle';
import type {
  ControlHost,
  DevCursorEvent,
  OutputBoundsMap,
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
   * 開いている各出力ウィンドウ（と載っているディスプレイ）の寸法・全画面状態。
   * WindowController から push される。innerWidth/Height は quad の「出力1px」ステップにも使う。
   * キーは OutputDef.id。開いていない出力はエントリ無し。
   */
  private outputBounds: OutputBoundsMap = {};
  /** ウィンドウ resize 由来の再レイアウトを 1 フレームに 1 回へ間引く throttle。setupMessageListener で初期化。 */
  private resizeThrottle: RafThrottle | null = null;
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
  private maskEdit = new MaskEditPanel();
  private layoutPanel = new LayoutPanel();
  private outputSettings = new OutputSettingsPanel();
  /** 現在 active なタブ（'mapping' / 'layout'）。タブ切替時に LayoutPanel.refresh() を駆動。 */
  private activeTab: 'mapping' | 'layout' = 'mapping';
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

  /** langChange 購読解除関数。disposeHost で剥がす。 */
  private langUnsub: (() => void) | null = null;

  constructor() {
    super('control_window', t('window.controlPanel'));
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
    this.resizeThrottle?.cancel();
    this.resizeThrottle = null;
    outer.innerHTML = this.getContent();
    this.injectStylesInto(outer.ownerDocument);
    const shell = outer.querySelector('.dc-control-shell') as HTMLElement | null;
    if (!shell) return;
    this.mount(hostBuilder(shell));
  }

  /** host 確定後のセットアップを行う（mountInline から呼ばれる）。 */
  private mount(host: ControlHost): void {
    // 既存 host があれば確実に剥がす（new pane への切替時に listener が残らないように）
    this.disposeHost();
    this.controlHost = host;
    // 親 (WindowController) が保持している canonical state を即座に取り込む。
    // これより前に setupControls してしまうと、各 panel は MappingsController が初期化時に
    // 持っている defaultMappingsState() を読む — その後 source-video loadedmetadata で
    // SourceCropPanel.initializeAtFull() が ctrl.commit() を投げると、parent には
    // 「local default の outputs」が届き、closeOrphanedOutputWindows で直前に開いた出力
    // ウィンドウが orphan 扱いになって閉じられてしまう。state を先に同期して回避する。
    this.ctrl.applyExternal(host.getState());
    this.setupHostSubscriptions();
    this.setupControls();
    this.setupMessageListener();
    // state が丸ごと差し替わった時の UI 一括再描画。disposeHost で外れる。
    this.hostUnsubs.push(this.ctrl.onChange(() => this.refreshAllFromState()));
    // 言語切替時に静的ラベル（data-i18n-* 属性付き）を再翻訳。
    // 動的に panel が書き換えている文字列（MappingsListPanel / OutputVizPanel 等）は
    // 各 panel 側の rerender 経路でも翻訳が反映される。
    this.langUnsub?.();
    this.langUnsub = onLangChange(() => {
      if (this.scopeEl) applyControlTranslations(this.scopeEl);
      // panel 側にも refresh を促す（dynamic な textContent 更新を巻き直す）
      this.mappingsList.rerender();
      this.outputViz.refresh();
    });
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
    // state.outputs / activeOutputId 等の変化に追従するためフレーム DOM を組み直す
    // （rebuildFromState は DOM 構造のみで rect 非依存。renderEachFrame は rect を使うので
    //  mapping タブ非表示時は 0 寸法で書き込まれる → タブ切替時に setupTabs が再描画する）
    this.outputViz.refresh();
    // active mapping の outputId が変わっていれば cropped-container を移動
    this.mappingArea.refreshActiveMount();
    this.mappingArea.refreshTransform();
    // active mask が変わったら頂点ハンドルを作り直す
    this.maskEdit.refresh();
    // ペン描画中フラグを shell レベルに反映（CSS で他項目をクリック不可にロックするのに使う）
    this.updateDraftingShellFlag();
    // 非 active preview も output 振り分けし直す
    this.inactivePreviews.sync(this.ctrl.getState());
    this.updateToolValues();
    this.mappingsList.rerender();
    // 出力レイアウトタブが表示中なら追従更新（出力をドラッグしてサイズが変わった時など）
    if (this.activeTab === 'layout') this.layoutPanel.refresh();
  }

  /**
   * shell に `.mask-drafting` クラスを付けて、CSS で「ペン描画中は他項目に触れないように
   * ロック」する。preview / output frame / list 行に対する pointer-events 制御がここに引っかかる。
   */
  private updateDraftingShellFlag(): void {
    const scope = this.scopeEl;
    if (!scope) return;
    const state = this.ctrl.getState();
    const active = state.mappings.find(m => m.id === state.activeId);
    const drafting = !!active && isMaskEntry(active) && !!active.drafting;
    scope.classList.toggle('mask-drafting', drafting);
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
      h.onOutputBoundsChange((b: OutputBoundsMap) => this.handleOutputBoundsUpdate(b)),
      h.onTestPatternChange((k: TestPatternKindOrOff) => this.updateTestPatternUI(k)),
      h.onWebglContextChange((status: WebglContextStatus) => this.updateWebglContextBanner(status)),
      h.onDevModeChange((enabled: boolean) => this.updateDevModeUI(enabled)),
      h.onDevCursorChange((e: DevCursorEvent) => this.outputViz.updateDevCursor(
        e.canvasX, e.canvasY, e.visible,
      )),
    );
  }

  /** 購読を全部外して host 自体も dispose する。inline 解除時に呼ぶ。 */
  private disposeHost(): void {
    this.hostUnsubs.forEach(u => { try { u(); } catch { /* ignore */ } });
    this.hostUnsubs = [];
    this.langUnsub?.();
    this.langUnsub = null;
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
    this.maskEdit.destroy();
    this.layoutPanel.destroy();
    this.outputSettings.destroy();
  }

  /** inline 経路で mount された ControlWindow を外側から片付けるための public API。 */
  destroy(): void {
    this.disposeHost();
  }

  protected getContent(): string {
    return controlPanelHtml();
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
        this.layoutPanel.rebindStreams();
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

    // 出力ごとのフレーム DOM を組み立てるパネル（mapping-area は OutputVizPanel が
    // 各出力に 1 個ずつ生やすので、MappingAreaPanel／InactivePreviewPool より先に attach する）
    this.outputViz.attach(scope, {
      getOutputBounds: () => this.outputBounds,
      getVideoDimensions: () => this.videoActualDimensions,
      getSourceVideo: () => this.sourceVideo,
      setActiveOutput: (outputId) => {
        const cur = this.ctrl.getState();
        if (cur.activeOutputId === outputId) return;
        this.ctrl.replaceState(withActiveOutputSet(cur, outputId));
      },
      onWindowFrameReflow: () => this.mappingArea.refreshTransform(),
      // dev mode の時だけ、プレビュー上のマウス位置（canvas-space）を host 経由で
      // 全出力ウィンドウへ放送する（双方向同期）
      onPreviewCursor: (canvasX, canvasY, visible) => {
        if (!this.controlHost?.getDevMode()) return;
        this.controlHost.requestDevCursor(canvasX, canvasY, visible);
      },
    }, this.ctrl);

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
        getCanvasMappings: () => this.outputViz.getCanvasMappings(),
        getCanvasHandles: () => this.outputViz.getCanvasHandles(),
      });
    }

    // active mask の頂点編集ハンドル群（mapping 時は何も出さない）
    if (this.hostDoc) {
      this.maskEdit.attach(this.hostDoc, this.ctrl, {
        getCanvasHandles: () => this.outputViz.getCanvasHandles(),
        onMaskChanged: () => {
          this.inactivePreviews.sync(this.ctrl.getState());
        },
      });
    }

    // 非 active mapping のプレビュー pool — 共有 canvas-mappings レイヤに mount
    if (this.hostDoc) {
      this.inactivePreviews.attach(this.hostDoc, {
        getSourceVideo: () => this.sourceVideo,
        getActiveContainer: () => this.mappingArea.getCroppedContainer(),
        getMappingsLayer: () => this.outputViz.getCanvasMappings(),
        onActivate: (id) => this.ctrl.replaceState(withActiveSet(this.ctrl.getState(), id)),
      });
      // 初期同期（state 復元直後の inactive preview を即配置）
      this.inactivePreviews.sync(this.ctrl.getState());
    }

    // ツールボタンの設定
    this.setupToolButtons();

    // 矢印キーによる微調整
    if (this.hostDoc) {
      this.keyboardNudge.attach(scope, this.hostDoc, this.ctrl, {
        getQuadStepPerScreenPx: () => this.quadStepPerScreenPx(),
        getSourceRefSize: () => this.sourceStepRefSize(),
        getSelectionBox: () => this.sourceCrop.getSelectionBox(),
        onAfterMutate: (type) => {
          if (type === 'quad') this.mappingArea.refreshTransform();
          else this.updateAfterSourceChange();
          this.updateToolValues();
        },
      });
    }

    // 出力設定（X/Y/幅/高さ）入力欄 — outputs[*] のアクティブな 1 件の position/size を編集
    this.outputSettings.attach(scope, this.ctrl);

    // 出力レイアウト編集タブ（仮想キャンバス上で各 output を 2D ドラッグ・リサイズで配置 + マッピング preview）
    if (this.hostDoc && this.controlHost) {
      this.layoutPanel.attach(scope, this.hostDoc, this.controlHost.window, this.ctrl, {
        getSourceVideo: () => this.sourceVideo,
        // drag/resize 中はツール列の「出力設定」入力欄を live 更新する。state mutation は in-place
        // なので fireChange は走らない（tool 列の rerender は起きない）。ここで input だけ書き換える。
        onOutputLayoutMutated: () => this.outputSettings.refresh(),
      });
    }

    // タブ切替（マッピング ↔ 出力レイアウト）
    this.setupTabs();

    // カラム間のドラッグリサイザ（前回保存幅の復元含む）
    if (this.scopeEl && this.hostDoc) {
      this.columnResizers.attach(this.scopeEl, this.hostDoc);
    }

    // マッピング一覧（出力ごとにグループ化）と add / export / import / 出力管理 ボタン
    if (this.hostDoc && this.controlHost) {
      const host = this.controlHost;
      this.mappingsList.attach(scope, this.hostDoc, this.ctrl, {
        getHostWin: () => this.hostWin,
        openOutputWindow: (outputId) => host.openOutputWindow(outputId),
        closeOutputWindow: (outputId) => host.closeOutputWindow(outputId),
        isOutputWindowOpen: (outputId) => this.outputBounds[outputId] !== undefined,
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

    // 開発モードトグル — 押すたびに on/off を反転して host に投げる
    const devToggle = scope.querySelector('#dev-mode-toggle') as HTMLButtonElement | null;
    devToggle?.addEventListener('click', () => {
      const next = !(this.controlHost?.getDevMode() ?? false);
      // optimistic 表示更新（host から onDevModeChange で再度 push されて確定）
      this.updateDevModeUI(next);
      this.controlHost?.requestDevMode(next);
    });
    // 初期表示を host の現在値に合わせる
    if (this.controlHost) this.updateDevModeUI(this.controlHost.getDevMode());

    // ディスプレイサイズを更新
    this.outputViz.refreshOutputViz();
  }

  /**
   * タブ切替 UI のハンドラ。クリックで `.dc-tab.is-active` と `.dc-tab-pane.is-active` を
   * 付け替え、表示されたタブ側を rAF 後に full refresh する。
   *
   * rAF を挟む理由: display:none → flex に変わった直後は getBoundingClientRect() が
   * 0×0 を返すことがあるので、次フレームでブラウザがレイアウトを確定したあとに refresh する。
   * 非表示の間に発生した state 変更（隠れたタブの再描画は 0 サイズで実行されている可能性）も
   * このタイミングで正しい寸法で再計算される。
   */
  private setupTabs(): void {
    const scope = this.scopeEl;
    if (!scope) return;
    const tabs = scope.querySelectorAll<HTMLButtonElement>('.dc-tab');
    const panes = scope.querySelectorAll<HTMLElement>('.dc-tab-pane');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.tab as 'mapping' | 'layout' | undefined;
        if (!name || name === this.activeTab) return;
        this.activeTab = name;
        tabs.forEach(b => {
          const active = b.dataset.tab === name;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panes.forEach(p => {
          p.classList.toggle('is-active', p.dataset.tabPane === name);
        });
        const win = this.controlHost?.window;
        const fullRefresh = () => {
          if (name === 'layout') {
            this.layoutPanel.refresh();
          } else {
            this.outputViz.refresh();
            this.mappingArea.refreshActiveMount();
            this.mappingArea.refreshTransform();
            this.inactivePreviews.sync(this.ctrl.getState());
          }
        };
        if (win) win.requestAnimationFrame(fullRefresh);
        else fullRefresh();
      });
    });
  }

  /** 開発モードトグルの ON/OFF 表示を切り替える（state は host が持っている）。 */
  private updateDevModeUI(enabled: boolean): void {
    const scope = this.scopeEl;
    if (!scope) return;
    // shell に dc-dev-mode クラスを付けて、各出力プレビュー内の crosshair SVG の表示／非表示を CSS で制御
    scope.classList.toggle('dc-dev-mode', enabled);
    if (!enabled) this.outputViz.hideAllDevCursors();
    const btn = scope.querySelector('#dev-mode-toggle') as HTMLButtonElement | null;
    if (!btn) return;
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const label = btn.querySelector('.dev-mode-label');
    if (label) {
      const key = enabled ? 'control.devMode.on' : 'control.devMode.off';
      label.setAttribute('data-i18n', key);
      label.textContent = t(key);
    }
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

    // 出力設定: アクティブ出力の position/size を入力欄に反映
    this.outputSettings.refresh();
  }

  /**
   * 矢印キーの「出力 1 px」ステップを仮想キャンバス px に換算する係数 {x, y}。
   * out.size.width / out.bounds.innerWidth が、出力ウィンドウ上 1 screen-px が
   * 仮想キャンバスの何 canvas-px に相当するかを与える。
   * 出力未起動時は 1（= 1 canvas-px ステップ）にフォールバック。
   */
  private quadStepPerScreenPx(): { x: number; y: number } {
    // 参照出力: activeOutputId があればそれ、無ければ outputs[0]。
    // mapping は出力に紐付かないので、ユーザがどの出力を編集しているかは activeOutputId で表す。
    const state = this.ctrl.getState();
    const out = state.outputs.find(o => o.id === state.activeOutputId) ?? state.outputs[0];
    if (!out) return { x: 1, y: 1 };
    const b = this.outputBounds[out.id];
    const screenW = b && b.innerWidth > 16 ? b.innerWidth : out.size.width;
    const screenH = b && b.innerHeight > 16 ? b.innerHeight : out.size.height;
    return {
      x: out.size.width > 0 && screenW > 0 ? out.size.width / screenW : 1,
      y: out.size.height > 0 && screenH > 0 ? out.size.height / screenH : 1,
    };
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

    // ウィンドウリサイズ時に各タブを再描画（1 フレーム 1 回に間引く）。
    // outputViz.refresh() / layoutPanel.refresh() は stage rect を再計測してフィット scale を
    // 計算し直すので、サイズ変更で見えなくなることを防ぐ。
    this.resizeThrottle = new RafThrottle(win, () => {
      if (this.activeTab === 'layout') {
        this.layoutPanel.refresh();
      } else {
        this.outputViz.refresh();
        this.mappingArea.refreshTransform();
      }
    });
    win.addEventListener('resize', () => this.resizeThrottle?.schedule());

    // タブを閉じる直前に host 購読を畳む
    win.addEventListener('pagehide', () => this.disposeHost());
  }

  /** ControlHost から push される「出力 id → 寸法／全画面状態」を反映。 */
  private handleOutputBoundsUpdate(b: OutputBoundsMap): void {
    this.outputBounds = { ...b };
    this.outputViz.refreshOutputViz();
    // 開閉に応じて「未起動」表示も切り替わるので mappings list を再描画
    this.mappingsList.rerender();
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
