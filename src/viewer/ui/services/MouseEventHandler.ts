export class MouseEventHandler {
  private readonly events = ['mousemove', 'mousedown', 'wheel', 'mouseenter', 'keydown', 'keyup'];
  private boundCallback: ((event: Event) => void) | null = null;
  private isActive = false;

  initialize(callback: (event: Event) => void): void {
    this.boundCallback = callback.bind(this);
  }

  startListening(): void {
    if (!this.boundCallback || this.isActive) return;
    
    console.log('マウス操作リスナーを追加');
    this.isActive = true;
    
    this.events.forEach(eventType => {
      document.addEventListener(eventType, this.boundCallback!, { passive: true });
    });

    this.addIframeEventListeners();
  }

  stopListening(): void {
    if (!this.boundCallback || !this.isActive) return;
    
    console.log('マウス操作リスナーを削除');
    this.isActive = false;
    
    this.events.forEach(eventType => {
      document.removeEventListener(eventType, this.boundCallback!);
    });

    this.removeIframeEventListeners();
  }

  private addIframeEventListeners(): void {
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe || !this.boundCallback) return;

    console.log('iframe内のイベントリスナーを追加');
    
    const setupIframeEvents = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          this.events.forEach(eventType => {
            iframeDoc.addEventListener(eventType, this.boundCallback!, { passive: true });
          });
          console.log('iframe内のイベントリスナー設定完了');
        }
      } catch (e) {
        console.log('iframe内のイベントリスナー設定に失敗:', e);
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
        console.log('iframe内のイベントリスナー削除完了');
      }
    } catch (e) {
      console.log('iframe内のイベントリスナー解除に失敗:', e);
    }
  }

  destroy(): void {
    this.stopListening();
    this.boundCallback = null;
  }
}