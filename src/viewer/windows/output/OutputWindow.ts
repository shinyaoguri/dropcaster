import { BaseWindow } from '../shared/BaseWindow';
import {
  applyQuadTransform,
  applyVideoCrop,
  isMappingEnabled,
  type MappingEntry,
  type MappingsState,
} from '../../utils/mappingTransform';
import { ScreenWakeLock } from '../../utils/wakeLock';

interface OutputChild {
  div: HTMLElement;
  video: HTMLVideoElement;
}

/**
 * プロジェクション出力専用のポップアウトウィンドウ（プロジェクタの画面に置く想定）。
 * 黒背景に、有効な各マッピングを warp（CSS matrix3d）した <video> として並べるだけ。UI は最小（全画面ボタン）。
 *
 * スケッチ本体はメインウィンドウで動き、その canvas の captureStream を WindowController が
 * この window の <video> 群へ直接 srcObject 設定する（同一オリジンなのでメイン → 子の DOM に書ける）。
 * マッピング設定は state-update メッセージで受け取り、配置が変わるたびに親へ
 * 'output-needs-stream' を投げて stream を bind し直してもらう。
 */
export class OutputWindow extends BaseWindow {
  private mappings: MappingEntry[] = [];
  private children = new Map<string, OutputChild>();
  private boundMessage = (e: MessageEvent) => this.onMessage(e);
  private boundResize = () => this.scheduleReapply();
  private boundKeydown = (e: KeyboardEvent) => this.onKeydown(e);
  private boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private boundMouseOut = (e: Event) => this.onMouseOut(e);
  private idleTimer: number | null = null;
  /** 開発モード（mapping 枠線・マウス追従クロスヘア表示）。親から dev-mode-update で push される。 */
  private devMode = false;
  /** resize 由来の transform 再適用を 1 フレーム 1 回へ間引くための rAF id。 */
  private reapplyRafId: number | null = null;
  /** 出力ウィンドウのディスプレイ（＝プロジェクタ）をスリープさせないための Screen Wake Lock。 */
  private wakeLock: ScreenWakeLock | null = null;
  /** 自身が担当する出力 id（OutputDef.id）。state.mappings 中の m.outputId と突き合わせる。 */
  private readonly outputId: string;

  constructor(outputId: string) {
    super(`output_window_${outputId}`, 'プロジェクション出力');
    this.outputId = outputId;
  }

  getOutputId(): string { return this.outputId; }

  protected initialize(): void {
    this.render();
    if (!this.window) return;
    try { this.window.document.body.style.background = '#000'; } catch { /* ignore */ }
    this.window.addEventListener('message', this.boundMessage);
    this.window.addEventListener('resize', this.boundResize);
    this.window.addEventListener('keydown', this.boundKeydown);
    this.window.addEventListener('beforeunload', () => this.teardown());
    // この出力ウィンドウが載っているディスプレイ（通常はプロジェクタ）をスリープさせない。
    // 不可視時は自動 release され、再可視で自動再取得される（ScreenWakeLock が面倒を見る）。
    this.wakeLock = new ScreenWakeLock(this.window);
    void this.wakeLock.acquire();
    this.requestStream();
    this.scheduleIdle();
  }

  protected getContent(): string {
    return `
      <div id="dc-output-stage">
        <div id="dc-output-root"></div>
        <svg id="dc-dev-overlay" aria-hidden="true">
          <line id="dc-dev-crosshair-h" x1="0" y1="0" x2="0" y2="0"></line>
          <line id="dc-dev-crosshair-v" x1="0" y1="0" x2="0" y2="0"></line>
        </svg>
        <div id="dc-dev-readout" class="dc-dev-ui" aria-hidden="true">
          <span id="dc-dev-readout-px">—</span>
          <span class="dc-dev-readout-sep">·</span>
          <span id="dc-dev-readout-pct">—</span>
        </div>
        <button id="dc-output-fs" class="dc-output-ui" title="全画面 (F / F11 でも可)">⛶ 全画面</button>
        <div id="dc-output-hint" class="dc-output-ui">ダブルクリックまたは F で全画面 / Esc で解除</div>
      </div>
    `;
  }

