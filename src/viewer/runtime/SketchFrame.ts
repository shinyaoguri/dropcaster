// 1 枚のスケッチ iframe をラップする。読み込み・準備完了の検出・センタリング用スタイル注入・
// ベストエフォートの一時停止/再開・canvas の captureStream・破棄を担当する。
// 複数枚は SketchPool が束ねて管理する。
//
// 前提: スケッチは同一オリジン（dist/sketches/ または dev サーバの /sketches/）から配信されるので
//       contentDocument / contentWindow にアクセスできる（canvas キャプチャ・スタイル注入のため）。

// iframe 内の body / canvas を中央寄せし、ビューポートからはみ出さないようにするスタイル。
// （IframeManager と旧 SlideshowView にそれぞれ重複していたものをここに集約）
const VIEWER_FRAME_STYLE = `
  html, body { margin: 0; padding: 0; background: #000; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  canvas {
    display: block;
    max-width: 100%;
    max-height: 100vh;
    object-fit: contain;
  }
`;

// load イベントが（CSP やリダイレクトなどで）発火しなかった場合に備えたフォールバック時間
const LOAD_TIMEOUT_MS = 15000;

export class SketchFrame {
  readonly iframe: HTMLIFrameElement;
  /** いま読み込んでいる（または読み込み中の）URL。about:blank のときは null。 */
  private loadedUrl: string | null = null;
  /** 進行中の読み込みの完了 Promise。読み込んでいなければ即 resolve 済み。 */
  private loadPromise: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(container: HTMLElement) {
    const iframe = document.createElement('iframe');
    iframe.className = 'dc-sketch-frame';
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('title', 'sketch');
    // 単体（プール外）で使われたときでもコンテナを埋めるための最低限のスタイル。
    // SketchPool 内では .dc-sketch-stage > .dc-sketch-frame の CSS が
    // position:absolute や opacity を上書きする（同名プロパティは同値なので衝突しない）。
    iframe.style.cssText = 'display:block; width:100%; height:100%; margin:0; padding:0; border:0;';
    // sandbox は付けない（同一オリジンでの canvas アクセスが必要なため）
    this.iframe = iframe;
    container.appendChild(iframe);
  }

  /** いま読み込んでいる URL（未読み込みなら null） */
  get currentUrl(): string | null {
    return this.loadedUrl;
  }

  /** 進行中の読み込みの完了を待つ Promise（読み込み中でなければ即解決） */
  get ready(): Promise<void> {
    return this.loadPromise;
  }

  /**
   * 指定 URL を読み込む。load イベント発火＋センタリングスタイル注入の後に解決する。
   * すでに同じ URL を読み込んでいる場合は再読み込みせず、その時点の ready を返す。
   */
  load(url: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('SketchFrame is disposed'));
    if (this.loadedUrl === url) return this.loadPromise;

    this.loadedUrl = url;
    this.loadPromise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.iframe.removeEventListener('load', onLoad);
        this.injectViewerStyle();
        resolve();
      };
      const onLoad = () => finish();
      const timer = window.setTimeout(finish, LOAD_TIMEOUT_MS);
      this.iframe.addEventListener('load', onLoad, { once: true });
      this.iframe.src = url;
    });
    return this.loadPromise;
  }

  /** iframe 内 document（同一オリジンでアクセスできなければ null） */
  get document(): Document | null {
    try {
      return this.iframe.contentDocument ?? this.iframe.contentWindow?.document ?? null;
    } catch {
      return null;
    }
  }

  /** iframe 内 window（アクセスできなければ null） */
  get window(): Window | null {
    try {
      return this.iframe.contentWindow;
    } catch {
      return null;
    }
  }

  /** iframe 内の <canvas>（無ければ null） */
  get canvas(): HTMLCanvasElement | null {
    return this.document?.querySelector('canvas') ?? null;
  }

  /**
   * iframe 内に <canvas> が現れるまで待つ（p5 の setup() などで遅れて生成されるため）。
   * 先に load の完了を待ち、その後 timeout まで短間隔でポーリングする。timeout 時は最後の値（null かも）。
   */
  async whenCanvasReady(timeoutMs = 5000): Promise<HTMLCanvasElement | null> {
    await this.loadPromise;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const c = this.canvas;
      if (c) return c;
      await new Promise<void>(resolve => window.setTimeout(resolve, 100));
    }
    return this.canvas;
  }

  /** canvas の描画を MediaStream として取得する（プロジェクションマッピング用）。取れなければ null。 */
  captureStream(fps = 30): MediaStream | null {
    const canvas = this.canvas as (HTMLCanvasElement & { captureStream?(frameRate?: number): MediaStream }) | null;
    if (!canvas?.captureStream) return null;
    try {
      return canvas.captureStream(fps);
    } catch {
      return null;
    }
  }

  /** 表示/非表示の切り替え（CSS クラスのトグルのみ。実際のフェードは SketchPool 側の CSS） */
  setVisible(visible: boolean): void {
    this.iframe.classList.toggle('dc-visible', visible);
  }

  get visible(): boolean {
    return this.iframe.classList.contains('dc-visible');
  }

  /** ベストエフォートの一時停止（p5 グローバルモードの noLoop。他のライブラリでは無視される） */
  pause(): void {
    try {
      (this.window as (Window & { noLoop?: () => void }) | null)?.noLoop?.();
    } catch {
      /* ignore */
    }
  }

  /** ベストエフォートの再開（p5 の loop + 1 フレーム再描画） */
  resume(): void {
    try {
      const w = this.window as (Window & { loop?: () => void; redraw?: () => void }) | null;
      w?.loop?.();
      w?.redraw?.();
    } catch {
      /* ignore */
    }
  }

  /**
   * 設定モードの ON/OFF。ON のとき iframe 内の <canvas> に緑の枠を出して
   * 「マッピングのソースになっている矩形」を視認できるようにする。
   */
  setSettingsMode(active: boolean): void {
    const doc = this.document;
    if (!doc?.head) return;
    try {
      doc.getElementById('dc-settings-mode-style')?.remove();
      if (!active) return;
      const style = doc.createElement('style');
      style.id = 'dc-settings-mode-style';
      style.textContent = `
        canvas {
          border: 3px solid #10b981 !important;
          border-radius: 8px !important;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.3) !important;
        }
      `;
      doc.head.appendChild(style);
    } catch {
      /* cross-origin など。無視 */
    }
  }

  private injectViewerStyle(): void {
    const doc = this.document;
    if (!doc?.head) return;
    try {
      // 二重注入を避ける
      if (doc.head.querySelector('style[data-dropcaster="frame-style"]')) return;
      const style = doc.createElement('style');
      style.setAttribute('data-dropcaster', 'frame-style');
      style.textContent = VIEWER_FRAME_STYLE;
      doc.head.appendChild(style);
    } catch {
      /* cross-origin など。無視 */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.iframe.src = 'about:blank';
    } catch {
      /* ignore */
    }
    this.iframe.remove();
    this.loadedUrl = null;
  }
}
