import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceController } from '../src/viewer/venue/TraceController.ts';
import { emptyTrace, parseTraceDocument, placePoint, removePoint, resizeTrace, throwRatioToVerticalFov, toReconstructInput } from '../src/viewer/venue/traceModel.ts';
import { reconstructVenue } from '../src/viewer/venue/venueReconstruct.ts';
import { reconstructionToVenue } from '../src/viewer/venue/reconstructionToVenue.ts';
import { createProject } from '../src/viewer/practice/project.ts';
import { OUTPUT, WORLD, observe, truthProjector } from './fixtures/venue-reconstruct-scene.js';

// 合成会場 (tests/fixtures/venue-reconstruct-scene.js) の頂点の画素を、道具の手順どおりに確定する。
// 画素は既存の ProjectorNudge.projectToNdc (three.js) で作り、推定器・変換の式は写さない。

const front = truthProjector();
const pixelOf = id => observe(front, [id])[0].pixel;
/** 正解の縦画角 50° に当たる投射比。 */
const throwRatio = 1 / (2 * (OUTPUT.width / OUTPUT.height) * Math.tan(25 * Math.PI / 180));

/** @param {import("../src/viewer/venue/TraceController.ts").TraceController} trace @param {import("../src/viewer/venue/traceModel.ts").TraceTool} tool @param {string[]} ids @param {number | null} [meters] */
function traceShape(trace, tool, ids, meters = null) {
  trace.setTool(tool);
  const results = ids.map(id => { trace.moveCrosshair(pixelOf(id)); return trace.confirm({ meters: () => meters }); });
  assert.equal(results.at(-1), 'shape', `${tool}: ${results.join(',')}`);
}

/** 部屋の左右の隅、箱の角 (上の手前右)、箱の上面と前面をなぞる。 */
function traceRoomAndBox() {
  const trace = new TraceController(null, OUTPUT.width, OUTPUT.height, () => {});
  traceShape(trace, 'roomCorner', ['backLeft', 'backLeftUp', 'backRight', 'backLeftSide']);
  traceShape(trace, 'roomCorner', ['backRight', 'backRightUp', 'backLeft', 'backRightSide']);
  traceShape(trace, 'boxCorner', ['boxTopFrontRight', 'boxBottomFrontRight', 'boxTopFrontLeft', 'boxTopBackRight']);
  traceShape(trace, 'rectangle', ['boxTopBackLeft', 'boxTopBackRight', 'boxTopFrontRight', 'boxTopFrontLeft']);
  traceShape(trace, 'rectangle', ['boxTopFrontLeft', 'boxTopFrontRight', 'boxBottomFrontRight', 'boxBottomFrontLeft']);
  return trace;
}

test('既存の点の近くで確定すると、その点を共有する (共有した角は 1 つの頂点になる)', () => {
  const trace = traceRoomAndBox();
  // 隅 2 つで 6 点、箱で 6 点 (上面・前面・角が共有)。
  assert.equal(trace.doc.points.length, 12);
  assert.equal(trace.doc.shapes.length, 5);
  const [left, right] = trace.doc.shapes;
  assert.equal(left.points[2], right.points[0], 'the back edge point is the other corner');
  const doc = emptyTrace(1920, 1080);
  const a = placePoint(doc, [100, 100]);
  assert.equal(placePoint(a.doc, [116, 100]).id, a.id, 'within the snap radius');
  assert.notEqual(placePoint(a.doc, [117, 100]).id, a.id, 'outside the snap radius');
});

