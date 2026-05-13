/**
 * Screen Wake Lock を「掛けたい間ずっと掛かっている」状態に保つラッパ。
 *
 * Screen Wake Lock の仕様上、ドキュメントが hidden になると sentinel は自動 release され、
 * visible に戻ったときに自分で再取得する必要がある。このクラスは visibilitychange を
 * 監視して再取得を自動でやり、release() するまでベストエフォートで掛け続ける。
 *
 * 対応外ブラウザ（Firefox の一部・古い Safari など）や、document が hidden で取得不可な
 * 状況では黙って no-op（プロジェクション機能を壊さない）。HTTPS / localhost が必要。
 *
 * 使い方:
 *   const lock = new ScreenWakeLock(window);
 *   await lock.acquire(); // 以降、可視中はずっと wake lock を維持
 *   lock.release();       // プロジェクションモードを抜けるとき
 */
type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};
type WakeLockApiLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
};

export class ScreenWakeLock {
  private readonly win: Window;
  private sentinel: WakeLockSentinelLike | null = null;
  /** acquire() されてから release() されるまで true。途中で sentinel が一時的に外れても再取得する。 */
  private wanted = false;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(win: Window) {
    this.win = win;
  }

  /** Wake Lock を取りたい状態にする（可視なら即取得、隠れていれば可視復帰時に取得）。冪等。 */
  async acquire(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    this.win.document.addEventListener('visibilitychange', this.onVisibility);
    await this.tryRequest();
  }

  /** Wake Lock を完全に手放す。冪等。 */
  release(): void {
    if (!this.wanted) return;
    this.wanted = false;
    this.win.document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) {
      s.release().catch(() => { /* ignore */ });
    }
  }

  /** 現在 sentinel を保持しているか（デバッグ／UI 表示用）。 */
  get isActive(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  private async tryRequest(): Promise<void> {
    if (!this.wanted || this.sentinel) return;
    if (this.win.document.visibilityState !== 'visible') return; // hidden では仕様上 reject される
    const api = (this.win.navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock;
    if (!api?.request) return; // 未対応ブラウザ
    try {
      const sentinel = await api.request('screen');
      // race: tryRequest の最中に release() が呼ばれたら即 release する
      if (!this.wanted) {
        sentinel.release().catch(() => { /* ignore */ });
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // permission/policy/visibility などで失敗 — visible 復帰時に再挑戦
    }
  }

  private handleVisibility(): void {
    if (this.win.document.visibilityState === 'visible') {
      void this.tryRequest();
    }
  }
}
