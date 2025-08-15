export class OverlayManager {
  private overlay: HTMLDivElement | null = null;

  initialize(): void {
    this.overlay = document.getElementById('iframe-overlay') as HTMLDivElement;
  }

  toggleOverlay(isVisible: boolean): void {
    if (!this.overlay) {
      this.initialize();
    }

    if (this.overlay) {
      if (isVisible) {
        this.overlay.style.display = 'block';
        console.log('iframeオーバーレイを表示しました');
      } else {
        this.overlay.style.display = 'none';
        console.log('iframeオーバーレイを非表示にしました');
      }
    }
  }

  syncWithCanvas(): void {
    if (!this.overlay) return;

    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe) return;

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const canvas = iframeDoc.querySelector('canvas');
        if (canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          const iframeRect = iframe.getBoundingClientRect();
          
          const relativeLeft = canvasRect.left - iframeRect.left;
          const relativeTop = canvasRect.top - iframeRect.top;
          
          this.overlay.style.position = 'absolute';
          this.overlay.style.left = `${relativeLeft}px`;
          this.overlay.style.top = `${relativeTop}px`;
          this.overlay.style.width = `${canvasRect.width}px`;
          this.overlay.style.height = `${canvasRect.height}px`;
          
          console.log('iframe-overlayをcanvasに同期しました:', {
            left: relativeLeft,
            top: relativeTop,
            width: canvasRect.width,
            height: canvasRect.height
          });
        }
      }
    } catch (e) {
      console.log('canvasとの同期に失敗:', e);
    }
  }

  getOverlay(): HTMLDivElement | null {
    return this.overlay;
  }

  destroy(): void {
    this.overlay = null;
  }
}