test('同じ形の中で同じ点を 2 回確定できず、長さは m を入れるまで 2 点目を置かない', () => {
  const trace = new TraceController(null, 1920, 1080, () => {});
  trace.setTool('rectangle'); trace.moveCrosshair([100, 100]);
  assert.equal(trace.confirm({ meters: () => null }), 'placed');
  assert.equal(trace.confirm({ meters: () => null }), 'duplicate');
  trace.setTool('length');
  assert.equal(trace.doc.points.length, 0, 'switching tools drops the half-traced shape');
  trace.moveCrosshair([100, 100]); trace.confirm({ meters: () => null }); trace.moveCrosshair([500, 100]);
  assert.equal(trace.confirm({ meters: () => null }), 'needLength');
  assert.equal(trace.doc.points.length, 1);
  assert.equal(trace.confirm({ meters: () => 8 }), 'shape');
  assert.deepEqual(trace.doc.shapes, [{ kind: 'length', points: ['p1', 'p2'], meters: 8 }]);
});

test('部屋の隅・箱の角の縦の辺の平行、横の壁の床の辺の平行、箱の接地を自動で付ける', () => {
  const trace = traceRoomAndBox();
  const input = toReconstructInput(trace.doc);
  const id = name => trace.doc.points.find(p => p.pixel[0] === pixelOf(name)[0] && p.pixel[1] === pixelOf(name)[1]).id;
  const parallels = input.elements.filter(e => e.kind === 'parallel').map(e => JSON.stringify(e.segments));
  assert.deepEqual(parallels.sort(), [
    JSON.stringify([[id('backLeft'), id('backLeftUp')], [id('backRight'), id('backRightUp')]]),
    JSON.stringify([[id('backLeft'), id('backLeftUp')], [id('boxTopFrontRight'), id('boxBottomFrontRight')]]),
    JSON.stringify([[id('backLeft'), id('backLeftSide')], [id('backRight'), id('backRightSide')]]),
  ].sort());
  assert.deepEqual(input.elements.filter(e => e.kind === 'onPlane'),
    [{ kind: 'onPlane', vertex: id('boxBottomFrontRight'), plane: [id('backLeft'), id('backRight'), id('backLeftSide')] }]);
  const corners = input.elements.filter(e => e.kind === 'orthogonalCorner').map(e => e.shape);
  assert.deepEqual(corners, ['concave', 'concave', 'convex']);
});

test('投射比は縦画角の事前分布に、レンズシフトは入れたときだけ固定値になる', () => {
  const doc = { ...emptyTrace(1920, 1080), throwRatio };
  assert.ok(Math.abs(throwRatioToVerticalFov(throwRatio, 16 / 9) - 50) < 1e-9);
  // 投射比 1.0・16:9 は水平画角 2·atan(0.5) ≈ 53.13°、縦画角 2·atan(0.28125) ≈ 31.42°。
  assert.ok(Math.abs(throwRatioToVerticalFov(1, 16 / 9) - 31.4172) < 1e-3);
  assert.deepEqual(toReconstructInput(doc).fovPrior, { degrees: throwRatioToVerticalFov(throwRatio, 16 / 9), sigmaDegrees: 2 });
  assert.deepEqual(toReconstructInput(doc).locked, ['lensShiftX']);
  const shifted = toReconstructInput({ ...doc, lensShiftY: .08 });
  assert.deepEqual([shifted.locked, shifted.initial], [['lensShiftX', 'lensShiftY'], { lensShift: [0, .08] }]);
  assert.equal(toReconstructInput(emptyTrace(1920, 1080)).fovPrior, undefined);
});

test('道具の手順どおりになぞった部屋と箱から、推定器と変換が会場の部材を作る', () => {
  const trace = traceRoomAndBox();
  trace.setLensInputs(throwRatio, null);
  const input = toReconstructInput(trace.doc);
  const result = reconstructVenue(input);
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  assert.ok(result.rmsPixels < 1e-3, `rms ${result.rmsPixels} ${JSON.stringify(result.residualPixels)} fov ${result.projector.verticalFovDegrees}`);
  const venue = reconstructionToVenue(input, result, { projector: createProject().venue.projectors[0], name: (role, i) => `${role}${i}` });
  assert.equal(venue.status, 'ok');
  assert.deepEqual(venue.objects.map(o => o.name), ['floor0', 'back0', 'left0', 'right0', 'box0']);
  const box = venue.objects.at(-1), back = venue.objects[1];
  // 縮尺は未設定なので比で比べる: 箱 1 m に対し、奥の左右の隅の間 8 m。
  const id = name => trace.doc.points.find(p => p.pixel[0] === pixelOf(name)[0]).id;
  const width = Math.hypot(...venue.vertices[id('backRight')].map((v, i) => v - venue.vertices[id('backLeft')][i]));
  assert.ok(Math.abs(box.size[0] / width - 1 / 8) < 1e-3, `box / room ${box.size[0] / width}`);
  assert.ok(back.position[2] < box.position[2]);
  assert.equal(venue.scaleKnown, false);
});

