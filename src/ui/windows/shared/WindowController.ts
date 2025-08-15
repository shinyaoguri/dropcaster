import { WindowManager, type WindowConfig } from './WindowManager';
import { SourceWindow } from '../source/SourceWindow';
import { MappingWindow } from '../mapping/MappingWindow';

export class WindowController {
  private windowManager: WindowManager;
  private sourceWindow: SourceWindow;
  private mappingWindow: MappingWindow;
  private streamingInterval: number | null = null;
  private lastCanvasImageData: ImageData | null = null;

  constructor() {
    this.windowManager = new WindowManager();
    this.sourceWindow = new SourceWindow();
    this.mappingWindow = new MappingWindow();
    
    this.setupWindowCommunication();
  }

  private calculateWindowPositions(): { source: WindowConfig; mapping: WindowConfig } {
    // 画面サイズを取得
    const screenWidth = window.screen.availWidth;
    const screenHeight = window.screen.availHeight;
    
    console.log('=== ウィンドウ位置計算開始 ===');
    console.log(`利用可能画面サイズ: ${screenWidth} x ${screenHeight}`);
    console.log(`現在のウィンドウ位置: ${window.screenX} x ${window.screenY}`);
    
    // ウィンドウサイズ
    const sourceWidth = 650;
    const sourceHeight = 500;
    const mappingWidth = 650;
    const mappingHeight = 500;
    
    const topOffset = 50;
    
    console.log(`ソースウィンドウサイズ: ${sourceWidth} x ${sourceHeight}`);
    console.log(`マッピングウィンドウサイズ: ${mappingWidth} x ${mappingHeight}`);
    
    // 現在のブラウザウィンドウのスクリーン位置を取得してオフセットとして使用
    const currentScreenX = window.screenX;
    const currentScreenY = window.screenY;
    
    console.log(`現在のブラウザウィンドウのスクリーン位置: (${currentScreenX}, ${currentScreenY})`);
    
    // シンプルで確実な配置計算
    let sourceLeft: number;
    let mappingLeft: number;
    let mappingTop: number;
    
    // 基本配置: 左右に並べる（現在のブラウザと同じモニター上に配置）
    const baseLeft = Math.max(100, currentScreenX + 100);  // ブラウザの位置を基準に右側に配置
    sourceLeft = baseLeft;
    mappingLeft = sourceLeft + sourceWidth + 50;  // ソースの右側に50px間隔で配置
    mappingTop = Math.max(topOffset, currentScreenY + topOffset);  // ブラウザと同じ高さかそれより下
    
    // 画面からはみ出る場合の調整
    if (mappingLeft + mappingWidth > screenWidth) {
      console.log('⚠️ マッピングウィンドウが画面からはみ出ます。調整中...');
      
      // マッピングウィンドウを少し上にずらして並べる
      mappingLeft = Math.max(sourceLeft + 100, screenWidth - mappingWidth - 50);
      mappingTop = topOffset + 50;  // 50px下にずらす
      
      console.log(`調整後: マッピングウィンドウを (${mappingLeft}, ${mappingTop}) に配置`);
    }
    
    console.log('=== 最終配置 ===');
    console.log(`ソースウィンドウ: (${sourceLeft}, ${Math.max(topOffset, currentScreenY + topOffset)}) - ${sourceWidth}x${sourceHeight}`);
    console.log(`マッピングウィンドウ: (${mappingLeft}, ${mappingTop}) - ${mappingWidth}x${mappingHeight}`);
    
    return {
      source: {
        name: 'source_window',
        title: 'ソースウィンドウ',
        width: sourceWidth,
        height: sourceHeight,
        left: sourceLeft,
        top: Math.max(topOffset, currentScreenY + topOffset)
      },
      mapping: {
        name: 'mapping_window',
        title: 'マッピングウィンドウ',
        width: mappingWidth,
        height: mappingHeight,
        left: mappingLeft,
        top: mappingTop
      }
    };
  }

  openSourceWindow(): void {
    const positions = this.calculateWindowPositions();
    const window = this.windowManager.openWindow(positions.source);
    if (window) {
      this.sourceWindow.setWindow(window);
    }
  }

  openMappingWindow(): void {
    const positions = this.calculateWindowPositions();
    const window = this.windowManager.openWindow(positions.mapping);
    if (window) {
      this.mappingWindow.setWindow(window);
    }
  }

  openBothWindows(): void {
    console.log('WindowController: 両方のウィンドウを開きます');
    
    // 位置を計算してログ出力
    const positions = this.calculateWindowPositions();
    console.log('計算されたウィンドウ位置:', positions);
    
    this.openSourceWindow();
    
    // マッピングウィンドウを少し遅らせて開く
    setTimeout(() => {
      this.openMappingWindow();
    }, 150);
  }

