// フルスクリーン中のマウス操作検知用。document と（同一オリジンの）スケッチ iframe 内の document の
// 両方にユーザー操作イベントを張り、コールバックへ転送する。
export class MouseEventHandler {
  private readonly events = ['mousemove', 'mousedown', 'wheel', 'mouseenter', 'keydown', 'keyup'];
  private boundCallback: ((event: Event) => void) | null = null;
  private isActive = false;

  initialize(callback: (event: Event) => void): void {
    this.boundCallback = callback.bind(this);
  }

  startListening(): void {
    if (!this.boundCallback || this.isActive) return;
    this.isActive = true;
    this.events.forEach(eventType => {
      document.addEventListener(eventType, this.boundCallback!, { passive: true });
    });
    this.addIframeEventListeners();
  }

  stopListening(): void {
    if (!this.boundCallback || !this.isActive) return;
    this.isActive = false;
    this.events.forEach(eventType => {
      document.removeEventListener(eventType, this.boundCallback!);
    });
    this.removeIframeEventListeners();
  }

  private addIframeEventListeners(): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe || !this.boundCallback) return;

    const setupIframeEvents = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          this.events.forEach(eventType => {
            iframeDoc.addEventListener(eventType, this.boundCallback!, { passive: true });
          });
        }
      } catch {
        /* cross-origin など。無視 */
      }
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      setupIframeEvents();
    } else {
      iframe.addEventListener('load', setupIframeEvents);
    }
  }

  private removeIframeEventListeners(): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe || !this.boundCallback) return;
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        this.events.forEach(eventType => {
          iframeDoc.removeEventListener(eventType, this.boundCallback!);
        });
      }
    } catch {
      /* cross-origin など。無視 */
    }
  }

  destroy(): void {
    this.stopListening();
    this.boundCallback = null;
  }
}
