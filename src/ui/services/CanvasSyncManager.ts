export class CanvasSyncManager {
  updateCanvasFromOverlay(overlay: HTMLDivElement): void {
    if (!overlay) return;

    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement;
    if (!iframe) return;

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const canvas = iframeDoc.querySelector('canvas');
        if (canvas) {
          const overlayRect = overlay.getBoundingClientRect();
          const iframeRect = iframe.getBoundingClientRect();
          
          const relativeLeft = overlayRect.left - iframeRect.left;
          const relativeTop = overlayRect.top - iframeRect.top;
          
          canvas.style.position = 'absolute';
          canvas.style.left = `${relativeLeft}px`;
          canvas.style.top = `${relativeTop}px`;
          canvas.style.width = `${overlayRect.width}px`;
          canvas.style.height = `${overlayRect.height}px`;
          
          console.log('iframe内のcanvasを更新しました:', {
            left: relativeLeft,
            top: relativeTop,
            width: overlayRect.width,
            height: overlayRect.height
          });
        }
      }
    } catch (e) {
      console.log('iframe内のcanvas更新に失敗:', e);
    }
  }

  syncOverlayWithCanvas(overlay: HTMLDivElement): void {
    if (!overlay) return;

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
          
          overlay.style.position = 'absolute';
          overlay.style.left = `${relativeLeft}px`;
          overlay.style.top = `${relativeTop}px`;
          overlay.style.width = `${canvasRect.width}px`;
          overlay.style.height = `${canvasRect.height}px`;
          
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
}