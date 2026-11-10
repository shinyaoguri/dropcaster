import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRemovedOutput } from '../src/viewer/utils/mappingTransform.ts';

// 出力を削除しても仮想キャンバスが縮まず、マッピング／出力レイアウトに削除した出力の
// 領域が残る (#99)。削除は追加 (右端に 1 台ぶん広げる) の逆操作として、削除した出力が
// 占めていた帯を詰め、取り残された mapping / mask を残った出力へ寄せる。

const W = 1920;
const H = 1080;

const out = (id, x, y, width = W, height = H) => ({
  id,
  name: id,
  position: { x, y },
  size: { width, height },
});

// 矩形 (x, y, w, h) をそのまま quad にした mapping
const mapping = (id, x, y, w = 400, h = 300) => ({
  id,
  source: { x: 0, y: 0, width: 100, height: 100 },
  quad: {
    topLeft: { x, y },
    topRight: { x: x + w, y },
    bottomRight: { x: x + w, y: y + h },
    bottomLeft: { x, y: y + h },
  },
});

const mask = (id, x, y) => ({
  kind: 'mask',
  id,
  points: [{ x, y }, { x: x + 100, y }, { x: x + 50, y: y + 80 }],
});

/** @returns {import('../src/viewer/utils/mappingTransform.ts').MappingsState} */
const state = (outputs, mappings) => ({
  version: 2,
  canvas: { width: 0, height: 0 }, // withRemovedOutput が再計算する
  outputs,
  mappings,
  activeId: mappings[0].id,
});

const find = (s, id) => s.mappings.find(m => m.id === id);
const findOut = (s, id) => s.outputs.find(o => o.id === id);
const topLeftOf = item => (item.kind === 'mask' ? item.points[0] : item.quad.topLeft);

/** item の左上が、指定出力の左上からどれだけ離れているか (出力から見た相対位置) */
const relTo = (s, itemId, outputId) => {
  const p = topLeftOf(find(s, itemId));
  const o = findOut(s, outputId).position;
  return { x: p.x - o.x, y: p.y - o.y };
};

// 横並び 3 台 (x = 0 / 1920 / 3840)。各出力に mapping を 1 つずつ、o3 には mask も置く。
const row3 = () =>
  state(
    [out('o1', 0, 0), out('o2', W, 0), out('o3', 2 * W, 0)],
    [
      mapping('m1', 100, 100),
      mapping('m2', W + 200, 150),
      mapping('m3', 2 * W + 300, 200),
      mask('k3', 2 * W + 500, 400),
    ],
  );

test('右端を削除すると canvas が 2 台ぶんに縮み、残りは動かない (回帰)', () => {
  const s = row3();
  const next = withRemovedOutput(s, 'o3');
  assert.deepEqual(next.canvas, { width: 2 * W, height: H });
  assert.deepEqual(findOut(next, 'o1').position, { x: 0, y: 0 });
  assert.deepEqual(findOut(next, 'o2').position, { x: W, y: 0 });
  assert.deepEqual(topLeftOf(find(next, 'm1')), { x: 100, y: 100 });
  assert.deepEqual(topLeftOf(find(next, 'm2')), { x: W + 200, y: 150 });
});

test('左端を削除すると残りが左へ詰まり canvas が縮む (#99 の再現)', () => {
  const s = row3();
  const next = withRemovedOutput(s, 'o1');
  assert.deepEqual(next.canvas, { width: 2 * W, height: H });
  assert.deepEqual(findOut(next, 'o2').position, { x: 0, y: 0 });
  assert.deepEqual(findOut(next, 'o3').position, { x: W, y: 0 });
  // 出力から見た mapping / mask の位置は変わらない = 投影結果が変わらない
  assert.deepEqual(relTo(next, 'm2', 'o2'), relTo(s, 'm2', 'o2'));
  assert.deepEqual(relTo(next, 'm3', 'o3'), relTo(s, 'm3', 'o3'));
  assert.deepEqual(relTo(next, 'k3', 'o3'), relTo(s, 'k3', 'o3'));
});

test('中間を削除すると右側だけが 1 台ぶん詰まる', () => {
  const s = row3();
  const next = withRemovedOutput(s, 'o2');
  assert.deepEqual(next.canvas, { width: 2 * W, height: H });
  assert.deepEqual(findOut(next, 'o1').position, { x: 0, y: 0 });
  assert.deepEqual(findOut(next, 'o3').position, { x: W, y: 0 });
  assert.deepEqual(topLeftOf(find(next, 'm1')), { x: 100, y: 100 });
  assert.deepEqual(relTo(next, 'm3', 'o3'), relTo(s, 'm3', 'o3'));
});

