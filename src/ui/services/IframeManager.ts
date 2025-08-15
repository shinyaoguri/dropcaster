export class IframeManager {
  private iframe: HTMLIFrameElement | null = null;

  async initialize(): Promise<void> {
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
    if (!this.iframe) return;

    try {
      const iframeDoc = this.iframe.contentDocument || this.iframe.contentWindow?.document;
      if (iframeDoc) {
        // 既存の設定モード用スタイルを削除
        const existingStyle = iframeDoc.getElementById('settings-mode-style');
        if (existingStyle) {
          existingStyle.remove();
        }

        if (isActive) {
          // 設定モードON: Canvas要素に緑色の枠を追加
          const style = iframeDoc.createElement('style');
          style.id = 'settings-mode-style';
          style.textContent = `
            canvas {
              border: 3px solid #10b981 !important;
              border-radius: 8px !important;
              box-shadow: 0 0 10px rgba(16, 185, 129, 0.3) !important;
            }
          `;
          iframeDoc.head.appendChild(style);
          console.log('iframe内のCanvas要素に緑色の枠を設定しました');
        } else {
          // 設定モードOFF: 枠を削除
          console.log('iframe内のCanvas要素の枠を削除しました');
        }
      }
    } catch (e) {
      console.log('iframe内のスタイル設定に失敗:', e);
    }
  }

  getIframe(): HTMLIFrameElement | null {
    return this.iframe;
  }

  destroy(): void {
    this.iframe = null;
  }
}
