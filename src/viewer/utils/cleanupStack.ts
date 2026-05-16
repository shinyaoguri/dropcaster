/**
 * panel が attach 中に登録した「離脱時に呼ぶべき関数群」をまとめて管理するスタック。
 *
 * 旧来は各 panel で `private cleanups: Array<() => void> = []` を直に保持していたが、
 * push/runAll パターンが 3 ファイル以上で重複していたので集約した。
 * 1 つの off 関数の中で例外が出ても残りは呼ばれる（try/catch でガード）。
 *
 * `remove` は ColumnResizers のように「drag 終了で finish 関数が listener を自前で外し、
 * 二重呼びを避けるためにスタックから取り除きたい」ケース向けの最小フック。
 */
export class CleanupStack {
  private fns: Array<() => void> = [];

  /** unmount / drag-end 等で呼ぶ後始末関数を登録する。 */
  push(fn: () => void): void {
    this.fns.push(fn);
  }

  /** 指定の fn をスタックから外す（既に手動で呼んだ後など、二重呼びを避けたいとき）。 */
  remove(fn: () => void): void {
    this.fns = this.fns.filter(f => f !== fn);
  }

  /**
   * 登録済み関数をすべて呼んでスタックを空にする。各 fn の例外は飲み込む
   * （後続の cleanup を止めない）。
   */
  runAll(): void {
    const all = this.fns;
    this.fns = [];
    for (const fn of all) {
      try { fn(); } catch { /* ignore — 後続 cleanup を止めないため */ }
    }
  }
}
