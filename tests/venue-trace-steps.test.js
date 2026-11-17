import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceController } from '../src/viewer/venue/TraceController.ts';
import { emptyTrace, parseTraceDocument } from '../src/viewer/venue/traceModel.ts';
import { BUILD_STEPS, MATCH_STEPS, canAdvance, canVisit, clampStep, initialStep, nextStep, toolsFor } from '../src/viewer/venue/traceSteps.ts';
import { OUTPUT, observe, truthProjector } from './fixtures/venue-reconstruct-scene.js';

// 「なぞる」の手順 (#259)。今いる Step は保存済みの点と形から決め、保存形式は変えない。

const front = truthProjector();
const pixelOf = id => observe(front, [id])[0].pixel;
const open = { keystoneOff: true, outputOpen: true, throwRatioUnknown: false, estimated: false };

/** @param {string[][]} corners */
function traced(corners) {
  const trace = new TraceController(null, OUTPUT.width, OUTPUT.height, () => {});
  for (const ids of corners) {
    trace.setTool('roomCorner');
    for (const id of ids) { trace.moveCrosshair(pixelOf(id)); trace.confirm(); }
  }
  return trace.doc;
}
const LEFT = ['backLeft', 'backLeftUp', 'backRight', 'backLeftSide'], RIGHT = ['backRight', 'backRightUp', 'backLeft', 'backRightSide'];

test('何もなぞっていなければ入口から、部屋の隅の数に応じた Step から再開する', () => {
  assert.equal(initialStep(emptyTrace(1920, 1080)), 'entry');
  // 投射比だけ入れて閉じた場合も入口 (点が無い)。
  assert.equal(initialStep({ ...emptyTrace(1920, 1080), throwRatio: 1.2 }), 'entry');
  assert.equal(initialStep(traced([LEFT])), 'room2');
  assert.equal(initialStep(traced([LEFT, RIGHT])), 'review');
});

test('main 3ce6bf1 の形で保存したなぞり (隅 2 つ＋箱) は確認の Step から再開する', () => {
  const saved = {
    version: 1, output: { width: 1920, height: 1080 },
    points: [
      { id: 'p1', pixel: [400, 800] }, { id: 'p2', pixel: [400, 300] }, { id: 'p3', pixel: [1500, 800] }, { id: 'p4', pixel: [200, 950] },
      { id: 'p5', pixel: [1500, 300] }, { id: 'p6', pixel: [1700, 950] },
      { id: 'p7', pixel: [900, 600] }, { id: 'p8', pixel: [900, 760] }, { id: 'p9', pixel: [800, 580] }, { id: 'p10', pixel: [1000, 560] },
    ],
    shapes: [
      { kind: 'roomCorner', points: ['p1', 'p2', 'p3', 'p4'] }, { kind: 'roomCorner', points: ['p3', 'p5', 'p1', 'p6'] },
      { kind: 'boxCorner', points: ['p7', 'p8', 'p9', 'p10'] },
    ],
    throwRatio: 1.2, lensShiftY: null,
  };
  const doc = parseTraceDocument(JSON.parse(JSON.stringify(saved)));
  assert.ok(doc, 'the old document still parses');
  assert.equal(doc.mode, 'build');
  assert.equal(initialStep(doc), 'review');
});

test('合わせるモードは、点の数が必要数に届くまで点の Step で止まる', () => {
  const base = { ...emptyTrace(1920, 1080), mode: /** @type {const} */ ('match') };
  const anchor = n => ({ id: `p${n}`, pixel: /** @type {[number, number]} */ ([n * 10, n * 10]), world: /** @type {[number, number, number]} */ ([n, 0, 0]) });
  assert.equal(initialStep(base), 'entry');
  assert.equal(initialStep({ ...base, anchors: [anchor(1)] }), 'anchors');
  // 既定の固定 (横のシフト) で未知数 8 → 4 点。
  assert.equal(initialStep({ ...base, anchors: [1, 2, 3, 4].map(anchor) }), 'review');
  assert.equal(canAdvance('anchors', { ...base, anchors: [1, 2, 3].map(anchor) }, { ...open, estimated: true }), false);
  assert.equal(canAdvance('anchors', { ...base, anchors: [1, 2, 3, 4].map(anchor) }, { ...open, estimated: false }), false, 'needs a successful estimate');
  assert.equal(canAdvance('anchors', { ...base, anchors: [1, 2, 3, 4].map(anchor) }, { ...open, estimated: true }), true);
  // 合わせるモードの準備は、出力窓が開いていればよい (投射比は任意)。
  assert.equal(canAdvance('prepare', base, open), true);
  assert.equal(canAdvance('prepare', base, { ...open, outputOpen: false }), false);
  assert.equal(canAdvance('prepare', base, { ...open, keystoneOff: false }), false);
});

