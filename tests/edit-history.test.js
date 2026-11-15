import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditHistory, mappingsHistoryKey, hasNoDraftingMask, cloneMappingsState,
} from '../src/viewer/utils/editHistory.ts';

/** MappingsState と同じ形の小さな状態。x がジオメトリ、activeId が選択の代わり。 */
function makeState(x = 0, extra = {}) {
  return { mappings: [{ id: 'a', x }, { id: 'b', x: 0 }], activeId: 'a', activeOutputId: 'o1', ...extra };
}

function makeHistory(initial, limit) {
  return new EditHistory(initial, {
    clone: cloneMappingsState, key: mappingsHistoryKey, isSettled: hasNoDraftingMask, limit,
  });
}

test('確定した変更を 1 件積み、undo で前の状態・redo で後の状態を返す', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  state.mappings[0].x = 5;
  assert.equal(h.settle(state), true);
  assert.equal(h.canUndo, true);
  const undone = h.undo(state);
  assert.equal(undone.mappings[0].x, 0);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  const redone = h.redo(undone);
  assert.equal(redone.mappings[0].x, 5);
  assert.equal(h.canRedo, false);
});

test('その場で書き換えられても積んだスナップショットは変わらない', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  state.mappings[0].x = 5;
  h.settle(state);
  state.mappings[0].x = 99; // 同じ参照をさらに書き換える (ドラッグ中の in-place mutation)
  h.settle(state);
  assert.equal(h.undo(state).mappings[0].x, 5);
  assert.equal(h.undo(state).mappings[0].x, 0);
});

test('ジェスチャ中の多数の settle は終了時の 1 件にまとまる', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  h.beginGesture();
  for (let i = 1; i <= 30; i++) {
    state.mappings[0].x = i;
    assert.equal(h.settle(state), false);
  }
  assert.equal(h.canUndo, false);
  assert.equal(h.undo(state), null, 'ジェスチャ中は Undo しない');
  assert.equal(h.endGesture(state), true);
  assert.equal(h.undoSize, 1);
  assert.equal(h.undo(state).mappings[0].x, 0);
});

test('入れ子のジェスチャは最も外側が閉じたときだけ積む', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  h.beginGesture();
  h.beginGesture();
  state.mappings[0].x = 3;
  assert.equal(h.endGesture(state), false);
  assert.equal(h.endGesture(state), true);
  assert.equal(h.undoSize, 1);
  assert.equal(h.endGesture(state), false, '開いていない endGesture は何もしない');
});

test('選択だけの変化は積まない', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  assert.equal(h.settle({ ...cloneMappingsState(state), activeId: 'b', activeOutputId: 'o2' }), false);
  assert.equal(h.canUndo, false);
});

test('Undo すると変更したときの選択に戻る', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  state.mappings[0].x = 5;
  h.settle(state);
  const later = { ...cloneMappingsState(state), activeId: 'b' };
  h.settle(later);
  assert.equal(h.undo(later).activeId, 'a');
});

test('値の変わらない確定は積まない', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  assert.equal(h.settle(state), false);
  h.beginGesture();
  state.mappings[0].x = 4;
  state.mappings[0].x = 0; // 動かして元の位置に戻した
  assert.equal(h.endGesture(state), false);
  assert.equal(h.canUndo, false);
});

test('Undo 後に新しい編集をすると redo が消える', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  state.mappings[0].x = 5;
  h.settle(state);
  const undone = h.undo(state);
  assert.equal(h.canRedo, true);
  undone.mappings[0].x = 7;
  h.settle(undone);
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(undone).mappings[0].x, 0);
});

test('Undo で戻した状態をそのまま確定しても履歴は増えない', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  state.mappings[0].x = 5;
  h.settle(state);
  const undone = h.undo(state);
  assert.equal(h.settle(undone), false, 'replaceState → commit で同じ状態が戻ってくる');
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
});

test('上限を超えると古い履歴から捨てる', () => {
  const state = makeState(0);
  const h = makeHistory(state, 100);
  for (let i = 1; i <= 101; i++) {
    state.mappings[0].x = i;
    h.settle(state);
  }
  assert.equal(h.undoSize, 100);
  let cur = state;
  for (let i = 0; i < 100; i++) cur = h.undo(cur);
  assert.equal(cur.mappings[0].x, 1, '最初の 0 → 1 の変更は捨てられている');
  assert.equal(h.undo(cur), null);
});

test('ペン描画中は積まず、描き終えたときに開始前との差分を 1 件積む', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  const drafting = cloneMappingsState(state);
  drafting.mappings.unshift({ id: 'k', points: [], drafting: true });
  assert.equal(h.settle(drafting), false);
  drafting.mappings[0].points.push({ x: 1, y: 1 });
  assert.equal(h.settle(drafting), false);
  assert.equal(h.undo(drafting), null, '描画中は Undo しない');
  drafting.mappings[0].drafting = false;
  assert.equal(h.settle(drafting), true);
  assert.equal(h.undoSize, 1);
  const undone = h.undo(drafting);
  assert.deepEqual(undone.mappings.map(m => m.id), ['a', 'b']);
});

test('ペン描画を破棄すると履歴は増えない', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  const drafting = cloneMappingsState(state);
  drafting.mappings.unshift({ id: 'k', points: [{ x: 1, y: 1 }], drafting: true });
  h.settle(drafting);
  assert.equal(h.settle(cloneMappingsState(state)), false);
  assert.equal(h.canUndo, false);
});

test('reset は履歴を空にし、その状態を基準にする', () => {
  const state = makeState(0);
  const h = makeHistory(state);
  state.mappings[0].x = 5;
  h.settle(state);
  h.beginGesture();
  const loaded = makeState(42);
  h.reset(loaded);
  assert.equal(h.canUndo, false);
  assert.equal(h.inGesture, false);
  assert.equal(h.settle(loaded), false);
});
