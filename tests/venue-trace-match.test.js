import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TraceController } from '../src/viewer/venue/TraceController.ts';
import { DEFAULT_MATCH_LOCKED, emptyTrace, parseTraceDocument, requiredAnchors, throwRatioToVerticalFov, toMatchInput } from '../src/viewer/venue/traceModel.ts';
import { reconstructVenue } from '../src/viewer/venue/venueReconstruct.ts';
import { collectVertices, isVertexVisible, nearestProjectedVertex, projectToPixel } from '../src/viewer/venue/venueVertices.ts';
import { CONFIGS, OUTPUT, WORLD, observe, truthProjector } from './fixtures/venue-reconstruct-scene.js';

/** @typedef {import('../src/viewer/practice/project.ts').Projector} Projector */
/** @typedef {import('../src/viewer/practice/project.ts').Vec3} Vec3 */
/** @typedef {import('../src/viewer/venue/traceModel.ts').TraceDocument} TraceDocument */

// 測った会場に合わせる (#158)。会場の頂点は合成会場 (tests/fixtures/venue-reconstruct-scene.js) の WORLD、
// 実物の角の画素は正解のプロジェクタで既存の ProjectorNudge.projectToNdc から作る (推定器の投影式は写さない)。

const truth = truthProjector();
/** 確定済み (少しずれた) プロジェクタ。実測で組んだ会場に、レンズ位置と仕様の画角で粗く置いた状態を想定する。 */
const committed = /** @type {Projector} */ ((() => {
  const q = new THREE.Quaternion(...truth.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.04, -.03, .02)));
  return { ...truth, position: [truth.position[0] + .3, truth.position[1] - .15, truth.position[2] + .25], quaternion: [q.x, q.y, q.z, q.w], verticalFovDegrees: 46, lensShift: [0, .05] };
})());
const vertices = Object.values(WORLD);
const truthPixel = id => observe(truth, [id])[0].pixel;

/** @param {any} p @param {any} q */
function angleBetween(p, q) {
  return THREE.MathUtils.radToDeg(new THREE.Quaternion(...p).normalize().angleTo(new THREE.Quaternion(...q).normalize()));
}

/** 頂点の確定を、画面の操作どおりに行う: 輪郭の角 (確定済みのプロジェクタでの投影) の近くで確定 → 実物の角へ運んで確定。 */
function matchAnchors(ids, { pixelOf = truthPixel, doc = null } = {}) {
  const trace = new TraceController(doc, OUTPUT.width, OUTPUT.height, () => {});
  trace.setMode('match');
  const pickVertex = pixel => nearestProjectedVertex(vertices, committed, OUTPUT, pixel);
  for (const id of ids) {
    const outline = projectToPixel(committed, OUTPUT, WORLD[id]);
    trace.moveCrosshair([outline[0] + 6, outline[1] - 4]);
    assert.equal(trace.confirm({ pickVertex }), 'placed', `${id}: pick`);
    assert.deepEqual(trace.crosshair, outline, `${id}: the crosshair jumps to the vertex as projected`);
    trace.moveCrosshair(pixelOf(id));
    assert.equal(trace.confirm({ pickVertex }), 'shape', `${id}: confirm`);
  }
  return trace;
}

test('頂点を選んで実物の角で確定すると、測った会場のままプロジェクタ条件だけが正解に戻る', () => {
  const ids = CONFIGS.roomAndBox.ids;
  const trace = matchAnchors(ids);
  assert.equal(trace.doc.anchors.length, ids.length);
  assert.deepEqual(trace.doc.points, [], 'build-mode points are untouched');
  trace.doc.anchors.forEach((a, i) => assert.deepEqual(a.world, WORLD[ids[i]]));
  const result = reconstructVenue(toMatchInput(trace.doc, committed));
  assert.equal(result.frame, 'world');
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  result.projector.position.forEach((v, i) => assert.ok(Math.abs(v - truth.position[i]) < 1e-4, `position ${i}: ${v}`));
  assert.ok(angleBetween(result.projector.quaternion, truth.quaternion) < 1e-3);
  assert.ok(Math.abs(result.projector.verticalFovDegrees - truth.verticalFovDegrees) < 1e-3);
  assert.ok(Math.abs(result.projector.lensShift[1] - truth.lensShift[1]) < 1e-4);
  assert.equal(result.projector.lensShift[0], 0, 'horizontal shift stays locked by default');
  assert.ok(result.rmsPixels < 1e-3);
});