  closeSourceWindow(): void {
    this.windowManager.closeWindow('source_window');
  }

  closeMappingWindow(): void {
    this.windowManager.closeWindow('mapping_window');
  }

  closeAllWindows(): void {
    this.stopCanvasStreaming();
    this.windowManager.closeAllWindows();
  }

  private setupWindowCommunication(): void {
    console.log('WindowController: ウィンドウ間通信の設定開始');
  }


  // 開いているウィンドウにcanvas内容を配信（変更検知を一時無効化）
  private broadcastCanvasToWindows(sourceCanvas: HTMLCanvasElement): void {
    // DEBUG: 変更検知を一時的に無効化して常に更新
    // if (!this.hasCanvasChanged(sourceCanvas)) {
    //   return; // 変更がなければスキップ（パフォーマンス向上）
    // }

    let updatedWindows = 0;

    // ソースウィンドウに配信
    const sourceWindow = this.windowManager.getWindow('source_window');
    if (sourceWindow && !sourceWindow.closed) {
      this.updateWindowCanvas(sourceWindow, sourceCanvas, 'source');
      updatedWindows++;
    }

    // マッピングウィンドウに配信
    const mappingWindow = this.windowManager.getWindow('mapping_window');
    if (mappingWindow && !mappingWindow.closed) {
      this.updateWindowCanvas(mappingWindow, sourceCanvas, 'mapping');
      updatedWindows++;
    }

    console.log(`WindowController: ${updatedWindows}個のウィンドウを更新（強制更新モード）`);
  }

