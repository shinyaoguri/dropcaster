import { BaseWindow } from '../shared/BaseWindow';

export class MappingWindow extends BaseWindow {
  private videoElement: HTMLVideoElement | null = null;

  constructor() {
    super('mapping_window', 'マッピングウィンドウ');
  }

  protected initialize(): void {
    console.log('MappingWindow: 初期化開始');
    this.render();
    this.setupVideo();
  }

  protected getContent(): string {
    return `
      <div class="video-container">
        <video id="mapping-video" autoplay muted playsinline>
          <p>ビデオの読み込み中...</p>
        </video>
      </div>
    `;
  }

  protected getStyles(): string {
    return super.getStyles() + `
      .video-container {
        width: 100%;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        margin: 0;
        padding: 0;
      }
      
      #mapping-video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
      }
      
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    `;
  }

  protected setupEventListeners(): void {
    // Canvas配信用のイベントリスナーは不要（WindowControllerが直接描画）
    console.log('MappingWindow: イベントリスナー設定完了');
  }

  private setupVideo(): void {
    // video要素は使用しないが、将来の拡張のため残しておく
    console.log('MappingWindow: 初期設定完了（Canvas描画待機中）');
  }
}