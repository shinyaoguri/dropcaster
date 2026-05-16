import { WindowManager } from '../managers/WindowManager';
import { OutputWindow } from '../windows/output/OutputWindow';
import { TestPatternSource, type TestPatternKind } from '../runtime/TestPatternSource';
import {
  defaultMappingsState,
  parseMappingsState,
  type MappingsState,
  type OutputDef,
} from '../utils/mappingTransform';
import { ScreenWakeLock } from '../utils/wakeLock';
import { Emitter } from '../utils/emitter';
import type {
  DevCursorEvent,
  OutputBoundsMap,
  OutputBoundsSnapshot,
  TestPatternKindOrOff,
  VideoDimensions,
  WebglContextStatus,
} from '../windows/control/ControlHost';

// v2: 仮想キャンバス座標系（quad は px、output は position/size）。v1 とは非互換。
const STATE_STORAGE_KEY = 'dropcaster.mappings.v2';
// drag が止まってから何 ms 後に localStorage へ書き出すか。drag 中は毎フレーム reschedule して
// 書込みを発火させない（最後の mutation から STATE_SAVE_QUIESCE_MS 経過してから 1 回だけ flush）。
const STATE_SAVE_QUIESCE_MS = 600;

// Window Management API（Chrome/Edge 系のみ）の最小型定義
interface ScreenDetailed {
  left: number;
  top: number;
  width: number;
  height: number;
  availLeft?: number;
  availTop?: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
  isInternal?: boolean;
  label?: string;
}
interface ScreenDetails extends EventTarget {
  screens: ScreenDetailed[];
  currentScreen?: ScreenDetailed;
}

export class WindowController {
  private windowManager: WindowManager;
  /** 出力 id → 担当 OutputWindow。openOutputWindowFor で生やし、close で消す。 */
  private outputWindows = new Map<string, OutputWindow>();
  private activeStreams: MediaStream[] = [];
  private windowMonitoringInterval: number | null = null;
  private saveTimer: number | null = null;
  /** 直近に通知した出力寸法群（JSON）。同じなら再 emit しない。 */
  private lastOutputBoundsJson: string | null = null;
  /**
   * Window Management API のスナップショット。null = まだ問い合わせていない or 未対応・権限拒否。
   * 1 度問い合わせれば screenschange で自動更新するので、再 fetch しない。
   */
  private screenSnapshot: ScreenDetailed[] | null = null;
  private screenDetailsPromise: Promise<void> | null = null;
  private canvasResizeObserver: ResizeObserver | null = null;
  private canvasMutationObserver: MutationObserver | null = null;
  /** いまマッピングのソースにしているスケッチ iframe（差し替え可能）。 */
  private currentSourceIframe: HTMLIFrameElement | null = null;
  /** テストパターン用のソース。校正中だけ生成し、'off' に戻すと破棄せず stop する（再利用）。 */
  private testPattern: TestPatternSource | null = null;
  private testPatternKind: TestPatternKind | 'off' = 'off';
  /** メインウィンドウ側の Screen Wake Lock（プロジェクション中はディスプレイをスリープさせない）。 */
  private wakeLock: ScreenWakeLock = new ScreenWakeLock(window);

