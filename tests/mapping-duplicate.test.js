import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORNER_KEYS,
  DUPLICATE_OFFSET_PX,
  constrainQuadCorner,
  generateMappingId,
  isConvexQuad,
  isMappingEntry,
  isMaskEntry,
  parseMappingsState,
  quadHomography,
  withDuplicatedItem,
} from '../src/viewer/utils/mappingTransform.ts';
import { EditHistory, cloneMappingsState, hasNoDraftingMask, mappingsHistoryKey } from '../src/viewer/utils/editHistory.ts';
import { createProject, parseProject, portableProject } from '../src/viewer/practice/project.ts';

// 面・マスクの複製 (#191)。複製は元のすぐ前面に、右下へ 20px ずらして置き、複製した側を選択する。
// 期待値は手で書いた座標で、実装の平行移動を呼び直さない。

const output = { id: 'o1', name: 'Output 1', position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } };
// 上辺が短い台形 (キーストーン補正の形)。
const wallQuad = () => ({
  topLeft: { x: 300, y: 200 },
  topRight: { x: 700, y: 220 },
  bottomRight: { x: 760, y: 620 },
  bottomLeft: { x: 240, y: 600 },
});
const wall = () => ({ id: 'wall', name: '左壁', enabled: false, source: { x: 10, y: 20, width: 50, height: 40 }, quad: wallQuad() });
const floor = () => ({
  id: 'floor', name: '床', source: { x: 0, y: 0, width: 100, height: 100 },
  quad: { topLeft: { x: 0, y: 0 }, topRight: { x: 100, y: 0 }, bottomRight: { x: 100, y: 100 }, bottomLeft: { x: 0, y: 100 } },
});
const pillar = () => ({
  kind: /** @type {const} */ ('mask'), id: 'pillar', name: '柱', enabled: false,
  // 凹んだ多角形 (マスクは凹形を許す)。
  points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 150 }, { x: 300, y: 400 }, { x: 100, y: 400 }],
});
/** @returns {import('../src/viewer/utils/mappingTransform.ts').MappingsState} */
const stateOf = (...mappings) => ({
  version: 2, canvas: { width: 1920, height: 1080 }, outputs: [structuredClone(output)], mappings, activeId: mappings[mappings.length - 1].id,
});
const json = (value) => JSON.parse(JSON.stringify(value));
/** 面であることを確かめて型を絞る。 @param {import('../src/viewer/utils/mappingTransform.ts').MappingItem} item */
const asMapping = (item) => { assert.ok(isMappingEntry(item), 'the item is a mapping'); return item; };
/** マスクであることを確かめて型を絞る。 @param {import('../src/viewer/utils/mappingTransform.ts').MappingItem} item */
const asMask = (item) => { assert.ok(isMaskEntry(item), 'the item is a mask'); return item; };

test('ずらす量は 20px', () => {
  assert.equal(DUPLICATE_OFFSET_PX, 20);
});

test('面の複製は元のすぐ前面に入り、四隅が右下へ 20px ずれ、crop・表示 OFF を引き継ぎ、複製した側が選択される', () => {
  const before = stateOf(floor(), wall(), pillar());
  const frozen = structuredClone(before);
  const after = withDuplicatedItem(before, 'wall', '左壁 のコピー');

  assert.deepEqual(after.mappings.map(m => m.id === after.activeId ? 'COPY' : m.id), ['floor', 'COPY', 'wall', 'pillar']);
  const copy = asMapping(after.mappings[1]);
  assert.ok(!before.mappings.some(m => m.id === copy.id), 'the copy has a new id');
  assert.equal(copy.name, '左壁 のコピー');
  assert.equal(copy.enabled, false);
  assert.deepEqual(copy.source, { x: 10, y: 20, width: 50, height: 40 });
  assert.deepEqual(copy.quad, {
    topLeft: { x: 320, y: 220 },
    topRight: { x: 720, y: 240 },
    bottomRight: { x: 780, y: 640 },
    bottomLeft: { x: 260, y: 620 },
  });
  // 元の state・元の項目・他の項目は変わらない。
  assert.deepEqual(before, frozen);
  assert.deepEqual(after.mappings[2], frozen.mappings[1]);
  assert.deepEqual(after.mappings[0], frozen.mappings[0]);
  assert.deepEqual(after.mappings[3], frozen.mappings[2]);
  assert.deepEqual(after.outputs, frozen.outputs);
  assert.deepEqual(after.canvas, frozen.canvas);
});

