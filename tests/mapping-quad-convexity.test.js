import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORNER_KEYS,
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

// 遠近の強さ: 矩形 → quad のホモグラフィの分母 w = g·u + h·v + 1 の、4 隅での最大 / 最小。
// 実装 (角の三角形の面積の比で制限する) とは別の式 = 描画に使う係数そのものから求める。
const perspectiveRatio = (quad) => {
  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad;
  const det = (p1.x - p2.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p2.y);
  const rx = p0.x + p2.x - p1.x - p3.x;
  const ry = p0.y + p2.y - p1.y - p3.y;
  const g = (rx * (p3.y - p2.y) - (p3.x - p2.x) * ry) / det;
  const h = ((p1.x - p2.x) * ry - rx * (p1.y - p2.y)) / det;
  const w = [1, g + 1, g + h + 1, h + 1];
  return Math.max(...w) / Math.min(...w);
};

const MAX_RATIO = 20;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

test('D を対角線 AC の内側へ動かしても quad は凸に保たれる (#95 の再現)', () => {
  const q = square();
  const p = constrainQuadCorner(q, 'bottomLeft', { x: 80, y: 20 });
  assert.equal(isConvexQuad(withCorner(q, 'bottomLeft', p)), true);
});

test('隅を限界まで寄せても遠近の強さが上限を超えない (#97 の再現)', () => {
  // 報告のスクリーンショットの配置。BL を対角線 TL-BR の向こうへ引っぱる。
  // 凸の境界の 1px 手前で止めるだけだと、遠近の強さが約 800 倍になって表示が崩れる
  const q = {
    topLeft: { x: 156, y: 196 },
    topRight: { x: 1914, y: 416 },
    bottomRight: { x: 1444, y: 1062 },
    bottomLeft: { x: 300, y: 1000 },
  };
  const p = constrainQuadCorner(q, 'bottomLeft', { x: 1100, y: 500 });
  const moved = withCorner(q, 'bottomLeft', p);
  assert.equal(isConvexQuad(moved), true);
  const r = perspectiveRatio(moved);
  assert.ok(r <= MAX_RATIO * (1 + 1e-6), `ratio ${r}`);
  assert.ok(r > MAX_RATIO * 0.99, `限界ちょうどまでは寄せられる: ratio ${r}`);
});

test('限界を越えた移動は対角線 AC の手前で止まり、対角線に沿って滑る', () => {
  const q = square();
  // (80,20) を直線 y = x へ下ろした足は (50,50)。そこから D 側へ、B と対角線の距離
  // (100/√2) の 1/20 だけ離れた位置 = (47.5, 52.5) で止まる
  const p1 = constrainQuadCorner(q, 'bottomLeft', { x: 80, y: 20 });
  assert.ok(near(p1.x, 47.5) && near(p1.y, 52.5), `got ${JSON.stringify(p1)}`);
  // 目標を対角線に沿ってずらすと、止まる位置も対角線に沿って同じだけずれる
  const p2 = constrainQuadCorner(q, 'bottomLeft', { x: 70, y: 10 });
  assert.ok(near(p1.x - p2.x, 10) && near(p1.y - p2.y, 10), `got ${JSON.stringify(p2)}`);
});

test('隅を遠くへ引っぱる側にも上限がある (反対側の隅が相対的に対角線へ寄る)', () => {
  const q = square();
  // D を AC から遠ざけ続けると、B と AC の距離の 20 倍で止まる。
  // (-3000, 3100) は AC の垂直二等分線上なので、止まる位置は (50,50) + 20·(-50, 50)
  const p = constrainQuadCorner(q, 'bottomLeft', { x: -3000, y: 3100 });
  assert.ok(near(p.x, -950) && near(p.y, 1050), `got ${JSON.stringify(p)}`);
  assert.ok(near(perspectiveRatio(withCorner(q, 'bottomLeft', p)), MAX_RATIO, 1e-6));
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
  // D を x > 100 へ持っていくと C の角が裏返る。その手前、C の角の三角形が A の角の
  // 三角形の 1/20 になる直線 x + y/20 = 100 で止まる (目標からその直線へ下ろした垂線の足)
  const target = { x: 150, y: 300 };
  const p = constrainQuadCorner(q, 'bottomLeft', target);
  assert.equal(isConvexQuad(withCorner(q, 'bottomLeft', p)), true);
  const d = (target.x + target.y / 20 - 100) / (1 + 1 / 400);
  assert.ok(near(p.x, target.x - d) && near(p.y, target.y - d / 20), `got ${JSON.stringify(p)}`);
  assert.ok(p.x < 100);
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
  // square() の左右を反転しただけなので、止まる位置も (47.5, 52.5) の鏡像
  assert.ok(near(p.x, 52.5) && near(p.y, 52.5), `got ${JSON.stringify(p)}`);
});

// #96 の限界 (凸の境界の 1px 手前) で保存された quad は、遠近の強さがすでに上限を超えている。
// 上限をそのまま当てると、どの隅を触っても「上限を満たす位置」まで隅が飛んでしまう
const overLimit = () => withCorner(square(), 'bottomLeft', { x: 49.5, y: 50.5 });

test('すでに上限を超えている quad でも、触った隅が飛ばない', () => {
  const q = overLimit();
  assert.ok(perspectiveRatio(q) > 90, `前提: ratio ${perspectiveRatio(q)}`);
  // その場に置く → その場のまま
  for (const corner of CORNER_KEYS) {
    const p = constrainQuadCorner(q, corner, { ...q[corner] });
    assert.ok(near(p.x, q[corner].x) && near(p.y, q[corner].y), `${corner}: got ${JSON.stringify(p)}`);
  }
  // 反対側の隅 B を少し動かしても、対角線の近くまで引き寄せられない
  const b = constrainQuadCorner(q, 'topRight', { x: 101, y: 0 });
  assert.ok(Math.hypot(b.x - 101, b.y) < 2, `got ${JSON.stringify(b)}`);
});

test('すでに上限を超えている quad は、悪くなる向きへは動かせず、良くなる向きへは自由に動かせる', () => {
  const q = overLimit();
  const before = perspectiveRatio(q);
  // 対角線へさらに寄せる → いまより悪くはならない
  const worse = constrainQuadCorner(q, 'bottomLeft', { x: 60, y: 40 });
  const after = perspectiveRatio(withCorner(q, 'bottomLeft', worse));
  assert.equal(isConvexQuad(withCorner(q, 'bottomLeft', worse)), true);
  assert.ok(after <= before * (1 + 1e-6), `ratio ${before} -> ${after}`);
  // 対角線から離す → そのまま通る
  assert.deepEqual(constrainQuadCorner(q, 'bottomLeft', { x: 20, y: 80 }), { x: 20, y: 80 });
  // 上限の内側へ戻ったあとは、上限が効く
  const healed = withCorner(q, 'bottomLeft', { x: 20, y: 80 });
  const p = constrainQuadCorner(healed, 'bottomLeft', { x: 80, y: 20 });
  assert.ok(near(p.x, 47.5) && near(p.y, 52.5), `got ${JSON.stringify(p)}`);
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
