/**
 * 「同じ更新を 1 フレームに 1 回まで間引く」パターンの薄いラッパ。
 *
 * resize や mousemove 由来の連続イベントで毎回 layout を引きたくないときに、
 * 既存実装は各 panel で同じ `private rafId: number | null = null` を抱えて
 * `if (rafId !== null) return;` + `requestAnimationFrame` を書いていた。
 * その重複を 1 つに集約する小物。
 *
 * 仕様:
 *  - schedule() は既に予約済みなら何もしない（同 frame 内の追加 schedule は no-op）。
 *  - callback 実行後は rafId をクリアして次の schedule を受け付ける。
 *  - cancel() / destroy() は pending を取り消す。pending が無ければ no-op。
 *  - window 参照は constructor 時に固定する（panel が複数 window 跨ぐ実装は無いため）。
 */
export class RafThrottle {
  private rafId: number | null = null;
  private readonly win: Window;
  private readonly callback: () => void;

  constructor(win: Window, callback: () => void) {
    this.win = win;
    this.callback = callback;
  }

  /** 次フレームに callback を 1 回実行することを予約。既に予約済みなら no-op。 */
  schedule(): void {
    if (this.rafId !== null) return;
    this.rafId = this.win.requestAnimationFrame(() => {
      this.rafId = null;
      this.callback();
    });
  }

  /** 予約済みがあれば取り消す（destroy / route 切替時に呼ぶ）。 */
  cancel(): void {
    if (this.rafId === null) return;
    this.win.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