  /**
   * inline マウントされた ControlPanel（InlineControlHost）が購読する in-process イベント。
   * 値は常に最新を保持し、`events.X.get()` で snapshot として取れる。
   */
  readonly events = {
    state: new Emitter<MappingsState>(defaultMappingsState()),
    testPattern: new Emitter<TestPatternKindOrOff>('off'),
    outputBounds: new Emitter<OutputBoundsMap>({}),
    videoDimensions: new Emitter<VideoDimensions>({ width: 1, height: 1 }),
    webglContext: new Emitter<WebglContextStatus>('ok'),
    // 開発モード: 出力ウィンドウに mapping の枠線とマウス追従クロスヘアを重ねる校正用 UI。
    // セッション限りのフラグで永続化しない（localStorage の MappingsState とは独立）。
    devMode: new Emitter<boolean>(false),
    // dev mode のカーソル位置（仮想キャンバス座標）。出力ウィンドウからの mousemove、
    // 操作ウィンドウのプレビューからの mousemove のいずれも canvas px に変換してここで集約し、
    // 全出力ウィンドウ + プレビューに同じ canvas-space cursor を放送する。
    devCursor: new Emitter<DevCursorEvent>({ visible: false, canvasX: 0, canvasY: 0 }),
  };
  private messageHandler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    // 出力ウィンドウからの `output-needs-stream` のみハンドル（outputId 指定があれば対象のみ bind）。
    if (event.data?.type === 'output-needs-stream') {
      const targetId = typeof event.data.outputId === 'string' ? event.data.outputId : undefined;
      this.bindStreamToOutputWindows(targetId);
    } else if (event.data?.type === 'dev-cursor') {
      // 出力ウィンドウ→親 のカーソル位置中継（canvas-space）。inline panel が
      // onDevCursorChange で受け、他の出力ウィンドウへも放送する。
      const d = event.data as Partial<DevCursorEvent> & { type: string };
      const visible = !!d.visible;
      const canvasX = typeof d.canvasX === 'number' ? d.canvasX : 0;
      const canvasY = typeof d.canvasY === 'number' ? d.canvasY : 0;
      this.events.devCursor.set({ visible, canvasX, canvasY });
      // 全出力ウィンドウへ放送（origin はローカル描画済みなので skip）
      this.broadcastDevCursorToOutputs(visible, canvasX, canvasY, event.source);
    }
  };

  // 正規 state（複数 mapping ＋ activeId）。inline panel と SketchPageView はこれの
  // mirror をレンダリングするだけで、直接書き込まない（必ず applyStateFromInline 経由）。
  private state: MappingsState = defaultMappingsState();


  private videoActualDimensions = {
    width: 1,
    height: 1
  };

  constructor() {
    this.windowManager = new WindowManager();

    // 前回のマッピング設定を localStorage から復元（あれば）
    const restored = this.loadFromStorage();
    if (restored) this.state = restored;
    // Emitter の初期値も復元後の state に合わせる
    this.events.state.set(this.state);

    this.setupWindowCommunication();
  }

  private loadFromStorage(): MappingsState | null {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (!raw) return null;
      return parseMappingsState(JSON.parse(raw));
    } catch (error) {
      console.warn('WindowController: localStorage 読込失敗', error);
      return null;
    }
  }

  /**
   * localStorage への保存はトレーリング debounce（最後の mutation から QUIESCE_MS 経過したら
   * 1 回だけ flush する）。drag 中は毎フレーム reschedule されるので、drag が止まるまで save が
   * 走らない。pagehide / destroy で確実にフラッシュする。
   *
   * **重要**: 以前は `if (saveTimer !== null) return` の "leading-skip" 実装で、結果として
   * drag 中も QUIESCE_MS 周期で同期 IO (JSON.stringify + localStorage.setItem) が走り、
   * メインスレッドジャンクの原因になっていた。trailing debounce に修正済み。
   */
  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; this.flushSave(); }, STATE_SAVE_QUIESCE_MS);
  }

  private flushSave(): void {
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('WindowController: localStorage 書込失敗', error);
    }
  }

  /**
   * 互換 API: state.outputs[0] のポップアウトを開く。state が複数出力を持っていても
   * 1 つ目だけ自動で開く（後続は ControlWindow の UI で個別に開く）。
   */
  openOutputWindow(): Window | null {
    const first = this.state.outputs[0];
    if (!first) return null;
    return this.openOutputWindowFor(first.id);
  }

  /**
   * 指定 outputId のポップアウトを開く。既に開いていれば focus する。
   * outputId が state.outputs に無ければ no-op。
   */
  openOutputWindowFor(outputId: string): Window | null {
    const outputDef = this.state.outputs.find(o => o.id === outputId);
    if (!outputDef) return null;

    // 既に開いていれば focus のみ
    const existing = this.outputWindows.get(outputId);
    if (existing) {
      const w = existing.getWindow();
      if (w && !w.closed) {
        w.focus();
        return w;
      }
      this.outputWindows.delete(outputId);
    }

    // 既存出力ウィンドウの右隣に少しずらして配置（ユーザがすぐ動かしやすいよう）
    const offset = this.outputWindows.size * 40;
    const outputWin = this.windowManager.openWindow({
      name: `output_window_${outputId}`,
      title: outputDef.name ? `出力: ${outputDef.name}` : 'プロジェクション出力',
      width: 960,
      height: 600,
      left: Math.max(80, window.screenX + 120 + offset),
      top: Math.max(80, window.screenY + 120 + offset),
      features: ['scrollbars=no', 'resizable=yes'],
    });
    if (!outputWin) return null;

    const ow = new OutputWindow(outputId);
    ow.setParentWindow(window);
    ow.setWindow(outputWin);
    this.outputWindows.set(outputId, ow);

    // ウィンドウ閉じ通知 — Map からも除く
    outputWin.addEventListener('beforeunload', () => {
      this.outputWindows.delete(outputId);
      this.notifyOutputBounds();
    });
    outputWin.addEventListener('resize', () => this.notifyOutputBounds());
    outputWin.document.addEventListener('fullscreenchange', () => {
      this.notifyOutputBounds();
      window.setTimeout(() => this.notifyOutputBounds(), 350);
    });

    void this.placeOnExternalScreen(outputWin, outputDef);

    setTimeout(() => {
      this.broadcastStateToOutput();
      this.bindStreamToOutputWindows(outputId);
      this.notifyOutputBounds();
      this.broadcastDevModeToOutput(outputId);
    }, 500);
    return outputWin;
  }

  /** 指定出力のポップアウトを閉じる。 */
  closeOutputWindowFor(outputId: string): void {
    const ow = this.outputWindows.get(outputId);
    if (ow) ow.close();
    this.windowManager.closeWindow(`output_window_${outputId}`);
    this.outputWindows.delete(outputId);
    this.notifyOutputBounds();
  }

  /**
   * Window Management API が使える環境で、出力ウィンドウを既知のスクリーンへ移動・最大化する。
   *
   *  - OutputDef.screen が指定されていればそれを優先（位置で screen を引き当て）。
   *  - 未指定なら、いま開いている他出力に「使われていない」非内蔵スクリーンを順に割り当て。
   *  - 全部使い切ったら最後の非内蔵スクリーンへ寄せる（重なる）。
   */
  private async placeOnExternalScreen(win: Window, outputDef: OutputDef): Promise<void> {
    try {
      await this.ensureScreenDetails();
      const screens = this.screenSnapshot;
      if (!screens || screens.length === 0) return;

      const claimed = new Set<ScreenDetailed>();
      // 他出力で既に使っているスクリーンを「使用済み」にする
      for (const [otherId, otherOw] of this.outputWindows) {
        if (otherId === outputDef.id) continue;
        const ow = otherOw.getWindow();
        if (!ow || ow.closed) continue;
        const hit = this.findScreenForWindow(ow);
        if (hit) claimed.add(hit);
      }

      let target: ScreenDetailed | undefined;
      const ds = outputDef.screen;
      if (ds) {
        target = screens.find(s => s.left === ds.left && s.top === ds.top);
      }
      if (!target) {
        const external = screens.filter(s => s.isInternal === false);
        target = external.find(s => !claimed.has(s))
          ?? screens.filter(s => s.isPrimary === false).find(s => !claimed.has(s))
          ?? external[external.length - 1]
          ?? screens.find(s => s.isPrimary === false);
      }
      if (!target || win.closed) return;
      win.moveTo(target.availLeft ?? target.left, target.availTop ?? target.top);
      win.resizeTo(target.availWidth, target.availHeight);
      this.notifyOutputBounds();
    } catch {
      /* 権限拒否・未対応 — 通常位置のまま（ユーザがプロジェクタへドラッグ） */
    }
  }

  /**
   * Window Management API のスクリーン一覧を 1 度だけ問い合わせてキャッシュする。
   * 'screenschange' で外部モニタが付け外しされたら破棄して再取得する。
   * 未対応 / 権限拒否なら `screenSnapshot` は null のまま — 呼び出し側は fallback する想定。
   */
  private async ensureScreenDetails(): Promise<void> {
    if (this.screenSnapshot) return;
    if (this.screenDetailsPromise) return this.screenDetailsPromise;
    this.screenDetailsPromise = (async () => {
      try {
        const w = window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> };
        if (typeof w.getScreenDetails !== 'function') return;
        const details = await w.getScreenDetails();
        this.screenSnapshot = [...(details.screens ?? [])];
        details.addEventListener('screenschange', () => {
          this.screenSnapshot = [...(details.screens ?? [])];
          this.notifyOutputBounds(); // ラベル変化を inline panel に反映
        });
      } catch {
        this.screenSnapshot = null;
      } finally {
        this.screenDetailsPromise = null;
      }
    })();
    return this.screenDetailsPromise;
  }

  /**
   * 指定 popup の現在位置から、それが載っているスクリーン定義を引き当てる。
   * Window Management API 未対応 / 権限拒否ならキャッシュが空なので null。
   */
  private findScreenForWindow(win: Window): ScreenDetailed | null {
    const screens = this.screenSnapshot;
    if (!screens || screens.length === 0) return null;
    if (win.closed) return null;
    try {
      const x = win.screenX, y = win.screenY;
      // 完全に包含するものを優先、無ければ中心点で判定（モニタ境界をまたぐとき用）
      const contains = screens.find(
        s => x >= s.left && x < s.left + s.width &&
             y >= s.top  && y < s.top  + s.height,
      );
      if (contains) return contains;
      const cx = x + (win.outerWidth || win.innerWidth) / 2;
      const cy = y + (win.outerHeight || win.innerHeight) / 2;
      return screens.find(
        s => cx >= s.left && cx < s.left + s.width &&
             cy >= s.top  && cy < s.top  + s.height,
      ) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 開いている出力ウィンドウの <video> に現在の stream を bind する。
   * targetOutputId が指定されればその出力のみ、未指定なら全出力。
   */
  private bindStreamToOutputWindows(targetOutputId?: string): void {
    const stream = this.activeStreams[0];
    if (!stream) return;
    for (const [outputId, ow] of this.outputWindows) {
      if (targetOutputId && outputId !== targetOutputId) continue;
      const win = ow.getWindow();
      if (!win || win.closed) continue;
      try {
        win.document.querySelectorAll('video').forEach((el) => {
          const video = el as HTMLVideoElement;
          if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play().catch(() => { /* ignore */ });
          }
        });
      } catch (error) {
        console.error('WindowController: 出力ウィンドウへの stream 設定エラー:', error);
      }
    }
  }

  closeAllWindows(): void {
    this.stopCanvasStreaming();
    this.windowManager.closeAllWindows();
    this.outputWindows.clear();
    this.notifyOutputBounds();
  }

  private flushSaveHandler = () => this.flushSave();

  private setupWindowCommunication(): void {
    window.addEventListener('message', this.messageHandler);
    // タブを閉じる/離脱する直前にデバウンス中の保存を確定する
    window.addEventListener('pagehide', this.flushSaveHandler);
  }

  /**
   * 正規 state の唯一の更新ポイント。state を差し替えてから:
   *  - SketchPageView へ overlay 更新イベントを発火
   *  - 出力ウィンドウへは常に broadcast
   *  - inline 版 control へは `broadcastToControl: false` でなければ events.state を fire
   *
   * inline 自身が変更の起点なら echo back しない（自己ループ防止）。
   */
  private applyState(
    next: MappingsState,
    options: { broadcastToControl?: boolean } = {}
  ): void {
    this.state = next;
    this.scheduleSave();
    this.dispatchOverlayUpdate();
    // 出力が削除されていたら対応するポップアウトを閉じる（残り続けると孤立ウィンドウになる）
    this.closeOrphanedOutputWindows();
    this.broadcastStateToOutput();
    if (options.broadcastToControl !== false) {
      this.events.state.set(next);
    }
  }

  /** state.outputs に存在しなくなった outputId の出力ウィンドウを閉じる。 */
  private closeOrphanedOutputWindows(): void {
    const valid = new Set(this.state.outputs.map(o => o.id));
    for (const outputId of [...this.outputWindows.keys()]) {
      if (!valid.has(outputId)) this.closeOutputWindowFor(outputId);
    }
  }

  /** inline ペインの ControlPanel から「UI で state を変えた」と通知される入口。 */
  applyStateFromInline(next: MappingsState): void {
    this.applyState(next, { broadcastToControl: false });
  }

  private broadcastStateToOutput(): void {
    for (const ow of this.outputWindows.values()) {
      const win = ow.getWindow();
      if (!win || win.closed) continue;
      win.postMessage({
        type: 'state-update',
        data: this.state,
      }, window.location.origin);
    }
  }

  /** 開発モード on/off 切替。inline panel と全出力ウィンドウへ放送する。 */
  setDevMode(enabled: boolean): void {
    if (this.events.devMode.get() === enabled) return;
    this.events.devMode.set(enabled);
    this.broadcastDevModeToOutput();
  }

  /** targetOutputId 未指定なら全出力へ、指定なら対象だけへ dev-mode-update を送る。 */
  private broadcastDevModeToOutput(targetOutputId?: string): void {
    const enabled = this.events.devMode.get();
    for (const [outputId, ow] of this.outputWindows) {
      if (targetOutputId && outputId !== targetOutputId) continue;
      const win = ow.getWindow();
      if (!win || win.closed) continue;
      win.postMessage({ type: 'dev-mode-update', enabled }, window.location.origin);
    }
  }

  /**
   * 操作ウィンドウのマッピングプレビューでマウスが動いた時に呼ばれる、preview→output 方向の中継。
   * 全出力ウィンドウへ dev-cursor-set を送ってクロスヘアを描かせ、同時に inline panel 側の
   * Emitter にも同じイベントを流して preview のクロスヘアも更新する（双方向同期）。
   * 全出力に放送するので、跨ぎ位置でも複数出力に同じ canvas 位置のクロスヘアが出る。
   */
  setDevCursorFromPreview(canvasX: number, canvasY: number, visible: boolean): void {
    if (!this.events.devMode.get()) return;
    // inline panel 側の preview に反映
    this.events.devCursor.set({ visible, canvasX, canvasY });
    // 全出力ウィンドウへ放送
    this.broadcastDevCursorToOutputs(visible, canvasX, canvasY, null);
  }

  /**
   * 全出力ウィンドウへ canvas-space cursor を送る。`exceptSource` に Window を渡すと
   * その送信元（自前で既にローカル描画済み）はスキップする。
   */
  private broadcastDevCursorToOutputs(
    visible: boolean,
    canvasX: number,
    canvasY: number,
    exceptSource: MessageEventSource | null,
  ): void {
    for (const ow of this.outputWindows.values()) {
      const win = ow.getWindow();
      if (!win || win.closed) continue;
      if (exceptSource && win === exceptSource) continue;
      try {
        win.postMessage(
          { type: 'dev-cursor-set', visible, canvasX, canvasY },
          window.location.origin,
        );
      } catch {
        /* ignore */
      }
    }
  }

  private dispatchOverlayUpdate(): void {
    const event = new CustomEvent('mapping-overlay-update', {
      detail: {
        mappings: this.state.mappings,
        activeId: this.state.activeId,
        videoDimensions: this.videoActualDimensions,
      }
    });
    window.dispatchEvent(event);
  }

  async startCanvasStreaming(iframeElement: HTMLIFrameElement): Promise<void> {
    this.currentSourceIframe = iframeElement;
    this.stopCanvasCapture(); // 既存のキャプチャがあれば一旦止める（ウィンドウは閉じない）
    if (!this.captureFromSource()) return;
    this.startWindowMonitoring();
    // プロジェクション中はメインウィンドウ側のディスプレイをスリープさせない。
    // 出力ウィンドウ側は OutputWindow が自分で wake lock を取る。
    void this.wakeLock.acquire();
    this.setProjectionMode(true);
  }

  /**
   * 配信中のマッピングソースを別のスケッチ iframe に差し替える（ポップアウトウィンドウは閉じない）。
   * スライドショーでスライドが切り替わったときなどに呼ぶ。新しい iframe の <canvas> から
   * captureStream し直し、各所（in-page オーバーレイ・コントロール・ポップアウト）へ再 broadcast する。
   */
  setSource(iframeElement: HTMLIFrameElement): void {
    if (iframeElement === this.currentSourceIframe && this.activeStreams.length > 0) return;
    this.currentSourceIframe = iframeElement;
    this.stopCanvasCapture();
    this.captureFromSource();
  }

  /** currentSourceIframe の <canvas> から captureStream し、video dimensions・stream を各所へ broadcast する。成功なら true。 */
  private captureFromSource(): boolean {
    const iframe = this.currentSourceIframe;
    if (!iframe) return false;
    const canvas = this.getCanvasFromIframe(iframe); // resize 監視の (再)アタッチも兼ねる
    if (!canvas) return false;

    try {
      // fps 指定なし = canvas の描画レートに追従（最大滑らかさ。静的スケッチでは変化時のみキャプチャ）
      const stream = canvas.captureStream();
      if (!stream) {
        console.error('WindowController: MediaStreamの取得に失敗しました');
        return false;
      }
      this.trackStream(stream);
      this.attachTrackSurvivalMonitor(stream);

      this.videoActualDimensions = {
        width: canvas.width || 1920,
        height: canvas.height || 1080,
      };
      this.notifyVideoDimensions();
      this.broadcastStream(stream);
      return true;
    } catch (error) {
      console.error('WindowController: Canvas streaming開始エラー:', error);
      return false;
    }
  }

  /**
   * 元 <canvas> が差し替わったり、解放されたりすると captureStream のトラックは
   * 'ended' に落ちて、出力ウィンドウの <video> はその場で凍結する（無音で死ぬ）。
   * track の 'ended' を拾って、テストパターン中でなく source iframe が生きていれば
   * 自動でキャプチャをやり直す。stopCanvasCapture() による意図的停止はループしないよう、
   * 停止前にハンドラを外す（cleanup する側の責務）。
   */
  private attachTrackSurvivalMonitor(stream: MediaStream): void {
    const onLost = () => {
      // 既に別 stream に差し替わっていたら無視
      if (!this.activeStreams.includes(stream)) return;
      // テストパターン表示中はテスト側がトラックを管理しているので関与しない
      if (this.testPatternKind !== 'off') return;
      if (!this.currentSourceIframe) return;
      console.warn('WindowController: ソースキャプチャの track が終了 — 自動再キャプチャ');
      this.scheduleRecapture();
    };
    stream.getVideoTracks().forEach((track) => {
      // on* プロパティで登録（stopCanvasCapture で = null してまとめて潰せるようにするため）。
      // 'mute' は一時的だが、長く続くと事実上フリーズと同じ。再キャプチャで復帰する見込み。
      track.onended = onLost;
      track.onmute = onLost;
    });
  }

  private recaptureTimer: number | null = null;
  /** track ended の通知が同時に複数飛んでくることがあるので、まとめて 1 回だけ再キャプチャする。 */
  private scheduleRecapture(): void {
    if (this.recaptureTimer !== null) return;
    this.recaptureTimer = window.setTimeout(() => {
      this.recaptureTimer = null;
      if (!this.currentSourceIframe || this.testPatternKind !== 'off') return;
      this.stopCanvasCapture();
      this.captureFromSource();
    }, 100);
  }

  /**
   * いまの「カレント MediaStream」を、stream を消費するすべての場所に bind し直す。
   * captureFromSource とテストパターン両方の共通経路。
   *   - main の inline panel 内に存在する <video>（#source-video / #mapping-video /
   *     #cropped-video）に同一 stream を共有 bind
   *   - 出力ウィンドウの warp 用 <video> 群にも同 stream を bind
   */
  private broadcastStream(stream: MediaStream): void {
    // inline panel（main の DOM 上）の video 群（clone せず共有 bind）
    this.bindStreamToInlinePanel(stream);
    // 出力ウィンドウの video 群にも同じ stream
    this.bindStreamToOutputWindows();
    this.dispatchOverlayUpdate();
  }

  private bindStreamToInlinePanel(stream: MediaStream): void {
    const videoIds = ['source-video', 'mapping-video', 'cropped-video'];
    videoIds.forEach(id => {
      const video = document.getElementById(id) as HTMLVideoElement | null;
      if (!video) return;
      if (video.srcObject === stream) return;
      video.srcObject = stream;
      video.play().catch(error => {
        console.error(`WindowController: ${id} の再生エラー:`, error);
      });
    });
  }

  /**
   * inline panel が mount された後（broadcastStream の発火タイミングより遅れて mount された場合の保険）に
   * 呼び出すと、現在のアクティブ stream を panel 内 <video> へ bind する。stream が無ければ何もしない。
   */
  rebindStreamToInlinePanel(): void {
    const stream = this.activeStreams[0];
    if (!stream) return;
    this.bindStreamToInlinePanel(stream);
  }

  private notifyVideoDimensions(): void {
    this.events.videoDimensions.set(this.videoActualDimensions);
  }

  /**
   * 開いている全出力ウィンドウのビューポート／ディスプレイ寸法・全画面状態を inline panel に通知。
   * 「ディスプレイに対する出力ウィンドウの大きさ」可視化と、quad の「出力1px」ステップに使う。
   * 1 秒間隔の監視 interval からも呼ばれるので、前回と同じなら no-op。
   */
  private notifyOutputBounds(): void {
    const map: OutputBoundsMap = {};
    for (const [outputId, ow] of this.outputWindows) {
      const win = ow.getWindow();
      if (!win || win.closed) continue;
      try {
        // Window Management API のスクリーン情報があれば、popup の位置から「いま載っている
        // ディスプレイ」を引き当てる。これがあると label / isInternal が取れるほか、
        // フルスクリーン遷移などで win.screen がプライマリを返してしまうケースの
        // バックアップにもなる（screen の width/height が物理ディスプレイと一致するよう正規化）。
        const placedOn = this.findScreenForWindow(win);
        const data: OutputBoundsSnapshot = {
          innerWidth: win.innerWidth,
          innerHeight: win.innerHeight,
          screenWidth: placedOn?.width ?? win.screen.width,
          screenHeight: placedOn?.height ?? win.screen.height,
          isFullscreen: win.document.fullscreenElement !== null,
          screenLabel: placedOn?.label,
          screenIsInternal: placedOn?.isInternal,
        };
        map[outputId] = data;
      } catch (error) {
        console.error('WindowController: notifyOutputBounds エラー', error);
      }
    }
    const json = JSON.stringify(map);
    if (json === this.lastOutputBoundsJson) return;
    this.lastOutputBoundsJson = json;
    this.events.outputBounds.set(map);
  }

  /**
   * ソースをスケッチ canvas ↔ テストパターンの間で切り替える。
   * 'off' に戻すと currentSourceIframe から再キャプチャする（マッピング設定はいずれの場合も
   * 不変 — 校正用に「いま投影している矩形がどこにあるか」を可視化するためのソース差し替え）。
   */
  setTestPattern(kind: TestPatternKind | 'off'): void {
    if (this.testPatternKind === kind) return;
    const prev = this.testPatternKind;
    this.testPatternKind = kind;
    this.events.testPattern.set(kind);

    if (kind === 'off') {
      // テスト → 通常ソース。テスト stream を止めて、source iframe から再キャプチャする
      this.testPattern?.stop();
      this.stopCanvasCapture();
      if (this.currentSourceIframe) this.captureFromSource();
    } else if (prev === 'off') {
      // 通常 → テスト。source の tracks は止めるが iframe 参照は残しておく（'off' で復帰するため）
      this.stopCanvasCapture();
      if (!this.testPattern) this.testPattern = new TestPatternSource();
      const stream = this.testPattern.start(kind);
      if (!stream) {
        console.error('WindowController: テストパターン stream の生成に失敗');
        this.testPatternKind = prev;
        return;
      }
      this.trackStream(stream);
      this.broadcastStream(stream);
    } else {
      // テスト → 別のテスト。canvas を描き直すだけで stream オブジェクトは同じ
      this.testPattern?.start(kind);
    }

    this.broadcastTestPatternState();
  }

  private broadcastTestPatternState(): void {
    this.events.testPattern.set(this.testPatternKind);
  }

  private setProjectionMode(active: boolean): void {
    window.dispatchEvent(new CustomEvent('projection-mode-change', {
      detail: { active }
    }));
  }

  /** ソース canvas の描画バッファサイズ（width/height 属性）の変化を監視し、変わったら各所へ通知する。 */
  private monitorCanvasResize(canvas: HTMLCanvasElement): void {
    this.canvasResizeObserver?.disconnect();
    this.canvasMutationObserver?.disconnect();

    const onMaybeResized = () => {
      if (canvas.width === this.videoActualDimensions.width && canvas.height === this.videoActualDimensions.height) return;
      this.videoActualDimensions = { width: canvas.width, height: canvas.height };
      this.notifyVideoDimensions();
    };

    this.canvasResizeObserver = new ResizeObserver(onMaybeResized);
    this.canvasResizeObserver.observe(canvas);

    this.canvasMutationObserver = new MutationObserver(onMaybeResized);
    this.canvasMutationObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  }

  private getCanvasFromIframe(iframeElement: HTMLIFrameElement): HTMLCanvasElement | null {
    const iframeDoc = iframeElement.contentDocument || iframeElement.contentWindow?.document;
    if (!iframeDoc) {
      console.error('WindowController: iframeドキュメントにアクセスできません');
      return null;
    }

    const canvas = iframeDoc.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) {
      console.error('WindowController: Canvas要素が見つかりません');
      return null;
    }

    // Canvasのサイズ変更を監視
    this.monitorCanvasResize(canvas);
    // GPU プロセスクラッシュ等で WebGL コンテキストが失われたら検知（2D canvas では発火しない）
    this.monitorCanvasContext(canvas, iframeElement);

    return canvas;
  }

  /** 直近 monitorCanvasContext で wire した解除関数（重複登録防止＋意図的停止時の cleanup）。 */
  private detachCanvasContextMonitor: (() => void) | null = null;
  private contextLostReloadTimer: number | null = null;

  /**
   * WebGL コンテキストロスト／復帰を見張る。長時間 WebGL を回すと Chrome の GPU プロセスが
   * クラッシュ・リカバリすることがあり、そのとき canvas は無音で死ぬ。
   * 検知したら inline panel に警告を出し、preventDefault で復帰を許可する。
   * 2 秒待っても restored が来なければ source iframe を強制リロードして映像を復活させる。
   */
  private monitorCanvasContext(canvas: HTMLCanvasElement, iframe: HTMLIFrameElement): void {
    this.detachCanvasContextMonitor?.();

    const onLost = (e: Event) => {
      e.preventDefault(); // これで初めて webglcontextrestored の発火が許可される
      console.warn('WindowController: WebGL context lost — 復帰を待機して、ダメなら iframe をリロードします');
      this.broadcastWebglContextStatus('lost');
      if (this.contextLostReloadTimer !== null) clearTimeout(this.contextLostReloadTimer);
      this.contextLostReloadTimer = window.setTimeout(() => {
        this.contextLostReloadTimer = null;
        // 復帰してなければ強制リロード（state は失われるが、フリーズしっぱなしよりまし）
        if (this.currentSourceIframe === iframe) {
          console.warn('WindowController: WebGL context が復帰しないため iframe をリロード');
          try { iframe.src = iframe.src; } catch { /* ignore */ }
        }
      }, 2000);
    };
    const onRestored = () => {
      console.info('WindowController: WebGL context restored');
      if (this.contextLostReloadTimer !== null) {
        clearTimeout(this.contextLostReloadTimer);
        this.contextLostReloadTimer = null;
      }
      this.broadcastWebglContextStatus('ok');
    };
    canvas.addEventListener('webglcontextlost', onLost as EventListener);
    canvas.addEventListener('webglcontextrestored', onRestored);

    this.detachCanvasContextMonitor = () => {
      canvas.removeEventListener('webglcontextlost', onLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (this.contextLostReloadTimer !== null) {
        clearTimeout(this.contextLostReloadTimer);
        this.contextLostReloadTimer = null;
      }
    };
  }

  private broadcastWebglContextStatus(status: 'lost' | 'ok'): void {
    this.events.webglContext.set(status);
  }

  private startWindowMonitoring(): void {
    if (this.windowMonitoringInterval !== null) {
      return;
    }

    this.windowMonitoringInterval = window.setInterval(() => {
      if (!this.hasActiveWindows()) {
        this.stopCanvasStreaming();
        return;
      }
      // 出力ウィンドウのリフレッシュ（別ディスプレイへ手動移動した場合などイベントが飛ばないケースの保険）
      this.notifyOutputBounds();
    }, 1000);
  }

  // 出力ウィンドウがまだ開いているかをチェック（1 つでも開いてれば true）
  private hasActiveWindows(): boolean {
    for (const ow of this.outputWindows.values()) {
      const w = ow.getWindow();
      if (w && !w.closed) return true;
    }
    return false;
  }

  /** canvas からのキャプチャだけを止める（observer 切断 ＋ tracks 停止）。ウィンドウ・監視はそのまま。 */
  private stopCanvasCapture(): void {
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = null;
    this.canvasMutationObserver?.disconnect();
    this.canvasMutationObserver = null;
    this.detachCanvasContextMonitor?.();
    this.detachCanvasContextMonitor = null;
    // 自動再キャプチャの予約は意図的停止で確実にキャンセル（再開ループの防止）
    if (this.recaptureTimer !== null) {
      clearTimeout(this.recaptureTimer);
      this.recaptureTimer = null;
    }

    this.activeStreams.forEach(stream => {
      stream.getTracks().forEach(track => {
        // track.stop() は ended を発火する。survival monitor をループさせないために
        // 先にハンドラを潰してから停止する。
        track.onended = null;
        track.onmute = null;
        track.stop();
      });
    });
    this.activeStreams = [];
  }

  // Canvas配信を停止（ウィンドウ監視・プロジェクションモードも解除）
  stopCanvasStreaming(): void {
    this.stopCanvasCapture();
    this.currentSourceIframe = null;

    // テストパターンも止めて 'off' に戻す（次回 start 時のクリーンな状態のため）
    this.testPattern?.stop();
    this.testPatternKind = 'off';

    // ウィンドウ監視を停止
    if (this.windowMonitoringInterval !== null) {
      clearInterval(this.windowMonitoringInterval);
      this.windowMonitoringInterval = null;
    }

    // プロジェクションモードを解除
    this.wakeLock.release();
    this.setProjectionMode(false);
  }

  private trackStream(stream: MediaStream): MediaStream {
    this.activeStreams.push(stream);
    return stream;
  }

  destroy(): void {
    window.removeEventListener('message', this.messageHandler);
    window.removeEventListener('pagehide', this.flushSaveHandler);
    this.flushSave(); // デバウンス中の保存があれば確定
    this.wakeLock.release();
    this.closeAllWindows();
    this.testPattern?.dispose();
    this.testPattern = null;
  }
}