  protected getStyles(): string {
    return `
      html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
      #dc-output-stage { position: fixed; inset: 0; background: #000; }
      #dc-output-root { position: absolute; inset: 0; }
      .dc-out-mapping { position: absolute; inset: 0; overflow: hidden; transform-origin: top left; backface-visibility: hidden; will-change: transform; }
      /* video は自動で合成レイヤになるので will-change は不要（warp する親 div だけに付ける） */
      .dc-out-mapping > video { position: absolute; top: 0; left: 0; transform-origin: top left; object-fit: fill; }
      .dc-output-ui { transition: opacity 0.3s ease; }
      #dc-output-fs {
        position: fixed; top: 16px; right: 16px; z-index: 10;
        background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.35);
        padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
      }
      #dc-output-hint {
        position: fixed; bottom: 16px; left: 16px; z-index: 10;
        color: rgba(255,255,255,0.5); font-size: 12px;
      }
      #dc-output-stage.dc-idle { cursor: none; }
      #dc-output-stage.dc-idle .dc-output-ui { opacity: 0; pointer-events: none; }

      /* --- 開発モード（dc-dev-mode クラスが stage に付いた時だけ表示） --- */
      /* 各 mapping の warp 後 quad 枠線。.dc-out-mapping は inset:0 で full-stage、それを matrix3d で
         quad に変形しているので、box-sizing: border-box の border はその warped 枠ぴったりに乗る。 */
      #dc-output-stage.dc-dev-mode .dc-out-mapping {
        box-sizing: border-box;
        border: 2px solid #ff3b30;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
      }
      /* SVG クロスヘア・寸法表示は通常時は非表示。
         dc-dev-mode（ON）かつ dc-cursor-active（マウス位置が確定済み）の両方で表示。
         dc-cursor-active が無いと、dev mode ON 直後やプレビュー側 mouseleave 後に
         古い位置に線が残らない。 */
      #dc-dev-overlay {
        position: fixed; inset: 0; width: 100%; height: 100%;
        pointer-events: none; display: none; z-index: 8;
      }
      #dc-output-stage.dc-dev-mode.dc-cursor-active #dc-dev-overlay { display: block; }
      #dc-dev-overlay line {
        stroke: #ffffff;
        stroke-width: 1;
        shape-rendering: crispEdges;
      }
      .dc-dev-ui { display: none; }
      #dc-output-stage.dc-dev-mode .dc-dev-ui { display: block; }
      #dc-dev-readout {
        position: fixed; top: 16px; left: 16px; z-index: 10;
        background: rgba(0,0,0,0.6); color: #00ff88;
        border: 1px solid rgba(0, 255, 136, 0.45);
        padding: 6px 10px; border-radius: 4px;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        pointer-events: none;
      }
      #dc-dev-readout .dc-dev-readout-sep { opacity: 0.45; margin: 0 6px; }
    `;
  }

  protected setupEventListeners(): void {
    if (!this.window) return;
    const doc = this.window.document;
    doc.getElementById('dc-output-fs')?.addEventListener('click', () => this.toggleFullscreen());
    const stage = doc.getElementById('dc-output-stage');
    stage?.addEventListener('dblclick', () => this.toggleFullscreen());
    stage?.addEventListener('mousemove', this.boundMouseMove);
    // dev mode 中はマウスがウィンドウ外に出たら操作ウィンドウ側のクロスヘアも消したい
    this.window.addEventListener('mouseout', this.boundMouseOut);
    this.window.addEventListener('blur', this.boundMouseOut);
  }

  private onMessage(e: MessageEvent): void {
    // 親（opener）からのメッセージのみ受け付ける。about:blank の popout は
    // location.origin が 'null' になり得るので origin 比較ではなく source で判定する。
    if (!this.window || e.source !== this.getParentWindow()) return;
    if (e.data?.type === 'state-update') {
      this.setMappings(e.data.data as MappingsState);
    } else if (e.data?.type === 'dev-mode-update') {
      this.setDevMode(!!e.data.enabled);
    } else if (e.data?.type === 'dev-cursor-set') {
      // 操作ウィンドウ側でマウスが動いた → ここに同じ位置のクロスヘアを描く（双方向同期）
      if (!this.devMode) return;
      const xFrac = typeof e.data.xFrac === 'number' ? e.data.xFrac : 0;
      const yFrac = typeof e.data.yFrac === 'number' ? e.data.yFrac : 0;
      const visible = !!e.data.visible;
      if (!visible) { this.hideCrosshair(); return; }
      const w = this.window.innerWidth;
      const h = this.window.innerHeight;
      this.setCrosshairAt(xFrac * w, yFrac * h);
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'f' || e.key === 'F') this.toggleFullscreen();
  }

