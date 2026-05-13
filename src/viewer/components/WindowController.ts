import { WindowManager, type WindowConfig } from '../managers/WindowManager';
import { ControlWindow } from '../windows/control/ControlWindow';
import { OutputWindow } from '../windows/output/OutputWindow';
import { TestPatternSource, type TestPatternKind } from '../runtime/TestPatternSource';
import {
  defaultMappingsState,
  parseMappingsState,
  type MappingsState,
} from '../utils/mappingTransform';
import { ScreenWakeLock } from '../utils/wakeLock';
import { SilentKeepAlive } from '../utils/silentKeepAlive';

const STATE_STORAGE_KEY = 'dropcaster.mappings.v1';
const SAVE_DEBOUNCE_MS = 250;

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
interface ScreenDetails { screens: ScreenDetailed[]; currentScreen?: ScreenDetailed; }

export class WindowController {
  private windowManager: WindowManager;
  private controlWindow: ControlWindow;
  private outputWindow: OutputWindow;
  private activeStreams: MediaStream[] = [];
  private windowMonitoringInterval: number | null = null;
  private saveTimer: number | null = null;
  /** 直近に ControlWindow へ送った出力ウィンドウ寸法（JSON）。同じなら再送しない。 */
  private lastOutputBoundsJson: string | null = null;
  private canvasResizeObserver: ResizeObserver | null = null;
  private canvasMutationObserver: MutationObserver | null = null;
  /** いまマッピングのソースにしているスケッチ iframe（差し替え可能）。 */
  private currentSourceIframe: HTMLIFrameElement | null = null;
  /** テストパターン用のソース。校正中だけ生成し、'off' に戻すと破棄せず stop する（再利用）。 */
  private testPattern: TestPatternSource | null = null;
  private testPatternKind: TestPatternKind | 'off' = 'off';
  /** メインウィンドウ側の Screen Wake Lock（プロジェクション中はディスプレイをスリープさせない）。 */
  private wakeLock: ScreenWakeLock = new ScreenWakeLock(window);
  /** 無音オーディオの keepalive（Memory Saver / タイマー絞り対策。完全不可視時の rAF は救えない）。 */
  private keepAlive: SilentKeepAlive = new SilentKeepAlive();
  /** プロジェクション中の「ソースウィンドウ（このメインウィンドウ）が hidden」を ControlWindow に通知中か。 */
  private visibilityWatchActive = false;
  private boundVisibilityChange = () => this.notifySourceVisibility();
  private messageHandler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;