  // Canvas内容の変更を検知
  private hasCanvasChanged(canvas: HTMLCanvasElement): boolean {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // 初回は必ず変更ありとして扱う
      if (!this.lastCanvasImageData) {
        this.lastCanvasImageData = currentImageData;
        console.log('WindowController: 初回フレーム - 変更あり');
        return true;
      }

      // 前回のデータと比較（サンプリング方式で高速化）
      const changed = this.compareImageDataSampled(this.lastCanvasImageData, currentImageData);
      if (changed) {
        this.lastCanvasImageData = currentImageData;
        console.log('WindowController: フレーム変更検知 - 更新実行');
      } else {
        console.log('WindowController: フレーム変更なし - 更新スキップ');
      }

      return changed;
    } catch (error) {
      // エラーの場合は変更ありとして扱う
      console.warn('WindowController: Canvas変更検知エラー:', error);
      return true;
    }
  }

  // ImageDataをサンプリング比較で高速化
  private compareImageDataSampled(data1: ImageData, data2: ImageData, sampleRate: number = 100): boolean {
    if (data1.width !== data2.width || data1.height !== data2.height) {
      console.log('WindowController: Canvas サイズ変更検知');
      return true;
    }

    const pixelCount = data1.width * data1.height; // data2.height -> data1.height に修正
    const step = Math.max(1, Math.floor(pixelCount / sampleRate));
    
    let differentPixels = 0;

    for (let i = 0; i < data1.data.length; i += step * 4) {
      if (data1.data[i] !== data2.data[i] ||
          data1.data[i + 1] !== data2.data[i + 1] ||
          data1.data[i + 2] !== data2.data[i + 2] ||
          data1.data[i + 3] !== data2.data[i + 3]) {
        differentPixels++;
        if (differentPixels > 0) { // 1ピクセルでも変更があれば検知
          console.log(`WindowController: ピクセル変更検知 (${differentPixels}個の違いを発見)`);
          return true;
        }
      }
    }

    console.log('WindowController: ピクセル比較 - 変更なし');
    return false;
  }

  // 特定のウィンドウのcanvasを更新
  private updateWindowCanvas(targetWindow: Window, sourceCanvas: HTMLCanvasElement, windowType: string): void {
    try {
      const targetDoc = targetWindow.document;
      let targetCanvas = targetDoc.getElementById(`${windowType}-canvas`) as HTMLCanvasElement;
      
      // canvasが存在しない場合は作成
      if (!targetCanvas) {
        targetCanvas = this.createCanvasElement(targetDoc, windowType);
        console.log(`WindowController: ${windowType}ウィンドウにcanvas要素を作成`);
      }
      
      // サイズが変わった場合のみリサイズ
      if (targetCanvas.width !== sourceCanvas.width || targetCanvas.height !== sourceCanvas.height) {
        targetCanvas.width = sourceCanvas.width;
        targetCanvas.height = sourceCanvas.height;
      }
      
      // canvasの内容をコピー
      const targetCtx = targetCanvas.getContext('2d');
      if (targetCtx) {
        targetCtx.drawImage(sourceCanvas, 0, 0);
        console.log(`WindowController: ${windowType}ウィンドウ - drawImage実行完了 (${sourceCanvas.width}x${sourceCanvas.height})`);
      } else {
        console.error(`WindowController: ${windowType}ウィンドウ - Context取得失敗`);
      }
      
    } catch (error) {
      console.error(`WindowController: ${windowType}ウィンドウのcanvas更新エラー:`, error);
    }
  }

  // Canvas要素を作成してウィンドウに配置
  private createCanvasElement(targetDoc: Document, windowType: string): HTMLCanvasElement {
    const targetCanvas = targetDoc.createElement('canvas');
    targetCanvas.id = `${windowType}-canvas`;
    targetCanvas.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    `;
    
    // video要素を置き換えるか、コンテナに追加
    const videoElement = targetDoc.getElementById(`${windowType}-video`);
    if (videoElement && videoElement.parentNode) {
      videoElement.parentNode.replaceChild(targetCanvas, videoElement);
    } else {
      const container = targetDoc.querySelector('.video-container');
      if (container) {
        container.appendChild(targetCanvas);
      } else {
        targetDoc.body.appendChild(targetCanvas);
      }
    }

    return targetCanvas;
  }

  // iframe内のcanvasから定期的に各ウィンドウに配信開始
  async startCanvasStreaming(iframeElement: HTMLIFrameElement): Promise<void> {
    console.log('WindowController: Canvas streaming開始');

    try {
      // iframe内のcanvas要素を取得
      const iframeDoc = iframeElement.contentDocument || iframeElement.contentWindow?.document;
      if (!iframeDoc) {
        console.error('WindowController: iframeドキュメントにアクセスできません');
        return;
      }

      const canvas = iframeDoc.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        console.error('WindowController: Canvas要素が見つかりません');
        return;
      }

      console.log('WindowController: Canvas要素を発見しました', canvas);

      // 既存の配信があれば停止
      this.stopCanvasStreaming();

      // 初回配信
      this.broadcastCanvasToWindows(canvas);

      // 定期的な配信を開始（30fps）
      let frameCount = 0;
      this.streamingInterval = window.setInterval(() => {
        frameCount++;
        console.log(`WindowController: フレーム ${frameCount} 処理開始`);
        
        // ウィンドウが開いている場合のみ配信
        if (this.hasActiveWindows()) {
          this.broadcastCanvasToWindows(canvas);
          console.log(`WindowController: フレーム ${frameCount} 配信完了`);
        } else {
          // 両方のウィンドウが閉じられた場合は配信停止
          console.log('WindowController: 全ウィンドウが閉じられたため配信停止');
          this.stopCanvasStreaming();
        }
      }, 1000 / 30); // 30fps

      console.log('WindowController: Canvas streaming開始完了');

    } catch (error) {
      console.error('WindowController: Canvas streaming開始エラー:', error);
    }
  }

  // アクティブなウィンドウがあるかチェック
  private hasActiveWindows(): boolean {
    const sourceWindow = this.windowManager.getWindow('source_window');
    const mappingWindow = this.windowManager.getWindow('mapping_window');
    return (sourceWindow && !sourceWindow.closed) || (mappingWindow && !mappingWindow.closed);
  }

  // Canvas配信を停止
  stopCanvasStreaming(): void {
    if (this.streamingInterval !== null) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
      this.lastCanvasImageData = null;
      console.log('WindowController: Canvas streaming停止');
    }
  }

  // ウィンドウの状態確認
  getWindowStatus(): { source: boolean; mapping: boolean } {
    return {
      source: this.windowManager.isWindowOpen('source_window'),
      mapping: this.windowManager.isWindowOpen('mapping_window')
    };
  }

  // 外部からウィンドウインスタンスにアクセス
  getSourceWindow(): SourceWindow {
    return this.sourceWindow;
  }

  getMappingWindow(): MappingWindow {
    return this.mappingWindow;
  }

  getWindowManager(): WindowManager {
    return this.windowManager;
  }

  // デバッグ用
  logWindowStatus(): void {
    const status = this.getWindowStatus();
    const allWindows = this.windowManager.getAllOpenWindows();
    
    console.log('=== ウィンドウ状態 ===');
    console.log('ソースウィンドウ:', status.source ? '開いている' : '閉じている');
    console.log('マッピングウィンドウ:', status.mapping ? '開いている' : '閉じている');
    console.log('開いているウィンドウ一覧:', allWindows);
    console.log('==================');
  }
}