  /** マッピング設定を受け取り、自身の outputId に紐付く有効なものだけレンダリングする。 */
  setMappings(state: MappingsState | null | undefined): void {
    this.mappings = (state?.mappings ?? []).filter(
      m => isMappingEnabled(m) && m.outputId === this.outputId,
    );
    // 新しい <video> を作ったときだけ親へ stream を要求する（既存の video は bind 済み）。
    // quad/source の微調整だけのときは要求しない（毎フレーム postMessage 往復を避ける）。
    if (this.sync()) this.requestStream();
  }

  /** 子要素を mappings に同期する。新規に <video> を生成したら true（＝ stream の再 bind が必要）。 */
  private sync(): boolean {
    if (!this.window) return false;
    const root = this.window.document.getElementById('dc-output-root');
    if (!root) return false;

    let createdNew = false;
    const seen = new Set<string>();
    for (const m of this.mappings) {
      seen.add(m.id);
      let child = this.children.get(m.id);
      if (!child) {
        const div = this.window.document.createElement('div');
        div.className = 'dc-out-mapping';
        const video = this.window.document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        div.appendChild(video);
        root.appendChild(div);
        child = { div, video };
        this.children.set(m.id, child);
        createdNew = true;
      }
      applyVideoCrop(child.video, m.source);
      applyQuadTransform(child.div, m.quad);
    }
    for (const [id, child] of this.children) {
      if (!seen.has(id)) {
        child.div.remove();
        this.children.delete(id);
      }
    }
    return createdNew;
  }

  /** resize イベントの度に同期実行せず、次フレームに 1 回だけ transform を再計算する。 */
  private scheduleReapply(): void {
    if (this.reapplyRafId !== null || !this.window) return;
    this.reapplyRafId = this.window.requestAnimationFrame(() => {
      this.reapplyRafId = null;
      this.reapplyTransforms();
    });
  }

  private reapplyTransforms(): void {
    for (const m of this.mappings) {
      const child = this.children.get(m.id);
      if (child) applyQuadTransform(child.div, m.quad);
    }
  }

  private requestStream(): void {
    // 親へ「自分（outputId）の stream を bind して」と要求。親側（WindowController.messageHandler）で
    // origin 検証されるので targetOrigin は '*' でよい（popout は about:blank で origin が 'null' に
    // なり得るため）。outputId を載せることで親は対象ウィンドウだけ bind できる。
    try {
      this.getParentWindow()?.postMessage(
        { type: 'output-needs-stream', outputId: this.outputId },
        '*',
      );
    } catch {
      /* ignore */
    }
  }

  private toggleFullscreen(): void {
    if (!this.window) return;
    const doc = this.window.document;
    if (!doc.fullscreenElement) {
      doc.documentElement.requestFullscreen().catch(() => { /* gesture 等で失敗 — F11 で代替可 */ });
    } else {
      doc.exitFullscreen().catch(() => { /* ignore */ });
    }
    // 全画面の出入りでサイズが変わるので少し後に transform を再計算
    this.window.setTimeout(() => this.reapplyTransforms(), 300);
  }

  // --- 開発モード（mapping 枠線 ＋ マウス追従クロスヘア） ---

