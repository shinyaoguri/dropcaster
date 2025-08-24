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

  getOverlay(): HTMLDivElement | null {
    return this.overlay;
  }

  destroy(): void {
    this.overlay = null;
  }
}