test('点を消すとその点を使う形も消え、置き直しは確定で動き Esc で戻る', () => {
  const trace = traceRoomAndBox();
  const shared = trace.doc.shapes[0].points[2];
  trace.remove(shared);
  assert.equal(trace.doc.shapes.filter(s => s.points.includes(shared)).length, 0);
  assert.equal(trace.doc.shapes.length, 3, 'both room corners used the shared point');
  const id = trace.doc.points[0].id, from = [...trace.doc.points[0].pixel];
  trace.beginMove(id); trace.nudge(10, -1);
  assert.equal(trace.cancel(), true);
  assert.deepEqual(trace.doc.points[0].pixel, from); assert.deepEqual(trace.crosshair, from);
  trace.beginMove(id); trace.nudge(10, -1);
  assert.equal(trace.confirm({ meters: () => null }), 'moved');
  assert.deepEqual(trace.doc.points[0].pixel, [from[0] + 10, from[1] - 1]);
  assert.deepEqual(removePoint(trace.doc, 'p999'), trace.doc);
});

test('出力解像度が変わると点は比例して移り、十字は出力の範囲に収まる', () => {
  const trace = new TraceController(null, 1920, 1080, () => {});
  trace.setTool('rectangle'); trace.moveCrosshair([960, 540]); trace.confirm({ meters: () => null });
  trace.setOutput(1280, 800);
  assert.deepEqual(trace.doc.points[0].pixel, [640, 400]);
  assert.deepEqual(trace.crosshair, [640, 400]);
  trace.nudge(-5000, 5000);
  assert.deepEqual(trace.crosshair, [0, 800]);
  const resized = resizeTrace({ ...emptyTrace(100, 100), points: [{ id: 'p1', pixel: [50, 10] }] }, 200, 50);
  assert.deepEqual(resized.points[0].pixel, [100, 5]);
});

test('保存値を検証し、壊れていれば捨てる', () => {
  const trace = traceRoomAndBox();
  trace.setLensInputs(1.2, .05);
  trace.setTool('length'); trace.moveCrosshair([10, 10]); trace.confirm({ meters: () => null }); trace.moveCrosshair([900, 10]); trace.confirm({ meters: () => 3.5 });
  const saved = JSON.parse(JSON.stringify(trace.doc));
  assert.deepEqual(parseTraceDocument(saved), trace.doc);
  for (const broken of [
    null, 'x', { ...saved, version: 2 }, { ...saved, output: { width: 0, height: 1080 } },
    { ...saved, points: [...saved.points, saved.points[0]] },
    { ...saved, shapes: [{ kind: 'rectangle', points: ['p1', 'p2', 'p3', 'p404'] }] },
    { ...saved, shapes: [{ kind: 'rectangle', points: ['p1', 'p1', 'p2', 'p3'] }] },
    { ...saved, shapes: [{ kind: 'length', points: ['p1', 'p2'], meters: -1 }] },
    { ...saved, shapes: [{ kind: 'circle', points: ['p1', 'p2', 'p3', 'p4'] }] },
    { ...saved, throwRatio: 50 }, { ...saved, lensShiftY: 'up' },
    { ...saved, points: [{ id: 'x1', pixel: [0, 0] }] },
  ]) assert.equal(parseTraceDocument(broken), null, JSON.stringify(broken)?.slice(0, 80));
  void WORLD;
});
