import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocked,
  isMappingEntry,
  isMaskEntry,
  lockedItemsOnOutput,
  outputRemovalBlock,
  parseMappingsState,
  withDuplicatedItem,
  withItemLockSet,
  withMaskPointsSet,
  withOutputLayoutSet,
  withOutputLockSet,
  withRemovedMapping,
  withRemovedOutput,
} from '../src/viewer/utils/mappingTransform.ts';
import { EditHistory, cloneMappingsState, hasNoDraftingMask, mappingsHistoryKey } from '../src/viewer/utils/editHistory.ts';
import { createProject, parseProject, portableProject } from '../src/viewer/practice/project.ts';

// 面・マスク・出力の編集ロック (#190)。ロック中は幾何の編集・リセット・削除を受け付けず、
// 選択・名前変更・表示 ON/OFF・解除は受け付ける。保存形式は MappingsState v2 の任意フィールド `locked`。
// 期待値は手で書いた座標・id で、実装の計算を呼び直さない。

const W = 1920;
const H = 1080;
const out = (id, x, y = 0) => ({ id, name: id, position: { x, y }, size: { width: W, height: H } });
const face = (id, x, y, extra = {}) => ({
  id, name: id, source: { x: 10, y: 20, width: 50, height: 40 },
  quad: { topLeft: { x, y }, topRight: { x: x + 400, y }, bottomRight: { x: x + 400, y: y + 300 }, bottomLeft: { x, y: y + 300 } },
  ...extra,
});
const mask = (id, x, y, extra = {}) => ({ kind: 'mask', id, name: id, points: [{ x, y }, { x: x + 100, y }, { x: x + 50, y: y + 80 }], ...extra });
/** @returns {import('../src/viewer/utils/mappingTransform.ts').MappingsState} */
const stateOf = (outputs, mappings) => ({
  version: 2, canvas: { width: outputs.length * W, height: H }, outputs, mappings, activeId: mappings[0].id,
});
const json = (value) => JSON.parse(JSON.stringify(value));
/** 面であることを確かめて型を絞る。 @param {import('../src/viewer/utils/mappingTransform.ts').MappingItem | undefined} item */
const asMapping = (item) => { assert.ok(item && isMappingEntry(item), 'the item is a mapping'); return item; };
/** マスクであることを確かめて型を絞る。 @param {import('../src/viewer/utils/mappingTransform.ts').MappingItem | undefined} item */
const asMask = (item) => { assert.ok(item && isMaskEntry(item), 'the item is a mask'); return item; };

test('locked は true のときだけロック中', () => {
  assert.equal(isLocked({ locked: true }), true);
  // 保存ファイルの値は型どおりとは限らない (手で編集した JSON など)
  for (const target of /** @type {any[]} */ ([{}, { locked: false }, { locked: 'true' }, { locked: 1 }, undefined])) assert.equal(isLocked(target), false);
});

test('ロックの付け外し: 付けると locked: true、外すとキーごと消え、他の項目と出力はそのまま', () => {
  const before = stateOf([out('o1', 0)], [face('wall', 100, 100), mask('pillar', 600, 200)]);
  const frozen = structuredClone(before);
  const locked = withItemLockSet(before, 'wall', true);
  assert.deepEqual(before, frozen, 'the input state is not mutated');
  assert.deepEqual(locked.mappings[0], { ...face('wall', 100, 100), locked: true });
  assert.equal(locked.mappings[1], before.mappings[1], 'other items keep their identity');
  assert.equal(locked.activeId, before.activeId, 'locking keeps the selection');
  const unlocked = withItemLockSet(locked, 'wall', false);
  assert.deepEqual(unlocked.mappings[0], face('wall', 100, 100));
  assert.ok(!('locked' in unlocked.mappings[0]), 'unlocking removes the key (no locked: false in saved files)');

  const maskLocked = withItemLockSet(before, 'pillar', true);
  assert.deepEqual(maskLocked.mappings[1], { ...mask('pillar', 600, 200), locked: true });

  const outLocked = withOutputLockSet(before, 'o1', true);
  assert.deepEqual(outLocked.outputs[0], { ...out('o1', 0), locked: true });
  assert.ok(!('locked' in withOutputLockSet(outLocked, 'o1', false).outputs[0]));
});

