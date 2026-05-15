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
  private boundMouseMove = () => this.wakeUp();
  private idleTimer: number | null = null;
  /** resize 由来の transform 再適用を 1 フレーム 1 回へ間引くための rAF id。 */
  private reapplyRafId: number | null = null;
  /** 出力ウィンドウのディスプレイ（＝プロジェクタ）をスリープさせないための Screen Wake Lock。 */
  private wakeLock: ScreenWakeLock | null = null;

  constructor() {
    super('output_window', 'プロジェクション出力');
  }

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
    `;
  }

  protected setupEventListeners(): void {
    if (!this.window) return;
    const doc = this.window.document;
    doc.getElementById('dc-output-fs')?.addEventListener('click', () => this.toggleFullscreen());
    const stage = doc.getElementById('dc-output-stage');
    stage?.addEventListener('dblclick', () => this.toggleFullscreen());
    stage?.addEventListener('mousemove', this.boundMouseMove);
  }

  private onMessage(e: MessageEvent): void {
    // 親（opener）からのメッセージのみ受け付ける。about:blank の popout は
    // location.origin が 'null' になり得るので origin 比較ではなく source で判定する。
    if (!this.window || e.source !== this.getParentWindow()) return;
    if (e.data?.type === 'state-update') {
      this.setMappings(e.data.data as MappingsState);
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'f' || e.key === 'F') this.toggleFullscreen();
  }

  /** マッピング設定を受け取り、有効なものだけレンダリングする。 */
  setMappings(state: MappingsState | null | undefined): void {
    this.mappings = (state?.mappings ?? []).filter(isMappingEnabled);
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
    // 親へ「stream を bind して」と要求。親側（WindowController.messageHandler）で origin 検証されるので
    // ここの targetOrigin は '*' でよい（popout は about:blank で origin が 'null' になり得るため）。
    try {
      this.getParentWindow()?.postMessage({ type: 'output-needs-stream' }, '*');
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