test('準備は台形補正のチェック・出力窓と、投射比 (か「分からない」) がそろうまで進めない', () => {
  const doc = emptyTrace(1920, 1080);
  assert.equal(canAdvance('prepare', doc, { ...open, outputOpen: false, throwRatioUnknown: true }), false);
  assert.equal(canAdvance('prepare', doc, { ...open, keystoneOff: false, throwRatioUnknown: true }), false, 'keystone must be confirmed off');
  assert.equal(canAdvance('prepare', doc, open), false, 'the throw ratio is required in the build mode');
  assert.equal(canAdvance('prepare', doc, { ...open, throwRatioUnknown: true }), true);
  assert.equal(canAdvance('prepare', { ...doc, throwRatio: 1.2 }, open), true);
});

test('反対側の隅は必須で、推定が成功するまで進めない。箱と実寸はスキップできる', () => {
  const one = traced([LEFT]), two = traced([LEFT, RIGHT]);
  assert.equal(canAdvance('room1', emptyTrace(1920, 1080), open), false);
  assert.equal(canAdvance('room1', one, open), true);
  assert.equal(canAdvance('room2', one, { ...open, estimated: true }), false, 'one room corner is not enough');
  assert.equal(canAdvance('room2', two, open), false, 'a failed estimate keeps the step');
  assert.equal(canAdvance('room2', two, { ...open, estimated: true }), true);
  for (const step of /** @type {const} */ (['boxes', 'scale'])) assert.equal(canAdvance(step, emptyTrace(1920, 1080), open), true, step);
  assert.equal(canAdvance('review', two, { ...open, estimated: true }), false, 'the last step has no next');
});

test('Step の並びと、それぞれで使う道具', () => {
  assert.deepEqual([...BUILD_STEPS], ['prepare', 'room1', 'room2', 'boxes', 'scale', 'review']);
  assert.deepEqual([...MATCH_STEPS], ['prepare', 'anchors', 'review']);
  assert.equal(nextStep('build', 'room2'), 'boxes');
  assert.equal(nextStep('build', 'review'), null);
  assert.equal(nextStep('match', 'prepare'), 'anchors');
  assert.deepEqual(toolsFor('room1'), ['roomCorner']);
  assert.deepEqual(toolsFor('boxes'), ['boxCorner', 'rectangle']);
  assert.deepEqual(toolsFor('scale'), ['length']);
  assert.deepEqual(toolsFor('anchors'), ['anchor']);
  assert.deepEqual(toolsFor('review'), []);
});

test('着いたことのある Step までは戻れ、先へは飛べない', () => {
  assert.equal(canVisit('build', 'room2', 'prepare'), true);
  assert.equal(canVisit('build', 'room2', 'room2'), true);
  assert.equal(canVisit('build', 'room2', 'boxes'), false);
  assert.equal(canVisit('build', 'review', 'boxes'), true);
  assert.equal(canVisit('match', 'anchors', 'review'), false);
  assert.equal(canVisit('build', 'review', 'anchors'), false, 'a step of the other mode');
});

test('点を消して部屋の隅が足りなくなったら、その Step まで戻す', () => {
  const one = traced([LEFT]), two = traced([LEFT, RIGHT]);
  assert.equal(clampStep(two, 'review'), 'review');
  assert.equal(clampStep(one, 'review'), 'room2');
  assert.equal(clampStep(one, 'scale'), 'room2');
  assert.equal(clampStep(one, 'room1'), 'room1', 'going back stays');
  assert.equal(clampStep(emptyTrace(1920, 1080), 'room2'), 'room1');
  assert.equal(clampStep(emptyTrace(1920, 1080), 'prepare'), 'prepare');
  assert.equal(clampStep(emptyTrace(1920, 1080), 'entry'), 'entry');
});
