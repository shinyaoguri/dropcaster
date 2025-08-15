import type { Sketch } from '../../types/sketch.js';

export class IframeManager {
  private iframe: HTMLIFrameElement | null = null;
  private isSettingsMode = false;

  async initialize(sketch: Sketch): Promise<void> {
    this.iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!this.iframe) return;

    // iframeのスタイル設定
    this.setupIframeStyles();
    
    // iframeのロード完了を待つ
    await this.waitForIframeLoad();
    
    // スケッチ用のスタイルを適用
    this.applySketchStyles();
  }

  private setupIframeStyles(): void {
    if (!this.iframe) return;
    
    this.iframe.onload = () => {
      this.applySketchStyles();
    };
  }

  private async waitForIframeLoad(): Promise<void> {
    if (!this.iframe) return;

    return new Promise((resolve) => {
      if (this.iframe!.contentDocument?.readyState === 'complete') {
        resolve();
      } else {
        this.iframe!.onload = () => resolve();
      }
    });
  }

  private applySketchStyles(): void {
    if (!this.iframe) return;

    try {
      const iframeDoc = this.iframe.contentDocument || this.iframe.contentWindow?.document;
      if (iframeDoc) {
        const style = iframeDoc.createElement('style');
        style.textContent = `
          body {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            min-height: 100vh !important;
            width: 100% !important;
          }
          canvas {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
            max-height: 100vh !important;
            object-fit: contain !important;
          }
          * {
            box-sizing: border-box !important;
          }
        `;
        iframeDoc.head.appendChild(style);
      }
    } catch (e) {
      console.log('Cannot access iframe content due to CORS policy');
    }
  }

  toggleSettingsMode(isActive: boolean): void {
    this.isSettingsMode = isActive;
    
    if (!this.iframe) return;

    if (isActive) {
      this.iframe.style.border = '3px solid #10b981';
      this.iframe.style.borderRadius = '8px';
    } else {
      this.iframe.style.border = 'none';
      this.iframe.style.borderRadius = '0';
    }
  }

  getIframe(): HTMLIFrameElement | null {
    return this.iframe;
  }

  destroy(): void {
    this.iframe = null;
  }
}