test('ロックの付け外し: 変化なし・該当なし・描画中のマスクは同じ state を返す', () => {
  const drafting = mask('draft', 0, 0, { drafting: true });
  const before = stateOf([out('o1', 0)], [face('wall', 100, 100), drafting]);
  assert.equal(withItemLockSet(before, 'wall', false), before, 'already unlocked');
  assert.equal(withItemLockSet(before, 'missing', true), before);
  assert.equal(withItemLockSet(before, 'draft', true), before, 'a mask being drawn is never locked');
  assert.equal(withOutputLockSet(before, 'o1', false), before);
  assert.equal(withOutputLockSet(before, 'missing', true), before);
});

test('ロック中の面・マスクは削除できない。解除すれば削除できる', () => {
  const before = withItemLockSet(stateOf([out('o1', 0)], [face('wall', 100, 100), mask('pillar', 600, 200)]), 'wall', true);
  assert.equal(withRemovedMapping(before, 'wall'), before, 'a locked mapping is kept');
  const maskLocked = withItemLockSet(before, 'pillar', true);
  assert.equal(withRemovedMapping(maskLocked, 'pillar'), maskLocked, 'a locked mask is kept');
  assert.deepEqual(withRemovedMapping(before, 'pillar').mappings.map(m => m.id), ['wall'], 'an unlocked item is removed');
  const unlocked = withItemLockSet(before, 'wall', false);
  assert.deepEqual(withRemovedMapping(unlocked, 'wall').mappings.map(m => m.id), ['pillar'], 'after unlocking it is removed');
});

test('ロック中のマスクの頂点は差し替えない', () => {
  const before = withItemLockSet(stateOf([out('o1', 0)], [mask('pillar', 600, 200)]), 'pillar', true);
  assert.equal(withMaskPointsSet(before, 'pillar', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }]), before);
  const unlocked = withItemLockSet(before, 'pillar', false);
  assert.deepEqual(asMask(withMaskPointsSet(unlocked, 'pillar', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }]).mappings[0]).points,
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }]);
});

test('ロック中の出力の位置・大きさは数値入力でも変わらない', () => {
  const before = withOutputLockSet(stateOf([out('o1', 0), out('o2', W)], [face('wall', 100, 100)]), 'o2', true);
  assert.equal(withOutputLayoutSet(before, 'o2', { position: { x: 4000, y: 50 } }), before);
  assert.equal(withOutputLayoutSet(before, 'o2', { size: { width: 1280, height: 720 } }), before);
  assert.deepEqual(withOutputLayoutSet(before, 'o1', { size: { width: 1280, height: 720 } }).outputs[0].size, { width: 1280, height: 720 },
    'an unlocked output still moves');
});