  private setDevMode(enabled: boolean): void {
    if (this.devMode === enabled || !this.window) return;
    this.devMode = enabled;
    const stage = this.window.document.getElementById('dc-output-stage');
    stage?.classList.toggle('dc-dev-mode', enabled);
    if (!enabled) {
      // OFF にしたら crosshair を非表示にし、操作ウィンドウ側のミラーも消す
      this.hideCrosshair();
      this.sendCursorEvent(false, 0, 0);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    this.wakeUp();
    if (!this.devMode || !this.window) return;
    this.setCrosshairAt(e.clientX, e.clientY);
    // 操作ウィンドウのプレビューにミラー
    const w = this.window.innerWidth;
    const h = this.window.innerHeight;
    const xFrac = w > 0 ? e.clientX / w : 0;
    const yFrac = h > 0 ? e.clientY / h : 0;
    this.sendCursorEvent(true, xFrac, yFrac);
  }

  private onMouseOut(e: Event): void {
    if (!this.devMode) return;
    // mouseout は子要素間でも発火するので、本当にウィンドウ外に出た時だけ消す。
    // MouseEvent.relatedTarget が null なら window 外。blur は無条件で消す。
    if (e.type === 'blur') {
      this.hideCrosshair();
      this.sendCursorEvent(false, 0, 0);
      return;
    }
    const me = e as MouseEvent;
    if (me.relatedTarget === null) {
      this.hideCrosshair();
      this.sendCursorEvent(false, 0, 0);
    }
  }

  /**
   * 出力ウィンドウ座標 (px) でクロスヘアを引く。ローカル mousemove と、操作ウィンドウから来た
   * dev-cursor-set の両方の最終共通パス。
   */
  private setCrosshairAt(x: number, y: number): void {
    if (!this.window) return;
    const doc = this.window.document;
    const w = this.window.innerWidth;
    const h = this.window.innerHeight;
    const hLine = doc.getElementById('dc-dev-crosshair-h');
    const vLine = doc.getElementById('dc-dev-crosshair-v');
    if (hLine) {
      hLine.setAttribute('x1', '0');
      hLine.setAttribute('x2', String(w));
      hLine.setAttribute('y1', String(y));
      hLine.setAttribute('y2', String(y));
    }
    if (vLine) {
      vLine.setAttribute('x1', String(x));
      vLine.setAttribute('x2', String(x));
      vLine.setAttribute('y1', '0');
      vLine.setAttribute('y2', String(h));
    }
    this.updateDevReadout({ x, y, w, h });
    doc.getElementById('dc-output-stage')?.classList.add('dc-cursor-active');
  }

  /** クロスヘアと readout を非表示・初期化。 */
  private hideCrosshair(): void {
    if (!this.window) return;
    const doc = this.window.document;
    doc.getElementById('dc-output-stage')?.classList.remove('dc-cursor-active');
    this.updateDevReadout(null);
  }

  /** 親（WindowController）へカーソル位置を中継。inline panel が devCursor Emitter で受ける。 */
  private sendCursorEvent(visible: boolean, xFrac: number, yFrac: number): void {
    try {
      this.getParentWindow()?.postMessage(
        { type: 'dev-cursor', outputId: this.outputId, xFrac, yFrac, visible },
        '*',
      );
    } catch {
      /* ignore */
    }
  }

  private updateDevReadout(pos: { x: number; y: number; w: number; h: number } | null): void {
    if (!this.window) return;
    const doc = this.window.document;
    const px = doc.getElementById('dc-dev-readout-px');
    const pct = doc.getElementById('dc-dev-readout-pct');
    if (!px || !pct) return;
    if (!pos) { px.textContent = '—'; pct.textContent = '—'; return; }
    px.textContent = `${Math.round(pos.x)}, ${Math.round(pos.y)} px`;
    const xp = pos.w > 0 ? (pos.x / pos.w) * 100 : 0;
    const yp = pos.h > 0 ? (pos.y / pos.h) * 100 : 0;
    pct.textContent = `${xp.toFixed(1)}, ${yp.toFixed(1)} %`;
  }

  // --- マウス無操作で UI・カーソルを隠す ---

  private scheduleIdle(): void {
    if (!this.window) return;
    if (this.idleTimer !== null) this.window.clearTimeout(this.idleTimer);
    this.idleTimer = this.window.setTimeout(() => {
      this.window?.document.getElementById('dc-output-stage')?.classList.add('dc-idle');
    }, 2500);
  }

  private wakeUp(): void {
    this.window?.document.getElementById('dc-output-stage')?.classList.remove('dc-idle');
    this.scheduleIdle();
  }

  private teardown(): void {
    if (this.idleTimer !== null && this.window) this.window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.reapplyRafId !== null && this.window) this.window.cancelAnimationFrame(this.reapplyRafId);
    this.reapplyRafId = null;
    this.wakeLock?.release();
    this.wakeLock = null;
    this.children.clear();
  }
}
