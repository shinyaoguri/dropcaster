// 1 枚のスケッチ iframe をラップする。読み込み・準備完了（canvas 出現）の検出・センタリング用
// スタイル注入・ベストエフォートの一時停止/再開・表示トグル・破棄を担当する。
// 複数枚は SketchPool が束ねて管理する。
//
// 前提: スケッチは同一オリジン（dist/sketches/ または dev サーバの /sketches/）から配信されるので
//       contentDocument / contentWindow にアクセスできる（canvas 検出・スタイル注入のため）。
//       マッピングの captureStream は WindowController が iframe.contentDocument の <canvas> から直接行う。

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

/** スケッチ iframe の window（p5 のグローバルや、pause/resume 用に差し替える rAF 退避フィールドを含む）。 */
type DcSketchWindow = Window & {
  noLoop?: () => void;
  loop?: () => void;
  redraw?: () => void;
  __dcOrigRaf?: ((cb: FrameRequestCallback) => number) | undefined;
  __dcRafQueue?: FrameRequestCallback[] | undefined;
};

export class SketchFrame {
  readonly iframe: HTMLIFrameElement;
  /** いま読み込んでいる（または読み込み中の）URL。about:blank or srcdoc のときは null。 */
  private loadedUrl: string | null = null;
  /** srcdoc 経由でロードしたときの呼び出し側識別子（同一性判定用）。url 経由でロードしたときは null。 */
  private loadedTag: string | null = null;
  /** 進行中の読み込みの完了 Promise。読み込んでいなければ即 resolve 済み。 */
  private loadPromise: Promise<void> = Promise.resolve();
  /** 進行中の load の後始末（fallback タイマー・load リスナ・resolve）。再 load / dispose で確実に畳む。 */
  private pendingLoad: { timer: number; onLoad: () => void; resolve: () => void } | null = null;
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

  /** いま読み込んでいる URL（未読み込み・srcdoc 経路なら null） */
  get currentUrl(): string | null {
    return this.loadedUrl;
  }

  /** srcdoc 経路で読み込んだときの呼び出し側識別子（url 経路なら null） */
  get currentTag(): string | null {
    return this.loadedTag;
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

    this.settlePendingLoad(); // 進行中だった別 URL のロードのタイマー・リスナを片付け、待っている呼び出しを解放する

    this.loadedUrl = url;
    this.loadedTag = null;
    return this.startLoad((iframe) => { iframe.src = url; });
  }

  /**
   * srcdoc に指定 HTML 文字列を読み込ませる。about:srcdoc は parent と同一オリジン扱いなので
   * contentDocument 経由の canvas 検出・pause/resume・captureStream は load(url) と同じく動作する。
   * tag は呼び出し側が同一性を判定するための任意キー (再ロード抑止用)。
   */
  loadSrcdoc(html: string, opts?: { tag?: string }): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('SketchFrame is disposed'));
    const tag = opts?.tag ?? null;
    if (tag && this.loadedTag === tag) return this.loadPromise;

    this.settlePendingLoad();

    this.loadedUrl = null;
    this.loadedTag = tag;
    return this.startLoad((iframe) => { iframe.srcdoc = html; });
  }

  /** load / loadSrcdoc の共通処理。pendingLoad のセットアップと style 注入の後始末を担う。 */
  private startLoad(applySource: (iframe: HTMLIFrameElement) => void): Promise<void> {
    this.loadPromise = new Promise<void>((resolve) => {
      const finish = () => {
        if (!this.pendingLoad) return; // すでに settle 済み
        this.clearPendingLoad();
        this.injectViewerStyle();
        resolve();
      };
      const onLoad = () => finish();
      this.pendingLoad = { timer: window.setTimeout(finish, LOAD_TIMEOUT_MS), onLoad, resolve };
      this.iframe.addEventListener('load', onLoad, { once: true });
      applySource(this.iframe);
    });
    return this.loadPromise;
  }

  /** 進行中の load のタイマー・load リスナを解除する（resolve はしない — 呼び出し側が直後に resolve する）。 */
  private clearPendingLoad(): void {
    const p = this.pendingLoad;
    if (!p) return;
    this.pendingLoad = null;
    clearTimeout(p.timer);
    this.iframe.removeEventListener('load', p.onLoad);
  }

  /** 進行中の load を畳む（タイマー解除＋待っている loadPromise を resolve）。再 load / dispose 用。 */
  private settlePendingLoad(): void {
    const p = this.pendingLoad;
    if (!p) return;
    this.clearPendingLoad();
    p.resolve();
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

  /** 表示/非表示の切り替え（CSS クラスのトグルのみ。実際のフェードは SketchPool 側の CSS） */
  setVisible(visible: boolean): void {
    this.iframe.classList.toggle('dc-visible', visible);
  }

  /**
   * 一時停止: iframe の requestAnimationFrame を「呼ばれたら退避キューに積むだけ」に差し替えて、
   * 表示されていない間スケッチの描画ループ（p5 instance / three.js / 生 rAF いずれも）を凍結する。
   * p5 グローバルモードでは noLoop() も呼んでクリーンに止める。差し替えは Window プロパティ
   * （__dc*）に保持するので、navigation で新しい Document になれば自然に消える。冪等。
   */
  pause(): void {
    try {
      const w = this.window as DcSketchWindow | null;
      if (!w) return;
      w.noLoop?.(); // p5 グローバルモード（reads window.rAF each frame なので下の差し替えでも止まるが、これが正攻法）
      if (!w.__dcOrigRaf) {
        w.__dcOrigRaf = w.requestAnimationFrame.bind(w);
        w.__dcRafQueue = [];
        w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
          w.__dcRafQueue!.push(cb);
          return -1;
        };
      }
    } catch {
      /* ignore */
    }
  }

  /** 再開: requestAnimationFrame を元に戻し、停止中に積まれた rAF コールバックを再投入する。p5 は loop()+redraw()。冪等。 */
  resume(): void {
    try {
      const w = this.window as DcSketchWindow | null;
      if (!w) return;
      if (w.__dcOrigRaf) {
        const orig = w.__dcOrigRaf;
        const queue = w.__dcRafQueue ?? [];
        w.requestAnimationFrame = orig;
        w.__dcOrigRaf = undefined;
        w.__dcRafQueue = undefined;
        for (const cb of queue) orig(cb);
      }
      w.loop?.();
      w.redraw?.();
    } catch {
      /* ignore */
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
    this.settlePendingLoad(); // 進行中のロードがあればタイマーを止めて畳む
    try {
      this.iframe.src = 'about:blank';
    } catch {
      /* ignore */
    }
    this.iframe.remove();
    this.loadedUrl = null;
    this.loadedTag = null;
  }
}