test('出力を削除できない理由: 最後の 1 台・出力のロック・ロック中の項目が乗っている', () => {
  // o1 [0,1920) に wall (ロック)、o2 [1920,3840) に何も無い、o3 [3840,5760) に pillar (未ロック)
  const base = stateOf([out('o1', 0), out('o2', W), out('o3', 2 * W)], [face('wall', 100, 100), mask('pillar', 4000, 200)]);
  const state = withItemLockSet(base, 'wall', true);
  assert.equal(outputRemovalBlock(state, 'o1'), 'carriesLockedItem');
  assert.deepEqual(lockedItemsOnOutput(state, 'o1'), ['wall']);
  assert.equal(outputRemovalBlock(state, 'o2'), null);
  assert.equal(outputRemovalBlock(state, 'o3'), null, 'an unlocked item does not block');
  assert.equal(outputRemovalBlock(withOutputLockSet(state, 'o2', true), 'o2'), 'outputLocked');
  assert.equal(outputRemovalBlock(stateOf([out('o1', 0)], [face('wall', 100, 100)]), 'o1'), 'lastOutput');
  assert.equal(outputRemovalBlock(state, 'missing'), null);
  // 辺が接しているだけ (o1 の右端 x=1920 から始まる面) は乗っているとみなさない
  const touching = withItemLockSet(stateOf([out('o1', 0), out('o2', W)], [face('edge', W, 100)]), 'edge', true);
  assert.deepEqual(lockedItemsOnOutput(touching, 'o1'), []);
  assert.deepEqual(lockedItemsOnOutput(touching, 'o2'), ['edge']);
  // 2 台にまたがるロック中の面は、どちらの出力の削除も止める
  const spanning = withItemLockSet(stateOf([out('o1', 0), out('o2', W)], [face('wide', 1700, 100)]), 'wide', true);
  assert.equal(outputRemovalBlock(spanning, 'o1'), 'carriesLockedItem');
  assert.equal(outputRemovalBlock(spanning, 'o2'), 'carriesLockedItem');
});

test('ロック中の面・マスクが乗っている出力・ロック中の出力は削除されず、解除すると削除できる', () => {
  const base = stateOf([out('o1', 0), out('o2', W)], [face('wall', 2100, 100), mask('pillar', 300, 300)]);
  const carrying = withItemLockSet(base, 'wall', true);
  assert.equal(withRemovedOutput(carrying, 'o2'), carrying, 'removing would move the locked wall onto o1');
  const maskCarrying = withItemLockSet(base, 'pillar', true);
  assert.equal(withRemovedOutput(maskCarrying, 'o1'), maskCarrying, 'a locked mask blocks too');
  const outputLocked = withOutputLockSet(base, 'o2', true);
  assert.equal(withRemovedOutput(outputLocked, 'o2'), outputLocked, 'a locked output is kept');

  const unlocked = withItemLockSet(carrying, 'wall', false);
  const removed = withRemovedOutput(unlocked, 'o2');
  assert.deepEqual(removed.outputs.map(o => o.id), ['o1'], 'after unlocking the output is removed');
  // 取り残された wall は o2 の中での位置 (180, 100) のまま o1 へ移る (ADR 0008)
  assert.deepEqual(asMapping(removed.mappings[0]).quad.topLeft, { x: 180, y: 100 });
});

test('ロック中の項目が乗っていない出力の削除: ロック中の面・マスク・出力は平行移動するだけで、出力から見た位置は変わらない', () => {
  // o1 [0,1920) を削除。o2 [1920,3840) にロック中の wall (2100,100)、ロック中の pillar (3000,200)、o2 自体もロック。
  let state = stateOf([out('o1', 0), out('o2', W)], [face('wall', 2100, 100), mask('pillar', 3000, 200), face('free', 500, 500)]);
  state = withItemLockSet(withItemLockSet(withOutputLockSet(state, 'o2', true), 'wall', true), 'pillar', true);
  assert.equal(outputRemovalBlock(state, 'o1'), null);
  const removed = withRemovedOutput(state, 'o1');
  assert.deepEqual(removed.outputs, [{ ...out('o2', 0), locked: true }], 'o2 slides to the origin and stays locked');
  const wall = asMapping(removed.mappings.find(m => m.id === 'wall')), pillar = asMask(removed.mappings.find(m => m.id === 'pillar'));
  // o2 の左上から見た位置: wall (180, 100)、pillar (1080, 200) — 削除前と同じ
  assert.deepEqual(wall.quad, face('wall', 180, 100).quad);
  assert.deepEqual(pillar.points, mask('pillar', 1080, 200).points);
  assert.equal(wall.locked, true); assert.equal(pillar.locked, true);
});

