import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT_VIEW,
  PAN_KEEP_VISIBLE_PX,
  clampView,
  isFitView,
  panBy,
  wheelZoomFactor,
  zoomAt,
} from '../src/viewer/utils/viewZoom.ts';

// 編集ビューの拡大・パン (#193)。表示だけの状態で、全体表示 (zoom 1・pan 0) に掛け合わせる。
// 内容上の点 c の画面位置: screen = origin + pan + (c - content / 2) × zoom

// 800×600 の viewport の中央に、全体表示で 640×360 の内容が収まっている
const geom = { viewW: 800, viewH: 600, originX: 400, originY: 300, contentW: 640, contentH: 360 };
const limits = { min: 0.25, max: 32 };

/** 画面位置 → 全体表示の内容上の点 */
function toContent(view, p) {
  return {
    x: (p.x - geom.originX - view.panX) / view.zoom + geom.contentW / 2,
    y: (p.y - geom.originY - view.panY) / view.zoom + geom.contentH / 2,
  };
}

function assertClose(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);
}

test('ホイールの拡大はカーソル下の内容の点を動かさない', () => {
  const anchor = { x: 150, y: 220 };
  const before = toContent(FIT_VIEW, anchor);
  const zoomed = zoomAt(FIT_VIEW, 2, anchor, geom, limits);
  assert.equal(zoomed.zoom, 2);
  const after = toContent(zoomed, anchor);
  assertClose(after.x, before.x, 'x');
  assertClose(after.y, before.y, 'y');

  // 続けて別の位置で縮小しても、その位置の点は動かない
  const anchor2 = { x: 610, y: 90 };
  const before2 = toContent(zoomed, anchor2);
  const out = zoomAt(zoomed, 0.8, anchor2, geom, limits);
  const after2 = toContent(out, anchor2);
  assertClose(after2.x, before2.x, 'x2');
  assertClose(after2.y, before2.y, 'y2');
});

test('中央で拡大するとパンは 0 のまま', () => {
  const v = zoomAt(FIT_VIEW, 4, { x: geom.originX, y: geom.originY }, geom, limits);
  assert.deepEqual(v, { zoom: 4, panX: 0, panY: 0 });
});

test('倍率は上下限に収まり、限界で回してもパンが動かない', () => {
  const anchor = { x: 100, y: 100 };
  const atMax = zoomAt({ zoom: 32, panX: 0, panY: 0 }, 2, anchor, geom, limits);
  assert.deepEqual(atMax, { zoom: 32, panX: 0, panY: 0 });
  const atMin = zoomAt({ zoom: 0.25, panX: 0, panY: 0 }, 0.5, anchor, geom, limits);
  assert.deepEqual(atMin, { zoom: 0.25, panX: 0, panY: 0 });
  // 上限を跨ぐ拡大は上限で止まる
  assert.equal(zoomAt({ zoom: 20, panX: 0, panY: 0 }, 4, anchor, geom, limits).zoom, 32);
});

test('パンしても内容を画面に一定量残す', () => {
  // 全体表示の内容の右端は 400 + 320 = 720。大きく左へ動かしても右端は 48px 残る
  const left = panBy(FIT_VIEW, -10000, 0, geom);
  assertClose(geom.originX + left.panX + geom.contentW / 2, PAN_KEEP_VISIBLE_PX, '右端');
  const right = panBy(FIT_VIEW, 10000, 0, geom);
  assertClose(geom.originX + right.panX - geom.contentW / 2, geom.viewW - PAN_KEEP_VISIBLE_PX, '左端');
  const down = panBy(FIT_VIEW, 0, 10000, geom);
  assertClose(geom.originY + down.panY - geom.contentH / 2, geom.viewH - PAN_KEEP_VISIBLE_PX, '上端');
  // 範囲内のパンはそのまま
  assert.deepEqual(panBy(FIT_VIEW, 30, -20, geom), { zoom: 1, panX: 30, panY: -20 });
});

test('内容が残す量より小さいときは、内容の幅だけ残す', () => {
  const tiny = { ...geom, contentW: 40, contentH: 20 };
  const v = clampView({ zoom: 0.25, panX: -10000, panY: 0 }, tiny);
  // 0.25 倍で幅 10px。右端がちょうど viewport の左端から 10px に来る
  assertClose(tiny.originX + v.panX + 5, 10, '右端');
});

test('全体表示かどうか', () => {
  assert.equal(isFitView(FIT_VIEW), true);
  assert.equal(isFitView({ zoom: 1, panX: 1, panY: 0 }), false);
  assert.equal(isFitView({ zoom: 1.5, panX: 0, panY: 0 }), false);
});

test('ホイールの向き・単位・ピンチの感度', () => {
  assert.ok(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }) > 1, '上へ回すと拡大');
  assert.ok(wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false }) < 1, '下へ回すと縮小');
  // 上下で逆数（拡大して縮小すると元に戻る）
  const up = wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false });
  const down = wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false });
  assertClose(up * down, 1, '逆数');
  // 行単位（Firefox 等）は px に換算する: 3 行 = 48px
  assertClose(
    wheelZoomFactor({ deltaY: 3, deltaMode: 1, ctrlKey: false }),
    wheelZoomFactor({ deltaY: 48, deltaMode: 0, ctrlKey: false }),
    '行単位',
  );
  // ピンチ（ctrlKey）は小さな delta でも効く
  assert.ok(
    wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true })
      > wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: false }),
  );
  // 1 イベントの量には上限がある
  assert.equal(
    wheelZoomFactor({ deltaY: 10000, deltaMode: 0, ctrlKey: false }),
    wheelZoomFactor({ deltaY: 300, deltaMode: 0, ctrlKey: false }),
  );
});
