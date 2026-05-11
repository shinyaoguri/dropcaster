// スケッチ iframe の小さなプール。常に 1 枚を「表示中」にし、残りで次のスケッチを先読みしておく。
// これにより、スライドショーの切り替えやギャラリーのフォーカス表示で「黒画面 → CDN ロード →
// setup() → ようやく表示」という待ち時間を消す。プロジェクションマッピングの「ソース」も
// 将来的にはこのプール上の SketchFrame を使う想定（current の canvas を captureStream する）。
//
// 同一オリジン前提（SketchFrame と同様）。

import { SketchFrame } from './SketchFrame.js';

const POOL_STYLE_ID = 'dropcaster-sketch-pool-styles';
const TRANSITION_MS = 400;

function ensurePoolStyles(): void {
  if (document.getElementById(POOL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = POOL_STYLE_ID;
  style.textContent = `
    .dc-sketch-stage { position: relative; width: 100%; height: 100%; overflow: hidden; }
    .dc-sketch-stage > .dc-sketch-frame {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      border: 0;
      display: block;
      opacity: 0;
      z-index: 0;
      pointer-events: none;
      transition: opacity ${TRANSITION_MS}ms ease-in-out;
    }
    .dc-sketch-stage > .dc-sketch-frame.dc-visible {
      opacity: 1;
      z-index: 1;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);
}

export interface SketchPoolOptions {
  /** プールする iframe の枚数（最小 2）。既定 2 = 表示中 1 枚 + 先読み用 1 枚。 */
  size?: number;
}

export class SketchPool {
  private readonly frames: SketchFrame[];
  private visibleFrame: SketchFrame | null = null;
  /** 非表示になった順の並び（先頭ほど古い ＝ 再利用候補）。 */
  private idleOrder: SketchFrame[];
  private destroyed = false;

  /**
   * @param container プールの土俵となる要素。子に iframe を絶対配置で重ねる。
   */
  constructor(container: HTMLElement, options: SketchPoolOptions = {}) {
    ensurePoolStyles();
    container.classList.add('dc-sketch-stage');
    const size = Math.max(2, options.size ?? 2);
    this.frames = Array.from({ length: size }, () => new SketchFrame(container));
    this.idleOrder = [...this.frames];
  }

  /** いま表示中の SketchFrame（まだ何も表示していなければ null） */
  get current(): SketchFrame | null {
    return this.visibleFrame;
  }

  /**
   * 指定 URL のスケッチを表示する。先読み済みなら即座に、未読み込みなら読み込み完了後に表示し、
   * クロスフェードで切り替える。表示後の SketchFrame を返す。
   */
  async show(url: string): Promise<SketchFrame> {
    if (this.destroyed) throw new Error('SketchPool is destroyed');

    let target = this.frames.find(f => f.currentUrl === url) ?? null;

    if (target && target === this.visibleFrame) {
      return target; // すでに表示中
    }

    if (!target) {
      target = this.takeIdleFrame();
      await target.load(url);
    } else {
      await target.ready; // 先読み中ならその完了を待つ
    }
    if (this.destroyed) return target;
    this.markBusy(target);

    const previous = this.visibleFrame;
    target.setVisible(true);
    target.resume();
    this.visibleFrame = target;

    if (previous && previous !== target) {
      previous.setVisible(false);
      this.markIdle(previous);
      // フェードアウト完了後に（p5 なら）一時停止して負荷を下げる
      window.setTimeout(() => {
        if (!this.destroyed && this.visibleFrame !== previous) previous.pause();
      }, TRANSITION_MS + 50);
    }
    return target;
  }

  /** 指定 URL を非表示の frame に先読みしておく（次の show が即座になる）。すでにどこかに読み込み済みなら何もしない。 */
  preload(url: string): void {
    if (this.destroyed) return;
    if (this.frames.some(f => f.currentUrl === url)) return;
    const idle = this.idleOrder.find(f => f !== this.visibleFrame) ?? null;
    if (!idle) return;
    void idle.load(url).catch(() => { /* 先読みの失敗は握りつぶす（show 時に再試行される） */ });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const frame of this.frames) frame.dispose();
    this.frames.length = 0;
    this.idleOrder.length = 0;
    this.visibleFrame = null;
  }

  // --- idle frame（非表示の frame）の LRU 管理 ---

  /** 表示中でない frame のうち、いちばん長く非表示だったものを取り出す。 */
  private takeIdleFrame(): SketchFrame {
    const idle =
      this.idleOrder.find(f => f !== this.visibleFrame) ??
      this.frames.find(f => f !== this.visibleFrame);
    if (!idle) throw new Error('SketchPool: no idle frame available'); // size>=2 のため通常起こらない
    this.markBusy(idle);
    return idle;
  }

  private markBusy(frame: SketchFrame): void {
    const i = this.idleOrder.indexOf(frame);
    if (i !== -1) this.idleOrder.splice(i, 1);
  }

  private markIdle(frame: SketchFrame): void {
    const i = this.idleOrder.indexOf(frame);
    if (i !== -1) this.idleOrder.splice(i, 1);
    this.idleOrder.push(frame); // 末尾 ＝ 最近 idle になった
  }
}
