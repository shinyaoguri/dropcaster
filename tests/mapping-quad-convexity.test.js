import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQuadCanvas,
  constrainQuadCorner,
  isConvexQuad,
} from '../src/viewer/utils/mappingTransform.ts';

// quad の隅を動かして凹ませると、矩形 → quad のホモグラフィ (CSS matrix3d) の分母が
// 映像の内部で符号を変え、映像が quad の外側へ反転して描かれる (#95)。
// 射影変換は凸な矩形を凸四角形へしか写せないので、quad を常に凸に保つことで防ぐ。

// 画面座標 (y 下向き) で左上から時計回りに A・B・C・D。
const square = () => ({
  topLeft: { x: 0, y: 0 },        // A
  topRight: { x: 100, y: 0 },     // B
  bottomRight: { x: 100, y: 100 }, // C
  bottomLeft: { x: 0, y: 100 },   // D
});

const withCorner = (quad, corner, p) => ({ ...quad, [corner]: p });

test('D を対角線 AC の内側へ動かしても quad は凸に保たれる (#95 の再現)', () => {
  const q = square();
  const p = constrainQuadCorner(q, 'bottomLeft', { x: 80, y: 20 });
  assert.equal(isConvexQuad(withCorner(q, 'bottomLeft', p)), true);
});

test('限界を越えた移動は対角線 AC の手前で止まり、対角線に沿って滑る', () => {
  const q = square();
  // (80,20) を直線 y = x へ下ろした足は (50,50)。余白ぶんだけ D 側に寄る
  const p1 = constrainQuadCorner(q, 'bottomLeft', { x: 80, y: 20 });
  assert.ok(Math.abs(p1.x - 50) < 2 && Math.abs(p1.y - 50) < 2, `got ${JSON.stringify(p1)}`);
  assert.ok(p1.y > p1.x, 'AC より D 側 (凸の側) に残る');
  // 目標を対角線に沿ってずらすと、止まる位置も対角線に沿って同じだけずれる
  const p2 = constrainQuadCorner(q, 'bottomLeft', { x: 70, y: 10 });
  assert.ok(Math.abs((p1.x - p2.x) - 10) < 1e-6 && Math.abs((p1.y - p2.y) - 10) < 1e-6,
    `got ${JSON.stringify(p2)}`);
});

test('辺 AB の延長線を越える移動も止まる (B を越えた側への回り込み)', () => {
  const q = square();
  // D を AB の上側 (y < 0) へ持っていくと A の角が裏返る
  const p = constrainQuadCorner(q, 'bottomLeft', { x: -30, y: -40 });
  assert.equal(isConvexQuad(withCorner(q, 'bottomLeft', p)), true);
  assert.ok(p.y > 0);
});

test('辺 BC の延長線を越える移動も止まり、延長線に沿って滑る (C の角の裏返り)', () => {
  const q = square();
  // D を x > 100 へ持っていくと C の角が裏返る。y 方向の成分はそのまま残る
  const p = constrainQuadCorner(q, 'bottomLeft', { x: 150, y: 300 });
  assert.equal(isConvexQuad(withCorner(q, 'bottomLeft', p)), true);
  assert.ok(p.x < 100 && p.x > 98, `got ${JSON.stringify(p)}`);
  assert.ok(Math.abs(p.y - 300) < 1e-6, `got ${JSON.stringify(p)}`);
});

test('凸のまま動かせる移動はそのまま通す', () => {
  const q = square();
  assert.deepEqual(constrainQuadCorner(q, 'bottomLeft', { x: -40, y: 130 }), { x: -40, y: 130 });
  assert.deepEqual(constrainQuadCorner(q, 'topRight', { x: 90, y: 20 }), { x: 90, y: 20 });
});

test('左右反転した (反時計回りの) quad でも凸の範囲を保つ', () => {
  const m = {
    topLeft: { x: 100, y: 0 },
    topRight: { x: 0, y: 0 },
    bottomRight: { x: 0, y: 100 },
    bottomLeft: { x: 100, y: 100 },
  };
  assert.equal(isConvexQuad(m), true);
  const p = constrainQuadCorner(m, 'bottomLeft', { x: 20, y: 20 });
  assert.equal(isConvexQuad(withCorner(m, 'bottomLeft', p)), true);
});

test('元から凸でない quad は制限しない (抜け出せなくならない)', () => {
  const concave = withCorner(square(), 'bottomLeft', { x: 80, y: 20 });
  assert.deepEqual(constrainQuadCorner(concave, 'bottomLeft', { x: 70, y: 30 }), { x: 70, y: 30 });
});

test('isConvexQuad は凹・自己交差・退化を弾く', () => {
  assert.equal(isConvexQuad(square()), true);
  assert.equal(isConvexQuad(withCorner(square(), 'bottomLeft', { x: 80, y: 20 })), false, '凹');
  const bowtie = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 100, y: 100 },
    bottomRight: { x: 100, y: 0 },
    bottomLeft: { x: 0, y: 100 },
  };
  assert.equal(isConvexQuad(bowtie), false, '自己交差');
  assert.equal(isConvexQuad(withCorner(square(), 'bottomLeft', { x: 50, y: 50 })), false, '3 点が一直線');
});

test('凸でない quad は反転表示せず非表示にする', () => {
  /** @type {any} applyQuadCanvas が触るのは style だけなので、DOM の代わりに素のオブジェクトを渡す */
  const el = { style: { visibility: '', transform: '' } };
  applyQuadCanvas(el, square(), 100, 100);
  assert.equal(el.style.visibility, '');
  assert.match(el.style.transform, /^matrix3d\(/);

  applyQuadCanvas(el, withCorner(square(), 'bottomLeft', { x: 80, y: 20 }), 100, 100);
  assert.equal(el.style.visibility, 'hidden');
});