test('左端を 2 回続けて削除すると 1 台ぶんまで縮む (Issue の再現手順)', () => {
  const s = row3();
  const next = withRemovedOutput(withRemovedOutput(s, 'o1'), 'o2');
  assert.deepEqual(next.canvas, { width: W, height: H });
  assert.deepEqual(findOut(next, 'o3').position, { x: 0, y: 0 });
  assert.deepEqual(relTo(next, 'm3', 'o3'), relTo(s, 'm3', 'o3'));
});

test('縦積みは y 方向に詰まる', () => {
  const s = state(
    [out('top', 0, 0), out('bottom', 0, H)],
    [mapping('mt', 10, 20), mapping('mb', 30, H + 40)],
  );
  const removeTop = withRemovedOutput(s, 'top');
  assert.deepEqual(removeTop.canvas, { width: W, height: H });
  assert.deepEqual(findOut(removeTop, 'bottom').position, { x: 0, y: 0 });
  assert.deepEqual(relTo(removeTop, 'mb', 'bottom'), { x: 30, y: 40 });

  const removeBottom = withRemovedOutput(s, 'bottom');
  assert.deepEqual(removeBottom.canvas, { width: W, height: H });
  assert.deepEqual(findOut(removeBottom, 'top').position, { x: 0, y: 0 });
});

test('削除した出力に取り残された mapping / mask は先頭の残り出力へ相対位置を保って移る', () => {
  const s = state(
    [out('o1', 0, 0), out('o2', W, 0), out('o3', 2 * W, 0)],
    [mapping('m2', W + 200, 150), mask('k2', W + 600, 500), mapping('m3', 2 * W + 300, 200)],
  );
  const next = withRemovedOutput(s, 'o2');
  // o2 の中で (200, 150) / (600, 500) にあったものが、先頭の o1 の中の同じ位置へ
  assert.deepEqual(relTo(next, 'm2', 'o1'), { x: 200, y: 150 });
  assert.deepEqual(relTo(next, 'k2', 'o1'), { x: 600, y: 500 });
  // o3 上のものは o3 と一緒に動く
  assert.deepEqual(relTo(next, 'm3', 'o3'), relTo(s, 'm3', 'o3'));
});

test('取り残しの判定では、辺が接しているだけの出力には乗っていないとみなす', () => {
  // o1 全面を覆う quad (0..1920)。x = 1920 で o2 に接するだけ。
  const s = state(
    [out('o1', 0, 0), out('o2', W, 0)],
    [mapping('full', 0, 0, W, H)],
  );
  const next = withRemovedOutput(s, 'o1');
  // o2 は x = 0 へ詰まり、full は o2 へ寄せられて o2 を覆う
  assert.deepEqual(findOut(next, 'o2').position, { x: 0, y: 0 });
  assert.deepEqual(relTo(next, 'full', 'o2'), { x: 0, y: 0 });
});

test('部分的に重なる出力を削除すると、覆われていない部分だけ詰まる', () => {
  // o1: 0..1920 / o2: 1420..3340 (500 重なる) / o3: 3340..5260
  const s = state(
    [out('o1', 0, 0), out('o2', W - 500, 0), out('o3', 2 * W - 500, 0)],
    [mapping('m3', 2 * W - 500 + 100, 100)],
  );
  const next = withRemovedOutput(s, 'o2');
  // o2 の帯 1420..3340 のうち o1 が覆う 1420..1920 は残し、1920..3340 (1420) を詰める
  assert.deepEqual(findOut(next, 'o3').position, { x: W, y: 0 });
  assert.deepEqual(next.canvas, { width: 2 * W, height: H });
  assert.deepEqual(relTo(next, 'm3', 'o3'), { x: 100, y: 100 });
});

test('削除前からどの出力にも乗っていなかった item は寄せない', () => {
  // o1: 0..1920 / o2: 1920..3840。stray は o2 の右の外 (4000..) にある。
  const s = state(
    [out('o1', 0, 0), out('o2', W, 0)],
    [mapping('m1', 100, 100), mapping('stray', 4000, 100)],
  );
  const next = withRemovedOutput(s, 'o1');
  // 帯 0..1920 を詰めた分だけ平行移動するが、o2 へは寄せない (o2 と重ならないまま)
  assert.deepEqual(topLeftOf(find(next, 'stray')), { x: 4000 - W, y: 100 });
});

test('最後の 1 件と存在しない id は no-op (同一参照)', () => {
  const single = state([out('o1', 0, 0)], [mapping('m1', 0, 0)]);
  assert.equal(withRemovedOutput(single, 'o1'), single);
  const s = row3();
  assert.equal(withRemovedOutput(s, 'nope'), s);
});

test('activeOutputId が削除した出力を指していたら解除し、ほかなら保つ', () => {
  const s = { ...row3(), activeOutputId: 'o1' };
  assert.equal(withRemovedOutput(s, 'o1').activeOutputId, undefined);
  assert.equal(withRemovedOutput(s, 'o2').activeOutputId, 'o1');
});