test('ロックした項目を複製すると、複製はロックされず、元はロックのまま', () => {
  const before = withItemLockSet(stateOf([out('o1', 0)], [face('wall', 100, 100), mask('pillar', 600, 200)]), 'wall', true);
  const dup = withDuplicatedItem(before, 'wall', 'wall copy');
  const copy = dup.mappings[0];
  assert.equal(copy.name, 'wall copy');
  assert.ok(!('locked' in copy), 'the copy is not locked');
  assert.equal(dup.mappings[1].locked, true, 'the original stays locked');
  const maskDup = withDuplicatedItem(withItemLockSet(before, 'pillar', true), 'pillar', 'pillar copy');
  assert.ok(!('locked' in maskDup.mappings[maskDup.mappings.findIndex(m => m.id === maskDup.activeId)]), 'a locked mask gives an unlocked copy');
});

test('読み込み: locked: true の面・マスク・出力はロックのまま、無い・true 以外は未ロック、描画中のマスクはロックしない', () => {
  const file = {
    version: 2, canvas: { width: 2 * W, height: H }, activeId: 'wall',
    outputs: [{ ...out('o1', 0), locked: true }, { ...out('o2', W), locked: 'yes' }],
    mappings: [
      face('wall', 100, 100, { locked: true }), mask('pillar', 600, 200, { locked: true }),
      face('old', 200, 200), face('odd', 300, 300, { locked: 1 }), mask('draft', 10, 10, { drafting: true, locked: true }),
    ],
  };
  const parsed = parseMappingsState(json(file));
  assert.ok(parsed);
  assert.deepEqual(parsed.outputs.map(o => isLocked(o)), [true, false]);
  assert.deepEqual(parsed.mappings.map(m => [m.id, isLocked(m)]), [['wall', true], ['pillar', true], ['old', false], ['odd', false], ['draft', false]]);
  for (const target of [parsed.outputs[1], ...parsed.mappings.slice(2)]) assert.ok(!('locked' in target), 'unlocked targets carry no locked key');

  // locked の無い既存ファイル (この変更より前に保存したもの) はすべて未ロックで読める
  const legacy = parseMappingsState(json({ ...file, outputs: [out('o1', 0)], mappings: [face('wall', 100, 100), mask('pillar', 600, 200)] }));
  assert.ok(legacy);
  assert.equal([...legacy.outputs, ...legacy.mappings].some(isLocked), false);

  // 書き出し → 読み込みで保たれる
  const again = parseMappingsState(json(parsed));
  assert.deepEqual(json(again), json(parsed));
});

test('プロジェクトの書き出し / 読み込みでロックが保たれる', () => {
  let layout = stateOf([out('o1', 0), out('o2', W)], [face('wall', 100, 100), mask('pillar', 600, 200), face('free', 2100, 100)]);
  layout = withOutputLockSet(withItemLockSet(withItemLockSet(layout, 'wall', true), 'pillar', true), 'o2', true);
  const project = parseProject(json(portableProject(createProject(layout))));
  assert.deepEqual(project.venue.layout.mappings.map(m => [m.id, isLocked(m)]), [['wall', true], ['pillar', true], ['free', false]]);
  assert.deepEqual(project.venue.layout.outputs.map(o => [o.id, isLocked(o)]), [['o1', false], ['o2', true]]);
});

test('ロックと解除はそれぞれ Undo / Redo の 1 件', () => {
  const initial = stateOf([out('o1', 0)], [face('wall', 100, 100)]);
  const history = new EditHistory(initial, { clone: cloneMappingsState, key: mappingsHistoryKey, isSettled: hasNoDraftingMask });
  const locked = withItemLockSet(initial, 'wall', true);
  assert.equal(history.settle(locked), true, 'locking is recorded');
  const outLocked = withOutputLockSet(locked, 'o1', true);
  assert.equal(history.settle(outLocked), true, 'locking an output is recorded');
  assert.equal(history.undoSize, 2);
  const undone = history.undo(outLocked);
  assert.deepEqual(undone, locked);
  const undone2 = history.undo(undone);
  assert.deepEqual(undone2, initial);
  assert.deepEqual(history.redo(undone2), locked);
});