    if (event.data?.type === 'state-mutation') {
      // ControlWindow が user 入力で更新した state を受け取る。
      // 既に control 側に反映済みなので broadcastBack=false。
      this.applyState(event.data.data, { broadcastToControl: false });
    } else if (event.data?.type === 'output-needs-stream') {
      // 出力ウィンドウが video 群を組み直したので stream を bind し直す
      this.bindStreamToOutputWindow();
    } else if (event.data?.type === 'test-pattern-set') {
      // ControlWindow からのテストパターン切り替え要求
      const kind = event.data.data?.kind as TestPatternKind | 'off' | undefined;
      if (kind) this.setTestPattern(kind);
    }
  };

  // 正規 state（複数 mapping ＋ activeId）。
  // ControlWindow と SketchPageView はこれの mirror をレンダリングするだけで、
  // 直接書き込まない（必ず state-mutation メッセージ／state-update 経由）。
  private state: MappingsState = defaultMappingsState();


  private videoActualDimensions = {
    width: 1,
    height: 1
  };

  constructor() {
    this.windowManager = new WindowManager();
    this.controlWindow = new ControlWindow();
    this.outputWindow = new OutputWindow();

    // 前回のマッピング設定を localStorage から復元（あれば）
    const restored = this.loadFromStorage();
    if (restored) this.state = restored;

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
   * localStorage への保存はトレーリングデバウンス（ドラッグ中は毎フレーム state が変わるので、
   * JSON.stringify + 同期 setItem を 60Hz で叩かない）。pagehide / destroy で確実にフラッシュする。
   */
  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => { this.saveTimer = null; this.flushSave(); }, SAVE_DEBOUNCE_MS);
  }

  private flushSave(): void {
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('WindowController: localStorage 書込失敗', error);
    }
  }

  private calculateWindowPosition(): WindowConfig {
    const screenWidth = window.screen.availWidth;
    const currentScreenX = window.screenX;
    const currentScreenY = window.screenY;
    
    // ウィンドウサイズ定数
    const WINDOW_WIDTH = 1200;
    const WINDOW_HEIGHT = 700;
    const TOP_OFFSET = 50;
    
    // 中央配置を計算
    let windowLeft = Math.max(100, (screenWidth - WINDOW_WIDTH) / 2);
    
    // 現在のウィンドウに近い位置に調整
    if (currentScreenX > 0) {
      windowLeft = Math.max(100, currentScreenX + 100);
    }
    
    return {
      name: 'control_window',
      title: '統合操作パネル',
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      left: windowLeft,
      top: Math.max(TOP_OFFSET, currentScreenY + TOP_OFFSET)
    };
  }

  openControlWindow(): void {
    const position = this.calculateWindowPosition();
    const controlWin = this.windowManager.openWindow(position);
    if (controlWin) {
      this.lastOutputBoundsJson = null; // 新しい ControlWindow には dedup を効かせず最新値を必ず送る
      this.controlWindow.setWindow(controlWin);
      // 親ウィンドウ参照を設定
      this.controlWindow.setParentWindow(window);

      // 初期 state を broadcast（マッピング設定 ＋ 現在のテストパターン ＋ 出力ウィンドウ寸法 ＋ 可視性）
      setTimeout(() => {
        this.broadcastStateToControl();
        this.broadcastTestPatternState();
        this.notifyOutputBounds();
        if (this.visibilityWatchActive) this.notifySourceVisibility();
      }, 500);
    }
  }

  openBothWindows(): void {
    this.openControlWindow();
    setTimeout(() => {
      this.dispatchOverlayUpdate();
    }, 1000);
  }

  /**
   * プロジェクション出力専用のポップアウトウィンドウを開く（プロジェクタの画面に置く想定）。
   * まず通常位置で開いてから、画面が複数あれば内蔵でない画面へ移動・最大化する
   * （window.open の gesture を確実に通すため、画面移動は後追い）。
   */
  openOutputWindow(): Window | null {
    const outputWin = this.windowManager.openWindow({
      name: 'output_window',
      title: 'プロジェクション出力',
      width: 960,
      height: 600,
      left: Math.max(80, window.screenX + 120),
      top: Math.max(80, window.screenY + 120),
      features: ['scrollbars=no', 'resizable=yes'],
    });
    if (!outputWin) return null;

    this.outputWindow.setWindow(outputWin);
    this.outputWindow.setParentWindow(window);
    // 出力ウィンドウのサイズ・全画面状態の変化を ControlWindow の可視化へ伝える
    outputWin.addEventListener('resize', () => this.notifyOutputBounds());
    outputWin.document.addEventListener('fullscreenchange', () => {
      this.notifyOutputBounds();
      // 全画面の出入りでビューポートが落ち着くのが遅れることがあるので追い通知
      window.setTimeout(() => this.notifyOutputBounds(), 350);
    });

    void this.placeOnExternalScreen(outputWin);

    // 初期 state を送る ＋ stream が既にあれば bind
    setTimeout(() => {
      this.broadcastStateToOutput();
      this.bindStreamToOutputWindow();
      this.notifyOutputBounds();
    }, 500);
    return outputWin;
  }

  /** Window Management API が使えれば、内蔵でない（＝プロジェクタの）画面へウィンドウを移動・最大化する。 */
  private async placeOnExternalScreen(win: Window): Promise<void> {
    try {
      const w = window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> };
      if (typeof w.getScreenDetails !== 'function') return; // 未対応（Firefox/Safari）— そのまま
      const details = await w.getScreenDetails();
      const screens = details.screens ?? [];
      const target =
        screens.find(s => s.isInternal === false) ??
        screens.find(s => s.isPrimary === false) ??
        null;
      if (!target || win.closed) return;
      win.moveTo(target.availLeft ?? target.left, target.availTop ?? target.top);
      win.resizeTo(target.availWidth, target.availHeight);
      this.notifyOutputBounds();
    } catch {
      /* 権限拒否や未対応 — 通常位置のまま（ユーザがプロジェクタへドラッグ） */
    }
  }

  /** 出力ウィンドウ内の全 <video> に現在の stream を bind する（メイン → 子の DOM 直接アクセス）。 */
  private bindStreamToOutputWindow(): void {
    const win = this.windowManager.getWindow('output_window');
    const stream = this.activeStreams[0];
    if (!win || win.closed || !stream) return;
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

  closeAllWindows(): void {
    this.stopCanvasStreaming();
    this.windowManager.closeAllWindows();
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
   *  - ControlWindow へ state-update を broadcast（プログラム的変更時のみ）
   */
  private applyState(
    next: MappingsState,
    options: { broadcastToControl?: boolean } = {}
  ): void {
    this.state = next;
    this.scheduleSave();
    this.dispatchOverlayUpdate();
    this.broadcastStateToOutput();
    if (options.broadcastToControl !== false) {
      this.broadcastStateToControl();
    }
  }

  private broadcastStateToControl(): void {
    const controlWin = this.windowManager.getWindow('control_window');
    if (controlWin && !controlWin.closed) {
      controlWin.postMessage({
        type: 'state-update',
        data: this.state,
      }, window.location.origin);
    }
  }

  private broadcastStateToOutput(): void {
    const outputWin = this.windowManager.getWindow('output_window');
    if (outputWin && !outputWin.closed) {
      outputWin.postMessage({
        type: 'state-update',
        data: this.state,
      }, window.location.origin);
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

  /**
   * 同一の MediaStream を統合ウィンドウ内の各 video 要素に共有 bind する。
   * clone は作らない —— 全 video が同じ stream を参照するだけで同期再生されるため、
   * GPU/CPU のデコーダ・コンポジット負荷を最小化できる。
   */
  private setupStreamToWindow(targetWindow: Window, stream: MediaStream): void {
    try {
      const targetDoc = targetWindow.document;
      const videoIds = ['source-video', 'mapping-video', 'cropped-video'];
      videoIds.forEach(id => {
        const video = targetDoc.getElementById(id) as HTMLVideoElement | null;
        if (video) {
          video.srcObject = stream;
          video.play().catch(error => {
            console.error(`WindowController: ${id}の再生エラー:`, error);
          });
        }
      });
    } catch (error) {
      console.error('WindowController: 統合ウィンドウへのストリーム設定エラー:', error);
    }
  }

  async startCanvasStreaming(iframeElement: HTMLIFrameElement): Promise<void> {
    this.currentSourceIframe = iframeElement;
    this.stopCanvasCapture(); // 既存のキャプチャがあれば一旦止める（ウィンドウは閉じない）
    if (!this.captureFromSource()) return;
    this.startWindowMonitoring();
    // プロジェクション中はメインウィンドウ側のディスプレイをスリープさせない。
    // 出力ウィンドウ側は OutputWindow が自分で wake lock を取る。
    void this.wakeLock.acquire();
    // タブのバックグラウンド絞り込み（タイマー throttling、Memory Saver による
    // discard、freeze など）を抑止する無音 keepalive。startCanvasStreaming 自体が
    // 「ウィンドウを開く」ボタンクリックを起点に呼ばれるのでユーザジェスチャ内。
    this.keepAlive.start();
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
   * いまの「カレント MediaStream」を、stream を消費するすべての場所
   * （control window のプレビュー / output window の各 mapping video）に bind し直す。
   * captureFromSource とテストパターン両方の共通経路。
   * （メインウィンドウはソース矩形の枠を出すだけなので stream は不要 → mapping-overlay-update だけ送る）
   */
  private broadcastStream(stream: MediaStream): void {
    // コントロールウィンドウの video 群（clone せず共有）
    const controlWindow = this.windowManager.getWindow('control_window');
    if (controlWindow && !controlWindow.closed) {
      this.setupStreamToWindow(controlWindow, stream);
    }

    // 出力ウィンドウの video 群にも同じ stream を bind
    this.bindStreamToOutputWindow();

    this.dispatchOverlayUpdate();
  }

  private notifyVideoDimensions(): void {
    const controlWindow = this.windowManager.getWindow('control_window');
    if (controlWindow && !controlWindow.closed) {
      controlWindow.postMessage({
        type: 'video-dimensions-update',
        data: this.videoActualDimensions,
      }, window.location.origin);
    }
  }

  /**
   * 出力ウィンドウのビューポート／載っているディスプレイの寸法・全画面状態を ControlWindow へ通知。
   * ControlWindow の「ディスプレイに対する出力ウィンドウの大きさ」可視化と、quad の「出力1px」ステップに使う。
   * 1 秒間隔の監視 interval からも呼ばれるので、前回送ったものと同じなら postMessage しない
   * （ControlWindow が再オープンされたときは openControlWindow() で lastOutputBoundsJson を null に戻す）。
   */
  private notifyOutputBounds(): void {
    const outputWin = this.windowManager.getWindow('output_window');
    const controlWin = this.windowManager.getWindow('control_window');
    if (!outputWin || outputWin.closed || !controlWin || controlWin.closed) return;
    try {
      const data = {
        innerWidth: outputWin.innerWidth,
        innerHeight: outputWin.innerHeight,
        screenWidth: outputWin.screen.width,
        screenHeight: outputWin.screen.height,
        isFullscreen: outputWin.document.fullscreenElement !== null,
      };
      const json = JSON.stringify(data);
      if (json === this.lastOutputBoundsJson) return;
      this.lastOutputBoundsJson = json;
      controlWin.postMessage({ type: 'output-dimensions-update', data }, window.location.origin);
    } catch (error) {
      console.error('WindowController: output-dimensions-update 送信エラー', error);
    }
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
    const controlWindow = this.windowManager.getWindow('control_window');
    if (controlWindow && !controlWindow.closed) {
      controlWindow.postMessage({
        type: 'test-pattern-update',
        data: { kind: this.testPatternKind },
      }, window.location.origin);
    }
  }

  private setProjectionMode(active: boolean): void {
    window.dispatchEvent(new CustomEvent('projection-mode-change', {
      detail: { active }
    }));
    this.setVisibilityWatch(active);
  }

  /**
   * プロジェクション中だけメインウィンドウの可視性を見張り、hidden になったら ControlWindow に通知する。
   * メインウィンドウが最小化／完全に隠れると、その中で動いているスケッチの rAF が止まり captureStream が
   * フリーズするので、運用者に「ソースウィンドウが隠れています」と知らせて前面に戻してもらうため。
   */
  private setVisibilityWatch(active: boolean): void {
    if (active === this.visibilityWatchActive) return;
    this.visibilityWatchActive = active;
    if (active) {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
      // 開始時点の状態を一度送る（既に hidden で始まっている場合に備えて）
      this.notifySourceVisibility();
    } else {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
      // 念のため「可視に戻った」状態を送って ControlWindow 側のバナーを消しておく
      this.broadcastSourceVisibility(false);
    }
  }

  private notifySourceVisibility(): void {
    this.broadcastSourceVisibility(document.visibilityState !== 'visible');
  }

  private broadcastSourceVisibility(hidden: boolean): void {
    const controlWin = this.windowManager.getWindow('control_window');
    if (!controlWin || controlWin.closed) return;
    try {
      controlWin.postMessage(
        { type: 'source-visibility-update', data: { hidden } },
        window.location.origin,
      );
    } catch {
      /* ignore */
    }
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
   * 検知したら ControlWindow に警告を出し、preventDefault で復帰を許可する。
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
    const controlWin = this.windowManager.getWindow('control_window');
    if (!controlWin || controlWin.closed) return;
    try {
      controlWin.postMessage(
        { type: 'webgl-context-update', data: { status } },
        window.location.origin,
      );
    } catch {
      /* ignore */
    }
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

  // アクティブなウィンドウ（コントロール or 出力）があるかチェック
  private hasActiveWindows(): boolean {
    const controlWindow = this.windowManager.getWindow('control_window');
    const outputWindow = this.windowManager.getWindow('output_window');
    return (controlWindow !== null && !controlWindow.closed) ||
           (outputWindow !== null && !outputWindow.closed);
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
    this.keepAlive.stop();
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
    this.keepAlive.stop();
    this.closeAllWindows();
    this.testPattern?.dispose();
    this.testPattern = null;
  }
}