test('先頭の項目を複製すると最前面に入る', () => {
  const after = withDuplicatedItem(stateOf(wall(), floor()), 'wall');
  assert.equal(after.mappings.length, 3);
  assert.equal(after.mappings[0].id, after.activeId);
  assert.deepEqual(after.mappings.slice(1).map(m => m.id), ['wall', 'floor']);
});

test('表示 ON の面を複製しても ON のまま。名前を渡さなければ元の名前を引き継ぐ', () => {
  const after = withDuplicatedItem(stateOf(floor()), 'floor');
  const copy = after.mappings[0];
  assert.notEqual(copy.enabled, false);
  assert.equal(copy.name, '床');
});

test('マスクの複製は頂点が右下へ 20px ずれ、表示 OFF を引き継ぎ、描画中にならない', () => {
  const before = stateOf(floor(), pillar());
  const frozen = structuredClone(before);
  const after = withDuplicatedItem(before, 'pillar', '柱 のコピー');

  assert.deepEqual(after.mappings.map(m => m.id === after.activeId ? 'COPY' : m.id), ['floor', 'COPY', 'pillar']);
  const copy = asMask(after.mappings[1]);
  assert.ok(!before.mappings.some(m => m.id === copy.id));
  assert.equal(copy.name, '柱 のコピー');
  assert.equal(copy.enabled, false);
  assert.ok(!copy.drafting);
  assert.deepEqual(copy.points, [{ x: 120, y: 120 }, { x: 320, y: 120 }, { x: 220, y: 170 }, { x: 320, y: 420 }, { x: 120, y: 420 }]);
  assert.deepEqual(before, frozen);
  assert.deepEqual(after.mappings[2], frozen.mappings[1]);
});

test('複製した側をその場で書き換えても、元の四隅・crop・頂点は変わらない', () => {
  // 四隅・crop のドラッグは active な項目の quad / source をその場で書き換える。
  const before = stateOf(wall(), pillar());
  const frozen = structuredClone(before);

  const withWallCopy = withDuplicatedItem(before, 'wall');
  const wallCopy = asMapping(withWallCopy.mappings[0]);
  for (const corner of CORNER_KEYS) { wallCopy.quad[corner].x += 111; wallCopy.quad[corner].y -= 77; }
  wallCopy.source.x = 99; wallCopy.source.width = 1;
  wallCopy.enabled = true; wallCopy.name = 'x';

  const withPillarCopy = withDuplicatedItem(before, 'pillar');
  const pillarCopy = asMask(withPillarCopy.mappings[1]);
  for (const p of pillarCopy.points) { p.x += 5; p.y += 5; }
  pillarCopy.points.push({ x: 0, y: 0 });

  assert.deepEqual(before, frozen);
});

test('無い id・描画中のマスクは複製せず、同じ state を返す', () => {
  const drafting = { kind: /** @type {const} */ ('mask'), id: 'draft', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], drafting: true };
  const state = stateOf(floor(), drafting);
  assert.equal(withDuplicatedItem(state, 'missing'), state);
  assert.equal(withDuplicatedItem(state, 'draft'), state);
});

test('ずらした面は凸のままで、形 (辺のベクトル) が元と同じ。ADR 0007 の限界にある面も隅が動かされない', () => {
  // 上辺と下辺の長さが 20:1 の台形 = 遠近の強さの上限ちょうど。
  const keystone = { topLeft: { x: 475, y: 100 }, topRight: { x: 525, y: 100 }, bottomRight: { x: 1000, y: 500 }, bottomLeft: { x: 0, y: 500 } };
  // 左右に反転した面 (反時計回り) も合法。
  const mirrored = { topLeft: { x: 700, y: 220 }, topRight: { x: 300, y: 200 }, bottomRight: { x: 240, y: 600 }, bottomLeft: { x: 760, y: 620 } };
  for (const { label, quad } of [{ label: '台形', quad: wallQuad() }, { label: '上限の台形', quad: keystone }, { label: '反転', quad: mirrored }]) {
    assert.equal(isConvexQuad(quad), true, `${label}: the fixture is convex`);
    const state = stateOf({ id: 'q', source: { x: 0, y: 0, width: 100, height: 100 }, quad: structuredClone(quad) });
    const copy = asMapping(withDuplicatedItem(state, 'q').mappings[0]);
    assert.equal(isConvexQuad(copy.quad), true, `${label}: the copy is convex`);
    assert.notEqual(quadHomography(copy.quad), null, `${label}: the copy is not degenerate`);
    for (let i = 0; i < 4; i++) {
      const a = CORNER_KEYS[i], b = CORNER_KEYS[(i + 1) % 4];
      assert.equal(copy.quad[b].x - copy.quad[a].x, quad[b].x - quad[a].x, `${label}: edge ${a}→${b} keeps its x extent`);
      assert.equal(copy.quad[b].y - copy.quad[a].y, quad[b].y - quad[a].y, `${label}: edge ${a}→${b} keeps its y extent`);
    }
    // 複製した直後の隅は、隅の移動制限 (凸 + 遠近の強さ) の許す範囲にある = その場に置き直しても動かない。
    for (const corner of CORNER_KEYS) {
      const kept = constrainQuadCorner(copy.quad, corner, copy.quad[corner]);
      assert.ok(Math.hypot(kept.x - copy.quad[corner].x, kept.y - copy.quad[corner].y) < 1e-6, `${label}: ${corner} stays where the copy put it`);
    }
  }
});