test('合わせる入力: 対応点は固定頂点、確定済みのプロジェクタが初期値、ロックと投射比を渡す', () => {
  const trace = matchAnchors(['backLeft', 'backRight']);
  const input = toMatchInput(trace.doc, committed);
  assert.deepEqual(input.vertices.map(v => v.fixed), [WORLD.backLeft, WORLD.backRight]);
  assert.deepEqual(input.elements, []);
  assert.deepEqual(input.initial, { position: committed.position, quaternion: committed.quaternion, verticalFovDegrees: 46, lensShift: [0, .05] });
  assert.deepEqual(input.locked, ['lensShiftX']);
  assert.equal(input.fovPrior, undefined);
  trace.setLensInputs(1.2, null);
  assert.deepEqual(toMatchInput(trace.doc, committed).fovPrior, { degrees: throwRatioToVerticalFov(1.2, OUTPUT.width / OUTPUT.height), sigmaDegrees: 2 });
  trace.setLocked('fov', true);
  assert.equal(toMatchInput(trace.doc, committed).fovPrior, undefined, 'a locked angle of view keeps its value and ignores the throw ratio');
  assert.deepEqual(toMatchInput(trace.doc, committed).locked, ['lensShiftX', 'fov']);
});

test('必要な点の数は、ロックしていない自由度の半分 (1 点で 2 式)', () => {
  assert.equal(requiredAnchors(DEFAULT_MATCH_LOCKED), 4, 'position 3 + rotation 3 + fov + vertical shift = 8');
  assert.equal(requiredAnchors([]), 5);
  assert.equal(requiredAnchors(['position', 'lensShiftX', 'lensShiftY']), 2);
  assert.equal(requiredAnchors(['position', 'rotation', 'lensShiftX']), 1);
  assert.equal(requiredAnchors(['position', 'rotation', 'fov', 'lensShiftX', 'lensShiftY']), 0);
});

test('位置と向きをロックすると、その値のまま画角とシフトだけを解く', () => {
  const doc = { ...emptyTrace(OUTPUT.width, OUTPUT.height), locked: ['position', 'rotation', 'lensShiftX'] };
  const ids = ['backLeft', 'backRight', 'backLeftUp', 'boxTopFrontRight'];
  const trace = matchAnchors(ids, { doc });
  /** @type {Projector} */
  const at = { ...truth, verticalFovDegrees: 46, lensShift: [0, .05] };
  const result = reconstructVenue(toMatchInput(trace.doc, at));
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  assert.deepEqual(result.projector.position, truth.position);
  assert.ok(angleBetween(result.projector.quaternion, truth.quaternion) < 1e-9);
  assert.ok(Math.abs(result.projector.verticalFovDegrees - 50) < 1e-3);
});

test('失敗系: 全点が正対する奥の壁 1 面にあると、画角と距離が切り分けられず決まらないと返す', () => {
  const squarely = truthProjector({ position: [0, 1.5, 5] }, [0, 1.5, -3]);
  const ids = ['backLeft', 'backRight', 'backLeftUp', 'backRightUp', 'posterTopLeft', 'posterTopRight', 'posterBottomRight', 'posterBottomLeft'];
  /** @type {TraceDocument} */
  const doc = { ...emptyTrace(OUTPUT.width, OUTPUT.height), mode: 'match',
    anchors: observe(squarely, ids).map((v, i) => ({ id: `p${i + 1}`, pixel: v.pixel, world: WORLD[v.id] })) };
  /** @type {Projector} */
  const start = { ...squarely, position: [.2, 1.4, 5.4], verticalFovDegrees: 45 };
  const result = reconstructVenue(toMatchInput(doc, start));
  assert.equal(result.status, 'underdetermined');
  assert.ok(result.underdetermined.includes('fov') || result.underdetermined.includes('position'), result.underdetermined.join(','));
  // 奥行きの違う頂点 (床の辺・箱) を足すと決まる。
  const more = [...ids, 'backLeftSide', 'boxTopFrontRight', 'boxBottomFrontRight'];
  const deep = reconstructVenue(toMatchInput({ ...doc,
    anchors: observe(squarely, more).map((v, i) => ({ id: `p${i + 1}`, pixel: v.pixel, world: WORLD[v.id] })) }, start));
  assert.equal(deep.status, 'ok', deep.underdetermined.join(','));
});

