import { WindowManager, type WindowConfig } from '../managers/WindowManager';
import { ControlWindow } from '../windows/control/ControlWindow';
import {
  defaultMappingsState,
  parseMappingsState,
  type MappingsState,
} from '../utils/mappingTransform';

const STATE_STORAGE_KEY = 'dropcaster.mappings.v1';

export class WindowController {
  private windowManager: WindowManager;
  private controlWindow: ControlWindow;
  private activeStreams: MediaStream[] = [];
  private windowMonitoringInterval: number | null = null;
  private canvasResizeObserver: ResizeObserver | null = null;
  private canvasMutationObserver: MutationObserver | null = null;
  /** いまマッピングのソースにしているスケッチ iframe（差し替え可能）。 */
  private currentSourceIframe: HTMLIFrameElement | null = null;
  private messageHandler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;

    if (event.data?.type === 'state-mutation') {
      // ControlWindow が user 入力で更新した state を受け取る。
      // 既に control 側に反映済みなので broadcastBack=false。
      this.applyState(event.data.data, { broadcastToControl: false });
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

  private saveToStorage(): void {
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
      this.controlWindow.setWindow(controlWin);
      // 親ウィンドウ参照を設定
      this.controlWindow.setParentWindow(window);

      // 初期 state を broadcast
      setTimeout(() => {
        this.broadcastStateToControl();
      }, 500);
    }
  }

  openBothWindows(): void {
    this.openControlWindow();
    setTimeout(() => {
      this.dispatchOverlayUpdate();
    }, 1000);
  }

  closeControlWindow(): void {
    this.windowManager.closeWindow('control_window');
  }

  closeAllWindows(): void {
    this.stopCanvasStreaming();
    this.windowManager.closeAllWindows();
  }

  private setupWindowCommunication(): void {
    window.addEventListener('message', this.messageHandler);
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
    this.saveToStorage();
    this.dispatchOverlayUpdate();
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
   * canvas captureStream の参照を SketchPageView へ通知。
   * 同一ウィンドウ内なので CustomEvent.detail にそのまま MediaStream を載せて渡せる。
   * stream が null なら停止通知。
   */
  private dispatchCanvasStream(stream: MediaStream | null): void {
    window.dispatchEvent(new CustomEvent('canvas-stream-ready', {
      detail: { stream }
    }));
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

      this.videoActualDimensions = {
        width: canvas.width || 1920,
        height: canvas.height || 1080,
      };

      // in-page オーバーレイ（SketchPageView 等）へ stream を broadcast
      this.dispatchCanvasStream(stream);

      // コントロールウィンドウへ dimensions 通知 ＋ stream を bind（clone せず共有）
      const controlWindow = this.windowManager.getWindow('control_window');
      if (controlWindow && !controlWindow.closed) {
        controlWindow.postMessage({
          type: 'video-dimensions-update',
          data: this.videoActualDimensions,
        }, window.location.origin);
        this.setupStreamToWindow(controlWindow, stream);
      }

      this.dispatchOverlayUpdate();
      return true;
    } catch (error) {
      console.error('WindowController: Canvas streaming開始エラー:', error);
      return false;
    }
  }

  private setProjectionMode(active: boolean): void {
    window.dispatchEvent(new CustomEvent('projection-mode-change', {
      detail: { active }
    }));
  }