test('ID は既存の項目と重ならない (採番が既存の ID に当たっても振り直す)', (t) => {
  // 時刻を止めると、採番は「同じ接頭辞 + 連番」になる。次に出る ID を先に既存の項目へ入れておく。
  mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  t.after(() => mock.timers.reset());
  const probe = generateMappingId();
  const [prefix, counter] = probe.split('_');
  const next = (n) => `${prefix}_${Number(counter) + n}`;
  const state = stateOf({ ...floor(), id: next(1) }, { ...wall(), id: next(2) });
  const after = withDuplicatedItem(state, next(2));
  const ids = after.mappings.map(m => m.id);
  assert.equal(new Set(ids).size, 3, `ids are unique: ${ids.join(', ')}`);
  assert.equal(after.activeId, ids[1]);
});

test('複製を重ねても ID はすべて一意', () => {
  let state = stateOf(wall(), pillar());
  for (let i = 0; i < 10; i++) state = withDuplicatedItem(state, i % 2 ? 'pillar' : 'wall');
  assert.equal(state.mappings.length, 12);
  assert.equal(new Set(state.mappings.map(m => m.id)).size, 12);
});

test('複製した状態は設定 JSON (v2) とプロジェクト (v3) の書き出し・読み込みで保たれ、形式に新しい項目を足さない', () => {
  let state = stateOf(floor(), wall(), pillar());
  state = withDuplicatedItem(state, 'wall', '左壁 のコピー');
  state = withDuplicatedItem(state, 'pillar', '柱 のコピー');

  // 複製した項目のキーは、既存の面・マスクが持つキーの範囲に収まる。
  const keysOf = (item) => Object.keys(json(item)).sort();
  assert.deepEqual(keysOf(state.mappings.find(m => m.name === '左壁 のコピー')), keysOf(wall()));
  assert.deepEqual(keysOf(state.mappings.find(m => m.name === '柱 のコピー')), keysOf(pillar()));

  const reloaded = parseMappingsState(json(state));
  assert.ok(reloaded);
  assert.deepEqual(json(reloaded), json(state));
  assert.equal(reloaded.activeId, state.activeId, 'the settings JSON keeps the copy selected');

  const project = parseProject(json(portableProject(createProject(state))));
  // パッケージは選択を持ち出さない (portableProject が先頭の項目に戻す) ので、項目の中身と順序を比べる。
  assert.deepEqual(json(project.venue.layout.mappings), json(state.mappings));
});

test('複製は Undo / Redo の 1 件で、Redo は同じ ID・順序・選択を戻す', () => {
  const initial = stateOf(floor(), wall(), pillar());
  const history = new EditHistory(initial, { clone: cloneMappingsState, key: mappingsHistoryKey, isSettled: hasNoDraftingMask });
  const duplicated = withDuplicatedItem(initial, 'wall', '左壁 のコピー');
  assert.equal(history.settle(duplicated), true);
  assert.equal(history.undoSize, 1, 'one duplicate is one history entry');

  const undone = history.undo(duplicated);
  assert.deepEqual(undone, initial);
  assert.equal(history.canUndo, false);
  const redone = history.redo(undone);
  assert.deepEqual(redone, duplicated);
  assert.equal(redone.activeId, duplicated.activeId);
});
