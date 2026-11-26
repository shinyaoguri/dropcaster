import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeQuadCorner } from '../src/viewer/utils/mappingTransform.ts';

// 四隅の数値入力 (#192)。ドラッグ・矢印キーと同じ条件 (凸で、遠近の強さが 20 倍以下。ADR 0007) で判定し、
// 条件を破る値は黙って寄せずに採用しない。期待値は正方形の幾何から手で求めたもの
// (tests/mapping-quad-convexity.test.js の導出と同じ配置)。

const square = () => ({
  topLeft: { x: 0, y: 0 },
  topRight: { x: 100, y: 0 },
  bottomRight: { x: 100, y: 100 },
  bottomLeft: { x: 0, y: 100 },
});

test('凸を保つ値はその値のまま置き、他の隅と元の quad は変えない', () => {
  const q = square();
  const r = placeQuadCorner(q, 'topLeft', { x: 12.5, y: 7 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.quad, { ...square(), topLeft: { x: 12.5, y: 7 } });
  assert.deepEqual(q, square(), '元の quad は書き換えない');
  r.quad.topRight.x = 999;
  assert.equal(q.topRight.x, 100, '返す quad は元と点を共有しない');
});

test('凹む位置は notConvex で採用せず、ドラッグで寄せられる位置を添える', () => {
  // D を対角線 AC の向こう (80, 20) へ。ドラッグなら (47.5, 52.5) で止まる
  const r = placeQuadCorner(square(), 'bottomLeft', { x: 80, y: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'notConvex');
  assert.ok(Math.abs(r.nearest.x - 47.5) < 1e-6 && Math.abs(r.nearest.y - 52.5) < 1e-6, JSON.stringify(r.nearest));
});

test('隣の隅と重ねる (潰れる) 位置も notConvex', () => {
  const r = placeQuadCorner(square(), 'topLeft', { x: 100, y: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'notConvex');
});

test('凸でも遠近の強さが 20 倍を超える位置は tooSteep', () => {
  // AC の垂直二等分線上を遠くへ。ドラッグなら (50,50) + 20·(-50, 50) = (-950, 1050) で止まる
  const r = placeQuadCorner(square(), 'bottomLeft', { x: -3000, y: 3100 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tooSteep');
  assert.ok(Math.abs(r.nearest.x + 950) < 1e-6 && Math.abs(r.nearest.y - 1050) < 1e-6, JSON.stringify(r.nearest));
});

test('限界ちょうどの位置は置ける', () => {
  const r = placeQuadCorner(square(), 'bottomLeft', { x: -950, y: 1050 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.quad.bottomLeft, { x: -950, y: 1050 });
});

test('数値でない値は notNumber で、今の位置を添える', () => {
  for (const target of [{ x: Number.NaN, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }]) {
    const r = placeQuadCorner(square(), 'topRight', target);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'notNumber');
    assert.deepEqual(r.nearest, { x: 100, y: 0 });
  }
});

test('元から凸でない quad (古い設定) は制限せず、凸へ戻す値を置ける', () => {
  const concave = { ...square(), bottomLeft: { x: 80, y: 20 } };
  const back = placeQuadCorner(concave, 'bottomLeft', { x: 0, y: 100 });
  assert.equal(back.ok, true);
  assert.deepEqual(back.quad, square());
});