test('失敗系: 取り違えた 1 点を外れ値として最初に挙げる', () => {
  const ids = CONFIGS.roomAndBox.ids, wrong = 'boxTopFrontLeft';
  const trace = matchAnchors(ids, { pixelOf: id => id === wrong ? truthPixel('boxTopBackLeft') : truthPixel(id) });
  const result = reconstructVenue(toMatchInput(trace.doc, committed));
  const wrongId = trace.doc.anchors[ids.indexOf(wrong)].id;
  assert.equal(result.outliers[0], wrongId, JSON.stringify(result.residualPixels));
});

test('頂点の近くでなければ選ばず、対応付け済みの頂点を選ぶと置き直しになり、Esc で選んだ頂点を捨てる', () => {
  const trace = matchAnchors(['backLeft']);
  const pickVertex = pixel => nearestProjectedVertex(vertices, committed, OUTPUT, pixel);
  trace.moveCrosshair([5, 5]);
  assert.equal(trace.confirm({ pickVertex }), 'noVertex');
  assert.equal(trace.step, 0);
  const outline = projectToPixel(committed, OUTPUT, WORLD.backLeft);
  trace.moveCrosshair(outline);
  assert.equal(trace.confirm({ pickVertex }), 'placed');
  assert.equal(trace.moving?.id, trace.doc.anchors[0].id, 'picking a matched vertex re-places that point');
  assert.deepEqual(trace.crosshair, trace.doc.anchors[0].pixel);
  trace.cancel();
  const right = projectToPixel(committed, OUTPUT, WORLD.backRight);
  trace.moveCrosshair(right); trace.confirm({ pickVertex });
  assert.equal(trace.step, 1);
  trace.moveCrosshair([right[0] + 30, right[1]]);
  assert.equal(trace.cancel(), true);
  assert.equal(trace.step, 0); assert.deepEqual(trace.crosshair, right, 'Esc returns the crosshair to the picked vertex');
  assert.equal(trace.doc.anchors.length, 1);
});

test('モードを切り替えてもそれぞれの点は残り、「すべて消す」は今のモードの点だけを消す', () => {
  const trace = matchAnchors(['backLeft', 'backRight']);
  trace.setMode('build');
  trace.setTool('rectangle'); trace.moveCrosshair([100, 100]); trace.confirm();
  assert.equal(trace.doc.points.length, 1);
  assert.equal(trace.doc.anchors.length, 2);
  trace.setMode('match');
  assert.equal(trace.tool, 'anchor');
  assert.equal(trace.doc.points.length, 0, 'switching modes drops the half-traced shape');
  trace.setMode('build');
  trace.setTool('rectangle'); trace.moveCrosshair([100, 100]); trace.confirm(); trace.setTool(null);
  trace.setMode('match'); trace.clear();
  assert.equal(trace.doc.anchors.length, 0);
  const saved = JSON.parse(JSON.stringify(trace.doc));
  assert.equal(saved.mode, 'match');
  assert.deepEqual(parseTraceDocument(saved), trace.doc);
});