  private monitorCanvasResize(canvas: HTMLCanvasElement): void {
    this.canvasResizeObserver?.disconnect();
    this.canvasMutationObserver?.disconnect();

    // ResizeObserverを使用してCanvasのサイズ変更を監視
    const resizeObserver = new ResizeObserver(() => {
      // Canvasの実際の描画サイズを取得
      const actualWidth = canvas.width;
      const actualHeight = canvas.height;
      
      if (actualWidth !== this.videoActualDimensions.width || 
          actualHeight !== this.videoActualDimensions.height) {
        
        this.videoActualDimensions = {
          width: actualWidth,
          height: actualHeight
        };
        
        console.log('WindowController: Canvasサイズ変更を検出', {
          width: actualWidth,
          height: actualHeight
        });
        
        // コントロールウィンドウにサイズ変更を通知
        const controlWindow = this.windowManager.getWindow('control_window');
        if (controlWindow && !controlWindow.closed) {
          controlWindow.postMessage({
            type: 'video-dimensions-update',
            data: this.videoActualDimensions
          }, window.location.origin);
        }
      }
    });
    
    resizeObserver.observe(canvas);
    this.canvasResizeObserver = resizeObserver;
    
    // Canvasの属性変更も監視
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'width' || mutation.attributeName === 'height')) {
          
          const actualWidth = canvas.width;
          const actualHeight = canvas.height;
          
          if (actualWidth !== this.videoActualDimensions.width || 
              actualHeight !== this.videoActualDimensions.height) {
            
            this.videoActualDimensions = {
              width: actualWidth,
              height: actualHeight
            };
            
            console.log('WindowController: Canvas属性変更を検出', {
              width: actualWidth,
              height: actualHeight
            });
            
            const controlWindow = this.windowManager.getWindow('control_window');
            if (controlWindow && !controlWindow.closed) {
              controlWindow.postMessage({
                type: 'video-dimensions-update',
                data: this.videoActualDimensions
              }, window.location.origin);
            }
          }
        }
      }
    });
    
    mutationObserver.observe(canvas, {
      attributes: true,
      attributeFilter: ['width', 'height']
    });
    this.canvasMutationObserver = mutationObserver;
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
    
    return canvas;
  }

  private startWindowMonitoring(): void {
    if (this.windowMonitoringInterval !== null) {
      return;
    }

    this.windowMonitoringInterval = window.setInterval(() => {
      if (!this.hasActiveWindows()) {
        this.stopCanvasStreaming();
      }
    }, 1000);
  }

  // アクティブなウィンドウがあるかチェック
  private hasActiveWindows(): boolean {
    const controlWindow = this.windowManager.getWindow('control_window');
    return controlWindow !== null && !controlWindow.closed;
  }

  /** canvas からのキャプチャだけを止める（observer 切断 ＋ tracks 停止）。ウィンドウ・監視はそのまま。 */
  private stopCanvasCapture(): void {
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = null;
    this.canvasMutationObserver?.disconnect();
    this.canvasMutationObserver = null;

    this.activeStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    this.activeStreams = [];
  }

  // Canvas配信を停止（ウィンドウ監視・プロジェクションモードも解除）
  stopCanvasStreaming(): void {
    this.stopCanvasCapture();
    this.currentSourceIframe = null;

    // SketchPageView に stream 停止を通知（dynamic video 要素は SketchPageView 側でクリア）
    this.dispatchCanvasStream(null);

    // ウィンドウ監視を停止
    if (this.windowMonitoringInterval !== null) {
      clearInterval(this.windowMonitoringInterval);
      this.windowMonitoringInterval = null;
    }

    // プロジェクションモードを解除
    this.setProjectionMode(false);
  }

  private trackStream(stream: MediaStream): MediaStream {
    this.activeStreams.push(stream);
    return stream;
  }

  destroy(): void {
    window.removeEventListener('message', this.messageHandler);
    this.closeAllWindows();
  }

  // ウィンドウの状態確認
  getWindowStatus(): { control: boolean } {
    return {
      control: this.windowManager.isWindowOpen('control_window')
    };
  }

  // 外部からウィンドウインスタンスにアクセス
  getControlWindow(): ControlWindow {
    return this.controlWindow;
  }

  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  logWindowStatus(): void {
    const status = this.getWindowStatus();
    const allWindows = this.windowManager.getAllOpenWindows();
    
    console.log('=== ウィンドウ状態 ===');
    console.log('統合操作ウィンドウ:', status.control ? '開いている' : '閉じている');
    console.log('開いているウィンドウ一覧:', allWindows);
    console.log('==================');
  }
}
