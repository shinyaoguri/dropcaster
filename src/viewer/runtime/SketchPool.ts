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

/** A resolved remote sketch uses srcdoc; gallery sketches keep their existing URL path. */
export type PoolSource = string | { srcdoc: string; tag: string };
const matches = (frame: SketchFrame, source: PoolSource) => typeof source === 'string'
  ? frame.currentUrl === source : frame.currentTag === source.tag;
const load = (frame: SketchFrame, source: PoolSource) => typeof source === 'string'
  ? frame.load(source) : frame.loadSrcdoc(source.srcdoc, { tag: source.tag });

export class SketchPool {
  private readonly frames: SketchFrame[];
  private visibleFrame: SketchFrame | null = null;
  /**
   * 先読みの読み込み先にしてよい frame。非表示になった順の並び（先頭ほど古い ＝ 再利用候補）。
   * 表示中・フェードアウト中・show が読み込み先に取った frame は入れない（#208）。
   */
  private idleOrder: SketchFrame[];
  /** 表示待ちの show が読み込み先に取っている frame。その show が表示するか、後続の show が来るまで保つ。 */
  private claimedFrame: SketchFrame | null = null;
  /**
   * フェードアウト中の frame と、フェード完了後にそれを idle へ戻すタイマー。
   * 項目がある間、その frame はまだ見えている。表示待ちの show が取っても、フェードが終わるまでは残す。
   */
  private readonly fadeTimers = new Map<SketchFrame, number>();
  private destroyed = false;
  /** クロスフェード中に呼ばれた preload を保留しておき、遷移完了後にまとめて実行する。 */
  private pendingPreloadUrl: PoolSource | null = null;
  private showGeneration = 0;

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
  async show(url: PoolSource): Promise<SketchFrame> {
    if (this.destroyed) throw new Error('SketchPool is destroyed');
    const generation = ++this.showGeneration;
    // 先行する表示待ちはここで取り消される。その frame は、読み込みを終えた時点で idle に戻る（下の分岐）
    this.claimedFrame = null;
    // 保留中の先読みは、前の位置から見た「次の作品」。表示する作品が変わるので捨てる。
    // 残すと、後のフェード完了で流れて、正しく先読みした作品を追い出す。呼び出し側は表示のあとで preload し直す
    this.pendingPreloadUrl = null;

    let target = this.frames.find(f => matches(f, url)) ?? null;

    if (target && target === this.visibleFrame) {
      return target; // すでに表示中
    }

    if (!target) {
      target = this.takeIdleFrame();
      this.claim(target);
      await load(target, url);
    } else {
      this.claim(target);
      await target.ready; // 先読み中ならその完了を待つ
    }
    if (this.destroyed) return target;
    if (generation !== this.showGeneration) {
      // 待つ間に後続の show が来て、この表示は取り消された。表示されないまま読み込みを終えた frame は
      // 先読みと同じく止めて待つ（#172）。同じ作品を待つ後続の show があれば、そちらが resume する。
      if (target !== this.visibleFrame && matches(target, url)) {
        target.pause();
        // 後続の show が取り直しておらず、フェードアウト中でもなければ、先読み済みの frame として idle に戻し、
        // 空きを待っていた先読みを流す。フェードアウト中なら、フェード完了のタイマーが同じことをする
        if (target !== this.claimedFrame && !this.fadeTimers.has(target)) {
          this.markIdle(target);
          this.flushPendingPreload();
        }
      }
      return target;
    }
    this.claimedFrame = null;
    this.clearFade(target); // 表示するので、もうフェードアウト中ではない

    const previous = this.visibleFrame;
    target.setVisible(true);
    target.resume();
    this.visibleFrame = target;

    if (previous && previous !== target) {
      previous.setVisible(false);
      // フェードアウト中は previous をまだ idle 扱いしない。idle 化すると直後の preload で
      // previous の iframe.src が書き換わり、まだ opacity が残っているフレームのコンテンツが
      // 切り替わって一瞬チラつくため（next 方向で目立つ）。遷移完了後に idle 化・pause し、
      // この間に保留されていた preload があればここでまとめて実行する。
      this.clearFade(previous);
      this.fadeTimers.set(previous, window.setTimeout(() => {
        this.fadeTimers.delete(previous);
        // 表示待ちの show が読み込み先に取っている間は idle に戻さない。戻すと、保留していた先読みが
        // 待っている作品とは別の作品をそこへ読み込み、それが表示される（#208）。
        // その show が表示するか、取り消されて読み込みを終えた時点で扱う
        if (previous === this.claimedFrame) return;
        this.markIdle(previous);
        previous.pause();
        this.flushPendingPreload();
      }, TRANSITION_MS + 50));
    }
    return target;
  }

  /**
   * 指定 URL を非表示の frame に先読みしておく（次の show が即座になる）。読み込み後は一時停止して待つ。
   * すでにどこかに読み込み済みなら何もしない。
   */
  preload(url: PoolSource): void {
    if (this.destroyed) return;
    if (this.frames.some(f => matches(f, url))) {
      // 頼まれた作品はもう読み込んである。それより前に保留した先読みは古いので捨てる
      this.pendingPreloadUrl = null;
      return;
    }
    const idle = this.idleOrder.find(f => f !== this.visibleFrame) ?? null;
    if (!idle) {
      // クロスフェード中で idle 扱いの frame が無い。遷移完了後に show() が flush する。
      this.pendingPreloadUrl = url;
      return;
    }
    this.pendingPreloadUrl = null;
    void load(idle, url).then(() => {
      // 先読みは読み込みまでで止め、表示する時に show() の resume() で再開する（#172）。
      // 新しい document では以前の pause が消えているので、読み込みのたびに止め直す。
      // 待つ間に表示された・別の作品に差し替えられた frame は止めない。
      if (this.destroyed || idle === this.visibleFrame || !matches(idle, url)) return;
      idle.pause();
    }).catch(() => { /* 先読みの失敗は握りつぶす（show 時に再試行される） */ });
  }

  private flushPendingPreload(): void {
    const url = this.pendingPreloadUrl;
    if (!url) return;
    this.pendingPreloadUrl = null;
    this.preload(url);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingPreloadUrl = null;
    for (const timer of this.fadeTimers.values()) clearTimeout(timer);
    this.fadeTimers.clear();
    for (const frame of this.frames) frame.dispose();
    this.frames.length = 0;
    this.idleOrder.length = 0;
    this.visibleFrame = null;
    this.claimedFrame = null;
  }

  // --- idle frame（非表示の frame）の LRU 管理 ---

  /**
   * show の読み込み先を選ぶ。いちばん長く非表示だった idle frame。無ければ、表示中でない frame
   * （フェードアウト中、または取り消された show が読み込み中のもの）を使う。
   */
  private takeIdleFrame(): SketchFrame {
    const idle =
      this.idleOrder.find(f => f !== this.visibleFrame) ??
      this.frames.find(f => f !== this.visibleFrame);
    if (!idle) throw new Error('SketchPool: no idle frame available'); // size>=2 のため通常起こらない
    return idle;
  }

  /**
   * frame を表示待ちの show の読み込み先として確保する。確保した frame は先読みに渡さず、
   * フェード完了のタイマーも idle に戻さない（#208）。
   */
  private claim(frame: SketchFrame): void {
    this.markBusy(frame);
    this.claimedFrame = frame;
  }

  private clearFade(frame: SketchFrame): void {
    const timer = this.fadeTimers.get(frame);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.fadeTimers.delete(frame);
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