test('対応点の id はなぞった点と同じ採番を共有し、保存値を検証する (旧形式の下書きも読める)', () => {
  const trace = matchAnchors(['backLeft', 'backRight']);
  trace.setMode('build'); trace.setTool('rectangle'); trace.moveCrosshair([100, 100]); trace.confirm();
  assert.deepEqual([...trace.doc.anchors.map(a => a.id), trace.doc.points[0].id], ['p1', 'p2', 'p3']);
  trace.setLocked('fov', true); trace.setLocked('lensShiftX', false);
  const saved = JSON.parse(JSON.stringify(trace.doc));
  assert.deepEqual(parseTraceDocument(saved), trace.doc);
  const legacy = { version: 1, output: { width: 1920, height: 1080 }, points: [{ id: 'p1', pixel: [1, 2] }], shapes: [], throwRatio: null, lensShiftY: null };
  assert.deepEqual(parseTraceDocument(legacy), { ...legacy, mode: 'build', anchors: [], locked: ['lensShiftX'] });
  for (const broken of [
    { ...saved, mode: 'other' }, { ...saved, anchors: {} }, { ...saved, locked: ['zoom'] },
    { ...saved, anchors: [{ id: 'p1', pixel: [0, 0], world: [0, 0] }] },
    { ...saved, anchors: [{ id: 'p3', pixel: [0, 0], world: [0, 0, 0] }] },
    { ...saved, anchors: [{ id: 'p9', pixel: [0, 'x'], world: [0, 0, 0] }] },
  ]) assert.equal(parseTraceDocument(broken), null, JSON.stringify(broken).slice(0, 120));
});

test('頂点の候補: 稜線の端点を世界座標で集め、重なる角を 1 つにし、光の外と背後は選ばない', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const a = new THREE.Mesh(geometry), b = new THREE.Mesh(geometry), group = new THREE.Group();
  a.position.set(0, .5, -1); b.position.set(1, .5, -1);
  group.add(a, b); group.scale.set(2, 2, 2);
  const found = collectVertices([a, b]);
  assert.equal(found.length, 12, 'two boxes sharing a face have 12 distinct corners');
  assert.ok(found.some(v => Math.abs(v[0] - 3) < 1e-9 && Math.abs(v[1] - 2) < 1e-9 && Math.abs(v[2] + 1) < 1e-9), 'world matrix (parent scale) is applied');
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32));
  assert.equal(collectVertices([sphere]).length, 0, 'smooth surfaces have no outline corners');

  /** @type {Vec3} */
  const outside = [-40, 1, -3];
  /** @type {Vec3} */
  const behind = [0, 1, 20];
  assert.equal(projectToPixel(truth, OUTPUT, behind), null);
  const target = projectToPixel(truth, OUTPUT, WORLD.backLeft);
  assert.deepEqual(nearestProjectedVertex([outside, behind, WORLD.backLeft], truth, OUTPUT, [target[0] + 10, target[1]])?.world, WORLD.backLeft);
  assert.equal(nearestProjectedVertex([outside, behind], truth, OUTPUT, [0, 540], { radius: 1e6 }), null);
  assert.equal(nearestProjectedVertex([WORLD.backLeft], truth, OUTPUT, [target[0] + 50, target[1]]), null, 'outside the pick radius');
});

test('頂点の候補: プロジェクタから見て面に隠れた頂点 (壁の厚みの外側の角など) は飛ばし、次に近い見える頂点を選ぶ', () => {
  // 奥の壁 (厚み 0.15 m、内側の面が Z=−3) の内側と外側の左下の角。外側は壁に隠れて、内側のすぐ近くに映る。
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 3, .15), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1.5, -3.075);
  /** @type {Vec3} */
  const inner = [-4, 0, -3];
  /** @type {Vec3} */
  const outer = [-4, 0, -3.15];
  assert.equal(isVertexVisible([wall], truth, inner), true, 'a corner on the lit face is visible');
  assert.equal(isVertexVisible([wall], truth, outer), false, 'the hidden corner behind the wall is not');
  const at = projectToPixel(truth, OUTPUT, outer);
  const visible = world => isVertexVisible([wall], truth, world);
  assert.deepEqual(nearestProjectedVertex([inner, outer], truth, OUTPUT, at)?.world, outer, 'without the check the hidden corner is nearest');
  assert.deepEqual(nearestProjectedVertex([inner, outer], truth, OUTPUT, at, { visible })?.world, inner);
  assert.equal(nearestProjectedVertex([outer], truth, OUTPUT, at, { visible }), null);
});
