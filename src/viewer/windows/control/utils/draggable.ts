/**
 * マウスドラッグの定型処理（mousedown でスナップショット取得 → document mousemove で
 * 増分計算 → mouseup で確定）をくるんだヘルパー。
 *
 * 目的:
 *   - drag 中に発生する document の mousemove / mouseup listener を「mouseup で確実に外す」
 *     パスを 1 か所に集約する。
 *   - 戻り値の dispose() を呼ぶと、進行中の drag があれば onEnd まで走らせて畳むことで、
 *     route 切替（ControlWindow.disposeHost）時に document に listener が残らない。
 *
 * 使い方:
 *   const dispose = draggable(handle, doc, {
 *     onStart(e) { return { initialX: ... }; },
 *     onMove(e, snap) { ... },
 *     onEnd(snap) { ... }, // optional
 *   });
 *   // ...later
 *   dispose();
 *
 * onStart が null を返したらその mousedown はキャンセル（子要素を除外したい場合等）。
 *
 * 第 4 引数 `gesture` (MappingsController) を渡すと、drag 全体を beginGesture / endGesture で
 * 囲む。drag 中に毎フレーム commit しても、Undo の履歴は drag 1 回につき 1 件になる。
 */

export interface DragHooks<TSnap> {
  /** mousedown 時に呼ばれ、drag 全体で共有する snapshot を返す。null を返すと drag をキャンセル。 */
  onStart(e: MouseEvent): TSnap | null;
  /** mousemove ごとに呼ばれる（document スコープ）。 */
  onMove(e: MouseEvent, snap: TSnap): void;
  /** mouseup or 強制 dispose 時に 1 回だけ呼ばれる。 */
  onEnd?(snap: TSnap): void;
}

export type DraggableDispose = () => void;

/** drag 1 回を Undo の 1 操作として囲む相手。 */
export interface DragGesture {
  beginGesture(): void;
  endGesture(): void;
}

export function draggable<TSnap>(
  handle: HTMLElement,
  doc: Document,
  hooks: DragHooks<TSnap>,
  gesture?: DragGesture,
): DraggableDispose {
  /** 現在進行中の drag を畳むためのフック。 */
  let activeFinish: (() => void) | null = null;

  const onMouseDown = (e: MouseEvent) => {
    const snap = hooks.onStart(e);
    if (snap === null) return;
    gesture?.beginGesture();

    const onMove = (ev: MouseEvent) => hooks.onMove(ev, snap);
    const finish = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', finish);
      activeFinish = null;
      try {
        hooks.onEnd?.(snap);
      } finally {
        // onEnd の確定 (LayoutPanel の replaceState 等) まで含めて 1 件にする。
        gesture?.endGesture();
      }
    };

    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', finish);
    activeFinish = finish;
  };

  handle.addEventListener('mousedown', onMouseDown);

  return () => {
    handle.removeEventListener('mousedown', onMouseDown);
    activeFinish?.();
  };
}
