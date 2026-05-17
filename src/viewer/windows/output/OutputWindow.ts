import { BaseWindow } from '../shared/BaseWindow';
import {
  applyQuadCanvas,
  applyVideoCrop,
  isMappingEnabled,
  type MappingEntry,
  type MappingsState,
  type OutputDef,
} from '../../utils/mappingTransform';
import { RafThrottle } from '../../utils/rafThrottle';
import { ScreenWakeLock } from '../../utils/wakeLock';
import { t } from '../../i18n/index.js';

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
  /** 仮想キャンバスの寸法（state.canvas）。初期は 0、setMappings で同期。 */
  private canvasWidth = 0;
  private canvasHeight = 0;
  /** この出力ウィンドウが担当する仮想キャンバス内の矩形（OutputDef.position/size）。 */
  private outputRect: { x: number; y: number; width: number; height: number } | null = null;
  private boundMessage = (e: MessageEvent) => this.onMessage(e);
  private boundResize = () => this.reapplyThrottle?.schedule();
  private boundKeydown = (e: KeyboardEvent) => this.onKeydown(e);
  private boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private boundMouseOut = (e: Event) => this.onMouseOut(e);
  private idleTimer: number | null = null;
  /** 開発モード（mapping 枠線・マウス追従クロスヘア表示）。親から dev-mode-update で push される。 */
  private devMode = false;
  /** resize 由来の transform 再適用を 1 フレーム 1 回へ間引く throttle。initialize で作成。 */
  private reapplyThrottle: RafThrottle | null = null;
  /** 出力ウィンドウのディスプレイ（＝プロジェクタ）をスリープさせないための Screen Wake Lock。 */
  private wakeLock: ScreenWakeLock | null = null;
  /** 自身が担当する出力 id（OutputDef.id）。state.outputs から自分の bounds を引くのに使う。 */
  private readonly outputId: string;

  constructor(outputId: string) {
    super(`output_window_${outputId}`, t('window.projectionOutput'));
    this.outputId = outputId;
  }

  getOutputId(): string { return this.outputId; }

  protected initialize(): void {
    this.render();
    if (!this.window) return;
    try { this.window.document.body.style.background = '#000'; } catch { /* ignore */ }
    this.reapplyThrottle = new RafThrottle(this.window, () => this.reapplyTransforms());
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
        <!-- dc-output-canvas は仮想キャンバスのフル寸法（canvas.width × canvas.height）を
             CSS px で持ち、parent transform で「自身が担当する OutputDef.position+size の
             矩形」だけがウィンドウに映るようスケール・平行移動する。
             この中の .dc-out-mapping は仮想キャンバス px 座標で warp される。 -->
        <div id="dc-output-canvas"></div>
        <svg id="dc-dev-overlay" aria-hidden="true">
          <line id="dc-dev-crosshair-h" x1="0" y1="0" x2="0" y2="0"></line>
          <line id="dc-dev-crosshair-v" x1="0" y1="0" x2="0" y2="0"></line>
        </svg>
        <div id="dc-dev-readout" class="dc-dev-ui" aria-hidden="true">
          <span id="dc-dev-readout-px">—</span>
          <span class="dc-dev-readout-sep">·</span>
          <span id="dc-dev-readout-pct">—</span>
        </div>
        <button id="dc-output-fs" class="dc-output-ui" title="${t('output.fullscreen')}">⛶ ${t('output.fullscreen')}</button>
        <div id="dc-output-hint" class="dc-output-ui">${t('output.hint')}</div>
      </div>
    `;
  }

  protected getStyles(): string {
    return `
      html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
      #dc-output-stage { position: fixed; inset: 0; background: #000; overflow: hidden; }
      /* dc-output-canvas は仮想キャンバス全体（canvas.w × canvas.h を CSS px で）の論理サイズを持ち、
         transform: scale() translate() で「この出力が担当する矩形」がウィンドウ内に収まるよう変換する。
         実 px サイズと位置はランタイム（OutputWindow.applyCanvasTransform）で書き込む。 */
      #dc-output-canvas { position: absolute; top: 0; left: 0; transform-origin: top left; will-change: transform; }
      /* .dc-out-mapping は仮想キャンバスのフル寸法に置かれ、matrix3d で quad（仮想 px）に warp する。
         親（dc-output-canvas）の scale が反映されて最終的に画面に合うサイズになる。 */
      .dc-out-mapping { position: absolute; top: 0; left: 0; overflow: hidden; transform-origin: top left; backface-visibility: hidden; will-change: transform; }
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
      // 他のウィンドウまたはプレビューでマウスが動いた → canvas-space cursor を受け、
      // 自分の bounds に変換してクロスヘアを描く（自出力 bounds の外なら線が窓外に出て見えない）
      if (!this.devMode) return;
      const visible = !!e.data.visible;
      if (!visible) { this.hideCrosshair(); return; }
      const canvasX = typeof e.data.canvasX === 'number' ? e.data.canvasX : 0;
      const canvasY = typeof e.data.canvasY === 'number' ? e.data.canvasY : 0;
      const rect = this.outputRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const localX = (canvasX - rect.x) * (this.window.innerWidth / rect.width);
      const localY = (canvasY - rect.y) * (this.window.innerHeight / rect.height);
      this.setCrosshairAt(localX, localY);
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'f' || e.key === 'F') this.toggleFullscreen();
  }

  /**
   * マッピング設定を受け取り、有効な mapping を描画する。
   *
   * 描画判定は「quad の絶対座標が自出力の bounds と交差するか」のみ。クリップ自体は
   * `#dc-output-stage` の overflow:hidden と canvas-host の transform が自動で行うので、
   * ここでの交差判定は「無関係な mapping の <video> を新規生成しない」性能最適化として
   * のみ機能する（intersect しない mapping は seen に入らないので新規 child が作られない）。
   *
   * ただし intersect 判定は destroy には使わない: 出力レイアウトのドラッグ中に
   * intersect が true↔false で揺れると、毎フレーム child の create/destroy が起きて
   * 親側に stream 再 bind を要求し、出力ウィンドウが黒くフラッシュする。一度作った
   * child は disabled / 削除されるまで維持する。
   */
  setMappings(state: MappingsState | null | undefined): void {
    if (!state) {
      this.mappings = [];
      this.outputRect = null;
      this.canvasWidth = 0;
      this.canvasHeight = 0;
      this.sync();
      return;
    }
    this.canvasWidth = state.canvas.width;
    this.canvasHeight = state.canvas.height;
    const out: OutputDef | undefined = state.outputs.find(o => o.id === this.outputId);
    this.outputRect = out
      ? { x: out.position.x, y: out.position.y, width: out.size.width, height: out.size.height }
      : null;
    const rect = this.outputRect;
    // 有効 mapping のうち「rect と交差する」or「既に child を持っている」ものを残す。
    // 既存 child を維持することで、出力ドラッグ中の intersect 揺れによる destroy/recreate
    // ＝ stream 再 bind 由来の黒フラッシュを防ぐ。
    this.mappings = rect
      ? state.mappings.filter(m =>
          isMappingEnabled(m) && (this.children.has(m.id) || this.quadIntersectsRect(m, rect)),
        )
      : [];
    // 新しい <video> を作ったときだけ親へ stream を要求する（既存の video は bind 済み）。
    // quad/source の微調整だけのときは要求しない（毎フレーム postMessage 往復を避ける）。
    const createdNew = this.sync();
    this.applyCanvasTransform();
    if (createdNew) this.requestStream();
  }

  /** quad の axis-aligned bounding box が rect と交差するかを判定（仮想キャンバス px 同士）。 */
  private quadIntersectsRect(
    m: MappingEntry,
    rect: { x: number; y: number; width: number; height: number },
  ): boolean {
    const xs = [m.quad.topLeft.x, m.quad.topRight.x, m.quad.bottomLeft.x, m.quad.bottomRight.x];
    const ys = [m.quad.topLeft.y, m.quad.topRight.y, m.quad.bottomLeft.y, m.quad.bottomRight.y];
    let minX = xs[0], maxX = xs[0], minY = ys[0], maxY = ys[0];
    for (let i = 1; i < 4; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
    return maxX >= rect.x && minX <= rect.x + rect.width
        && maxY >= rect.y && minY <= rect.y + rect.height;
  }

  /** 子要素を mappings に同期する。新規に <video> を生成したら true（＝ stream の再 bind が必要）。 */
  private sync(): boolean {
    if (!this.window) return false;
    const canvasEl = this.window.document.getElementById('dc-output-canvas');
    if (!canvasEl) return false;

    // canvas エレメント自身を仮想キャンバスのフル寸法に
    canvasEl.style.width = `${this.canvasWidth}px`;
    canvasEl.style.height = `${this.canvasHeight}px`;

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
        canvasEl.appendChild(div);
        child = { div, video };
        this.children.set(m.id, child);
        createdNew = true;
      }
      // mapping div は仮想キャンバスのフル寸法に置く（matrix3d がそこから quad へ写像）
      child.div.style.width = `${this.canvasWidth}px`;
      child.div.style.height = `${this.canvasHeight}px`;
      applyVideoCrop(child.video, m.source);
      applyQuadCanvas(child.div, m.quad, this.canvasWidth, this.canvasHeight);
    }
    for (const [id, child] of this.children) {
      if (!seen.has(id)) {
        child.div.remove();
        this.children.delete(id);
      }
    }
    return createdNew;
  }

  /**
   * 仮想キャンバス全体 (canvasWidth × canvasHeight) を、自身が担当する出力矩形
   * （outputRect = OutputDef.position+size）がウィンドウいっぱいに映るよう scale + translate する。
   * scale: ウィンドウサイズ／出力矩形サイズ。
   * translate: -outputRect.x, -outputRect.y（scale 前に適用される＝translate は untransformed 座標）。
   */
  private applyCanvasTransform(): void {
    if (!this.window) return;
    const canvasEl = this.window.document.getElementById('dc-output-canvas');
    if (!canvasEl) return;
    const rect = this.outputRect;
    if (!rect || rect.width <= 0 || rect.height <= 0 || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      canvasEl.style.transform = 'none';
      return;
    }
    const sx = this.window.innerWidth / rect.width;
    const sy = this.window.innerHeight / rect.height;
    // transform 順序: 文字列右側が先に適用される。 translate(-rect.x, -rect.y) を先に
    // 行ってから scale(sx, sy) する → 結果として「canvas 座標の (rect.x, rect.y) が画面 (0,0)、
    // (rect.x+rect.w, rect.y+rect.h) が画面 (innerWidth, innerHeight) に来る」。
    canvasEl.style.transform = `scale(${sx}, ${sy}) translate(${-rect.x}px, ${-rect.y}px)`;
  }

  private reapplyTransforms(): void {
    // mapping の matrix3d は canvas 寸法に依存するので再計算
    for (const m of this.mappings) {
      const child = this.children.get(m.id);
      if (child) applyQuadCanvas(child.div, m.quad, this.canvasWidth, this.canvasHeight);
    }
    // ウィンドウサイズ変更に応じて canvas scale も再計算
    this.applyCanvasTransform();
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
    // 自分の local px → canvas-space px に変換して親へ通知（親が全出力 + preview に放送）
    const rect = this.outputRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const canvasX = rect.x + e.clientX * (rect.width / this.window.innerWidth);
    const canvasY = rect.y + e.clientY * (rect.height / this.window.innerHeight);
    this.sendCursorEvent(true, canvasX, canvasY);
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

  /**
   * 親（WindowController）へ canvas-space cursor を中継。親は他出力 + preview に放送する。
   * visible=false の時は canvasX/Y は読まれないので 0 で構わない。
   */
  private sendCursorEvent(visible: boolean, canvasX: number, canvasY: number): void {
    try {
      this.getParentWindow()?.postMessage(
        { type: 'dev-cursor', visible, canvasX, canvasY },
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
    this.reapplyThrottle?.cancel();
    this.reapplyThrottle = null;
    this.wakeLock?.release();
    this.wakeLock = null;
    this.children.clear();
  }
}
