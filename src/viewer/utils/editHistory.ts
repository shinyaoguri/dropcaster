/**
 * 編集の Undo / Redo 履歴。
 *
 * 「最後に確定した状態 (baseline)」の複製を持ち、確定 (settle) のたびに現在の状態と比べて
 * 内容が変わっていれば baseline を undo 側へ積む。状態のスナップショットを積む方式なので、
 * 個々の操作を逆算するコマンドを持たない。
 *
 * - ジェスチャ (ドラッグ・矢印キーの連続入力) の間に何度 settle されても積まない。
 *   ジェスチャが終わった時点の 1 回だけ差分を見るので、1 操作 = 1 件になる。
 * - `isSettled` が false の状態 (ペン描画中など、操作の途中) では積まず baseline も動かさない。
 *   操作が終わって settle されたとき、開始前の baseline との差分が 1 件になる。
 * - `key` が同じ (= 選択だけが違う) 変化は積まず、baseline だけ差し替える。
 *
 * Node のテストから直接読めるよう、他のモジュールを import しない。
 */

export interface EditHistoryOptions<T> {
  /** 状態の深い複製。呼び出し側がその場で書き換えても履歴が壊れないようにする。 */
  clone(state: T): T;
  /** 履歴上の同一性を決める文字列。選択など、戻す対象にしない部分は含めない。 */
  key(state: T): string;
  /** 操作の途中ではない (積んでよい) 状態か。省略時は常に true。 */
  isSettled?(state: T): boolean;
  /** undo 側に残す最大件数。超えたら古いものから捨てる。 */
  limit?: number;
}

export const DEFAULT_HISTORY_LIMIT = 100;

export class EditHistory<T> {
  private readonly clone: (state: T) => T;
  private readonly key: (state: T) => string;
  private readonly isSettled: (state: T) => boolean;
  private readonly limit: number;
  private baseline: T;
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private gestureDepth = 0;

  constructor(initial: T, options: EditHistoryOptions<T>) {
    this.clone = options.clone;
    this.key = options.key;
    this.isSettled = options.isSettled ?? (() => true);
    this.limit = Math.max(1, options.limit ?? DEFAULT_HISTORY_LIMIT);
    this.baseline = this.clone(initial);
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoSize(): number { return this.undoStack.length; }
  get redoSize(): number { return this.redoStack.length; }
  /** ジェスチャの途中か。途中の Undo / Redo は受け付けない。 */
  get inGesture(): boolean { return this.gestureDepth > 0; }

  /** 外から別の状態が読み込まれたとき。baseline を差し替え、履歴を空にする。 */
  reset(state: T): void {
    this.baseline = this.clone(state);
    this.undoStack = [];
    this.redoStack = [];
    this.gestureDepth = 0;
  }

  beginGesture(): void {
    this.gestureDepth += 1;
  }

  /** ジェスチャを閉じる。最も外側が閉じたら settle する。戻り値は履歴が変わったか。 */
  endGesture(state: T): boolean {
    if (this.gestureDepth === 0) return false;
    this.gestureDepth -= 1;
    return this.settle(state);
  }

  /**
   * 確定した状態を履歴に反映する。戻り値は undo / redo の件数が変わったか。
   * ジェスチャ中・操作途中の状態では何もしない。
   */
  settle(state: T): boolean {
    if (this.gestureDepth > 0 || !this.isSettled(state)) return false;
    const changed = this.key(state) !== this.key(this.baseline);
    if (changed) {
      this.undoStack.push(this.baseline);
      if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
      this.redoStack = [];
    }
    this.baseline = this.clone(state);
    return changed;
  }

  /** 1 件戻す。戻した先の状態 (複製) を返す。戻せないとき・操作の途中は null。 */
  undo(current: T): T | null {
    return this.step(current, this.undoStack, this.redoStack);
  }

  /** 1 件やり直す。やり直した先の状態 (複製) を返す。やり直せないとき・操作の途中は null。 */
  redo(current: T): T | null {
    return this.step(current, this.redoStack, this.undoStack);
  }

  private step(current: T, from: T[], to: T[]): T | null {
    if (this.gestureDepth > 0 || !this.isSettled(current)) return null;
    const target = from.pop();
    if (target === undefined) return null;
    to.push(this.clone(current));
    this.baseline = target;
    return this.clone(target);
  }
}

// ── MappingsState 用の判定 ───────────────────────────────────────
// mappingTransform を import しないよう、必要な形だけを構造的に書く。

interface HistoryMappingsShape {
  mappings: ReadonlyArray<{ drafting?: boolean }>;
  activeId?: string;
  activeOutputId?: string;
}

/** 選択 (activeId / activeOutputId) を除いた内容の文字列。選択だけの変化を履歴にしない。 */
export function mappingsHistoryKey(state: HistoryMappingsShape): string {
  const { activeId: _activeId, activeOutputId: _activeOutputId, ...content } = state;
  return JSON.stringify(content);
}

/** ペン描画中 (drafting なマスクがある) でなければ true。 */
export function hasNoDraftingMask(state: HistoryMappingsShape): boolean {
  return !state.mappings.some(m => m.drafting === true);
}

export function cloneMappingsState<T>(state: T): T {
  return structuredClone(state);
}
