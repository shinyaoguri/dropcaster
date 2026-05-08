import { WindowManager, type WindowConfig } from '../managers/WindowManager';
import { ControlWindow } from '../windows/control/ControlWindow';

export class WindowController {
  private windowManager: WindowManager;
  private controlWindow: ControlWindow;
  private controlStream: MediaStream | null = null;
  private activeStreams: MediaStream[] = [];
  private windowMonitoringInterval: number | null = null;
  private canvasResizeObserver: ResizeObserver | null = null;
  private canvasMutationObserver: MutationObserver | null = null;
  private messageHandler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;

    switch (event.data?.type) {
      case 'source-selection-change':
        this.handleSourceSelectionChange(event.data.data);
        break;
      case 'mapping-transform-change':
        this.handleMappingTransformChange(event.data.data);
        break;
    }
  };
  private sourceSelectionData = {
    x: 0,
    y: 0,
    width: 100,
    height: 100
  };
  private mappingTransformData = {
    x: 25,
    y: 25,
    width: 50,
    height: 50,
    scale: 1
  };
  private videoActualDimensions = {
    width: 1,
    height: 1
  };

  constructor() {
    this.windowManager = new WindowManager();
    this.controlWindow = new ControlWindow();
    
    this.setupWindowCommunication();
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
      
      // 初期値を設定
      setTimeout(() => {
        // 初期化データを送信
        controlWin.postMessage({
          type: 'initialize-control',
          data: {
            source: this.sourceSelectionData,
            transform: this.mappingTransformData
          }
        }, window.location.origin);
      }, 500);
    }
  }

  openBothWindows(): void {
    // 統合ウィンドウを開く
    this.openControlWindow();
    
    // 初期状態を反映
    setTimeout(() => {
      this.updateSketchPageOverlay();
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

  private handleSourceSelectionChange(selectionData: any): void {
    this.sourceSelectionData = selectionData;
    this.updateSketchPageOverlay();
  }

  private handleMappingTransformChange(transformData: any): void {
    if (transformData.sourceSelection) {
      this.sourceSelectionData = transformData.sourceSelection;
    }
    
    this.mappingTransformData = {
      x: transformData.x,
      y: transformData.y,
      width: transformData.width,
      height: transformData.height,
      scale: transformData.scale || 1
    };
    
    this.updateSketchPageOverlay();
  }

  private updateSketchPageOverlay(): void {
    const event = new CustomEvent('mapping-overlay-update', {
      detail: {
        source: this.sourceSelectionData,
        mapping: this.mappingTransformData,
        videoDimensions: this.videoActualDimensions
      }
    });
    window.dispatchEvent(event);
  }

  private setupStreamToWindow(targetWindow: Window, stream: MediaStream): void {
    try {
      const targetDoc = targetWindow.document;
      
      // 統合ウィンドウ内の全てのビデオ要素にストリームを設定
      const videos = [
        { id: 'source-video', clone: false },
        { id: 'mapping-video', clone: true },
        { id: 'cropped-video', clone: true },
        { id: 'background-video', clone: true }
      ];

      videos.forEach(({ id, clone }) => {
        const video = targetDoc.getElementById(id) as HTMLVideoElement;
        if (video) {
          video.srcObject = clone ? this.cloneStream(stream) : stream;
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
    const canvas = this.getCanvasFromIframe(iframeElement);
    if (!canvas) return;
    
    try {
      // 既存のストリームがあれば停止
      this.stopCanvasStreaming();

      // MediaStreamをキャプチャ（30fps）
      const stream = canvas.captureStream(30);
      this.trackStream(stream);
      if (!stream) {
        console.error('WindowController: MediaStreamの取得に失敗しました');
        return;
      }

      // スケッチページの複数のビデオ要素にストリームを設定
      const mappingOverlayVideo = document.getElementById('mapping-overlay-video') as HTMLVideoElement;
      if (mappingOverlayVideo) {
        mappingOverlayVideo.srcObject = this.cloneStream(stream);
        
        // ビデオの実際のサイズを取得
        mappingOverlayVideo.addEventListener('loadedmetadata', () => {
          this.videoActualDimensions = {
            width: mappingOverlayVideo.videoWidth,
            height: mappingOverlayVideo.videoHeight
          };
          
          const controlWindow = this.windowManager.getWindow('control_window');
          if (controlWindow && !controlWindow.closed) {
            controlWindow.postMessage({
              type: 'video-dimensions-update',
              data: this.videoActualDimensions
            }, window.location.origin);
          }
          
          this.updateSketchPageOverlay();
        }, { once: true });
        
        // ストリーム設定後、初期状態を送信
        setTimeout(() => this.updateSketchPageOverlay(), 100);
      }
      
      // iframe-overlay内のビデオ要素にもストリームを設定
      const iframeMappingVideo = document.getElementById('iframe-mapping-video') as HTMLVideoElement;
      if (iframeMappingVideo) {
        iframeMappingVideo.srcObject = this.cloneStream(stream);
        iframeMappingVideo.play().catch(error => {
          console.error('WindowController: iframe-mapping-videoの再生エラー:', error);
        });
        
        iframeMappingVideo.addEventListener('loadedmetadata', () => {
          setTimeout(() => this.updateSketchPageOverlay(), 100);
        }, { once: true });
      }

      // 統合ウィンドウにストリームを設定
      const controlWindow = this.windowManager.getWindow('control_window');
      if (controlWindow && !controlWindow.closed) {
        this.controlStream = this.cloneStream(stream);
        this.setupStreamToWindow(controlWindow, this.controlStream);
      }

      // ウィンドウの状態を定期的にチェック
      this.startWindowMonitoring();

    } catch (error) {
      console.error('WindowController: Canvas streaming開始エラー:', error);
    }
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

  // Canvas配信を停止
  stopCanvasStreaming(): void {
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = null;
    this.canvasMutationObserver?.disconnect();
    this.canvasMutationObserver = null;

    this.activeStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    this.activeStreams = [];
    this.controlStream = null;

    const localVideos = [
      document.getElementById('mapping-overlay-video') as HTMLVideoElement | null,
      document.getElementById('iframe-mapping-video') as HTMLVideoElement | null
    ];
    localVideos.forEach(video => {
      if (video) video.srcObject = null;
    });

    // ウィンドウ監視を停止
    if (this.windowMonitoringInterval !== null) {
      clearInterval(this.windowMonitoringInterval);
      this.windowMonitoringInterval = null;
    }

    // ストリーム停止完了
  }

  private trackStream(stream: MediaStream): MediaStream {
    this.activeStreams.push(stream);
    return stream;
  }

  private cloneStream(stream: MediaStream): MediaStream {
    return this.trackStream(stream.clone());
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
