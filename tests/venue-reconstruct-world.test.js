import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { reconstructVenue } from '../src/viewer/venue/venueReconstruct.ts';
import { reconstructionToVenue } from '../src/viewer/venue/reconstructionToVenue.ts';
import { projectToNdc, projectorRay } from '../src/viewer/venue/ProjectorNudge.ts';
import { createProject, defaultScene, importVenue, parseProject, portableVenue } from '../src/viewer/practice/project.ts';
import { CONFIGS, OUTPUT, WORLD, observe, random, truthProjector } from './fixtures/venue-reconstruct-scene.js';

// 観測 (なぞった画素) は fixtures の observe が既存の ProjectorNudge.projectToNdc で作る。
// 正解は fixtures の世界座標 (床 Y=0・奥の壁 Z=−3・客席 +Z)。原点の決め方に依存しないよう、
// 位置は基準の頂点からの相対で比べる。

const front = truthProjector();
const oblique = truthProjector({ position: [2.6, 2.4, 2.5] }, [-2.5, .8, -2.2]);
const throwRatioPrior = { degrees: 50, sigmaDegrees: 2 };
/** @type {Pick<import('../src/viewer/venue/venueReconstruct.ts').ReconstructInput, 'initial' | 'locked'>} */
const knownIntrinsics = { locked: ['fov', 'lensShiftX', 'lensShiftY'], initial: { verticalFovDegrees: 50, lensShift: [0, .08] } };
const base = createProject().venue.projectors[0];
/** @param {string} role @param {number} index */
const name = (role, index) => `${role}${index}`;
/** @type {import('../src/viewer/venue/venueReconstruct.ts').ReconstructElement} */
const backWidth = { kind: 'length', vertices: ['backLeft', 'backRight'], meters: 8 };

/**
 * @param {import('../src/viewer/practice/project.ts').Projector} projector
 * @param {keyof typeof CONFIGS} key
 * @param {Partial<import('../src/viewer/venue/venueReconstruct.ts').ReconstructInput> & { noise?: number }} [extra]
 */
function convert(projector, key, { noise = 0, ...extra } = {}) {
  const config = CONFIGS[key];
  const input = {
    output: OUTPUT, vertices: observe(projector, config.ids, { noise, rng: random(7) }),
    ...extra, elements: [...config.elements, ...(extra.elements ?? [])],
  };
  const result = reconstructVenue(input);
  return { input, result, venue: reconstructionToVenue(input, result, { projector: base, name }) };
}

/** @param {ReturnType<typeof convert>['venue']} venue */
function ok(venue) {
  assert.equal(venue.status, 'ok', venue.status === 'failed' ? venue.reason : '');
  return /** @type {Extract<typeof venue, { status: 'ok' }>} */ (venue);
}

const diff = (a, b) => a.map((v, i) => v - b[i]);
const length = v => Math.hypot(...v);
const direction = (from, to) => { const d = diff(to, from); return d.map(v => v / length(d)); };
/** @param {number[]} actual @param {number[]} expected @param {number} tolerance @param {string} label */
function near(actual, expected, tolerance, label) {
  assert.ok(length(diff(actual, expected)) <= tolerance, `${label}: ${actual.map(v => v.toFixed(4))} ≠ ${expected.map(v => v.toFixed(4))}`);
}
/** 2 つの四元数の間の回転角 (度)。 */
function angleBetween(a, b) {
  return THREE.MathUtils.radToDeg(new THREE.Quaternion(...a).normalize().angleTo(new THREE.Quaternion(...b).normalize()));
}
const byName = (venue, label) => venue.objects.find(o => o.name === label);
/** 部材の局所軸の世界での向き。 */
const axisOf = (object, axis) => { const v = new THREE.Vector3(...axis).applyQuaternion(new THREE.Quaternion(...object.quaternion)); return [v.x, v.y, v.z]; };

/** 世界座標のプロジェクタで世界座標の頂点を投影し直すと、なぞった画素に戻る (three.js 経由で独立に確かめる)。 */
function assertReprojects(venue, input, tolerancePixels) {
  for (const v of input.vertices) {
    const point = venue.vertices[v.id];
    if (!point || !v.pixel) continue;
    const ndc = projectToNdc(venue.projector, point);
    assert.ok(ndc, `${v.id} is behind the projector`);
    const pixel = [(ndc[0] + 1) / 2 * OUTPUT.width, (1 - ndc[1]) / 2 * OUTPUT.height];
    near(pixel, v.pixel, tolerancePixels, `reprojection of ${v.id}`);
  }
}

test('部屋と箱を実寸でなぞると、床が Y=0・縦の辺が +Y・奥の壁が −Z 側になり、箱は床に載る', () => {
  const { input, venue: converted } = convert(front, 'roomAndBox', { fovPrior: throwRatioPrior, elements: [backWidth] });
  const venue = ok(converted);
  const v = venue.vertices;
  assert.equal(venue.basis, 'room');
  assert.equal(venue.scaleKnown, true);
  assert.deepEqual(venue.skipped, []);
  near(direction(v.backLeft, v.backLeftUp), [0, 1, 0], 1e-4, 'room vertical edge');
  near(direction(v.backLeft, v.backRight), [1, 0, 0], 1e-4, 'back wall floor edge');
  near(direction(v.backLeft, v.backLeftSide), [0, 0, 1], 1e-4, 'side wall floor edge points to the audience');
  assert.ok(Math.abs(v.backLeft[1]) < 1e-6 && Math.abs(v.backRight[1]) < 1e-4, 'room corners on the floor');

  const floor = byName(venue, 'floor0'), back = byName(venue, 'back0'), left = byName(venue, 'left0'), right = byName(venue, 'right0');
  assert.ok(floor && back && left && right, venue.objects.map(o => o.name).join(','));
  assert.ok(Math.abs(floor.position[1] + floor.size[1] / 2) < 1e-9, 'floor top at Y=0');
  assert.ok(Math.abs(back.position[2] + back.size[2] / 2 - v.backLeft[2]) < 1e-4, 'back wall inner face through the traced corner');
  assert.ok(v.backLeft[2] < 0 && venue.objects.every(o => o.position[2] >= back.position[2]), 'back wall is the −Z end');
  assert.ok(Math.abs(left.position[0] + left.size[0] / 2 - v.backLeft[0]) < 1e-4, 'left wall inner face');
  assert.ok(Math.abs(right.position[0] - right.size[0] / 2 - v.backRight[0]) < 1e-4, 'right wall inner face');
  near([back.size[0] - .3, back.size[1]], [8, back.size[1]], 1e-3, 'room width between the corners');

  const box = byName(venue, 'box0');
  assert.ok(box, 'box created');
  near(box.size, [1, 1, 1], 1e-3, 'box size');
  assert.ok(Math.abs(box.position[1] - box.size[1] / 2) < 1e-9, 'box bottom at Y=0');
  near(diff(box.position, v.backLeft), diff([0, .5, -1], WORLD.backLeft), 1e-3, 'box centre relative to the corner');

  // 実寸があれば、プロジェクタの位置・向き・画角は正解と一致する。
  near(diff(venue.projector.position, v.backLeft), diff(front.position, WORLD.backLeft), 1e-3, 'projector position');
  assert.ok(angleBetween(venue.projector.quaternion, front.quaternion) < .01, `projector rotation ${angleBetween(venue.projector.quaternion, front.quaternion)}°`);
  assert.ok(Math.abs(venue.projector.verticalFovDegrees - 50) < 1e-3);
  assert.deepEqual([venue.projector.id, venue.projector.outputId, venue.projector.near, venue.projector.far],
    [base.id, base.outputId, base.near, base.far]);
  assertReprojects(venue, input, 1e-3);
});

test('±1 px のノイズでも、床・上・奥の向きと箱の接地は保たれる', () => {
  const { input, venue: converted } = convert(front, 'roomAndBox', { fovPrior: throwRatioPrior, elements: [backWidth], noise: 1 });
  const venue = ok(converted);
  const v = venue.vertices;
  const tilt = THREE.MathUtils.radToDeg(Math.acos(direction(v.backLeft, v.backLeftUp)[1]));
  assert.ok(tilt < 2, `vertical edge tilt ${tilt}°`);
  assert.ok(Math.min(...Object.values(v).map(p => p[1])) === 0, 'lowest vertex on the floor');
  assert.ok(v.backLeftSide[2] > v.backLeft[2] && v.backRight[0] > v.backLeft[0]);
  const box = byName(venue, 'box0');
  assert.ok(box && Math.abs(box.position[1] - box.size[1] / 2) < 1e-9);
  assert.ok(angleBetween(venue.projector.quaternion, front.quaternion) < 3);
  assertReprojects(venue, input, 4);
});

test('縮尺が未設定でも、部材とプロジェクタが実寸のときと同じ比率で出て、未設定と分かる', () => {
  const known = ok(convert(front, 'roomAndBox', { fovPrior: throwRatioPrior, elements: [backWidth] }).venue);
  const unknown = ok(convert(front, 'roomAndBox', { fovPrior: throwRatioPrior }).venue);
  assert.equal(unknown.scaleKnown, false);
  const s = length(diff(known.vertices.backRight, known.vertices.backLeft)) / length(diff(unknown.vertices.backRight, unknown.vertices.backLeft));
  assert.ok(Math.abs(s - 1) > .1, `the assumed scale should differ from metres (s = ${s})`);
  for (const id of Object.keys(known.vertices)) near(unknown.vertices[id].map(x => x * s), known.vertices[id], 1e-3, id);
  near(unknown.projector.position.map(x => x * s), known.projector.position, 1e-3, 'projector position');
  near(byName(unknown, 'box0').size.map(x => x * s), byName(known, 'box0').size, 1e-3, 'box size');
  near(byName(unknown, 'box0').position.map(x => x * s), byName(known, 'box0').position, 1e-3, 'box position');
  assert.ok(angleBetween(unknown.projector.quaternion, known.projector.quaternion) < .01);
});

test('変換した部材とプロジェクタは既存の parseProject と会場ファイル (Venue package v2) をそのまま通る', () => {
  const project = createProject();
  const { input, result } = convert(front, 'roomAndBox', { fovPrior: throwRatioPrior, elements: [backWidth] });
  const venue = ok(reconstructionToVenue(input, result, { projector: project.venue.projectors[0], name }));
  project.venue.scene = { ...defaultScene(), kind: 'objects', objects: venue.objects };
  project.venue.projectors = [venue.projector];
  const parsed = parseProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(parsed.venue.scene.objects, venue.objects);
  assert.deepEqual(parsed.venue.projectors, [venue.projector]);
  const shared = portableVenue(parsed);
  assert.deepEqual([shared.format, shared.schemaVersion], ['dropcaster-venue', 2]);
  assert.deepEqual(Object.keys(shared.venue).sort(), Object.keys(createProject().venue).sort(), 'no new fields in the venue file');
  const imported = importVenue(JSON.parse(JSON.stringify(shared)), createProject());
  assert.deepEqual(imported.venue.scene.objects, venue.objects);
});

test('決まらない頂点を含む部品は作らず、理由を返す', () => {
  // 画角とシフトを与えても、どこともつながらないポスターは距離が決まらない。
  const venue = ok(convert(front, 'disconnected', knownIntrinsics).venue);
  assert.deepEqual(venue.objects.map(o => o.name), ['box0']);
  assert.deepEqual(venue.skipped, [{ vertices: ['posterTopLeft', 'posterTopRight', 'posterBottomRight', 'posterBottomLeft'], reason: 'underdetermined' }]);
  assert.equal(venue.vertices.posterTopLeft, undefined);

  // 正面から箱だけを投射比なしでなぞると、何も決まらない。
  assert.deepEqual(convert(front, 'boxTwoFaces').venue, { status: 'failed', reason: 'nothingDetermined' });
});

test('推定に失敗した結果と、測った会場モードの結果は変換しない', () => {
  const { input, result } = convert(front, 'room', { fovPrior: throwRatioPrior });
  const options = { projector: base, name };
  assert.deepEqual(reconstructionToVenue(input, { ...result, status: 'failed' }, options), { status: 'failed', reason: 'reconstructionFailed' });
  assert.deepEqual(reconstructionToVenue(input, { ...result, frame: 'world' }, options), { status: 'failed', reason: 'measuredFrame' });
});

test('部屋の隅が無いときは、箱の縦の辺を上にし、最も低い頂点 (箱の底) を床にする', () => {
  const { input, venue: converted } = convert(oblique, 'boxTwoFaces');
  const venue = ok(converted);
  const v = venue.vertices;
  assert.equal(venue.basis, 'objects');
  near(direction(v.boxBottomFrontLeft, v.boxTopFrontLeft), [0, 1, 0], 1e-4, 'box vertical edge');
  assert.ok(Math.abs(v.boxBottomFrontLeft[1]) < 1e-9 && Math.abs(v.boxBottomFrontRight[1]) < 1e-4, 'box bottom on the floor');
  const box = byName(venue, 'box0');
  const s = 1 / box.size[0];
  near(box.size.map(x => x * s), [1, 1, 1], 1e-3, 'cube proportions');
  // 客席側 (+Z) は、箱の面のうちプロジェクタへ向かう水平方向に近いほう。正解の世界座標と同じ向きになる。
  near(diff(venue.projector.position, v.boxBottomFrontLeft).map(x => x * s), diff(oblique.position, WORLD.boxBottomFrontLeft), 1e-3, 'projector relative to the box');
  assert.ok(angleBetween(venue.projector.quaternion, oblique.quaternion) < .01);
  assertReprojects(venue, input, 1e-3);
});

test('長方形 1 枚だけなら、下辺を床に置き、プロジェクタへ向く薄い壁にする', () => {
  const { input, venue: converted } = convert(front, 'frontalPoster', knownIntrinsics);
  const venue = ok(converted);
  const v = venue.vertices;
  assert.equal(venue.basis, 'objects');
  assert.ok(Math.abs(v.posterBottomLeft[1]) < 1e-6 && Math.abs(v.posterBottomRight[1]) < 1e-4, 'lower edge on the floor');
  near(direction(v.posterBottomLeft, v.posterTopLeft), [0, 1, 0], 1e-4, 'poster vertical edge');
  const panel = byName(venue, 'panel0');
  assert.equal(panel.kind, 'wall');
  near(axisOf(panel, [0, 0, 1]), [0, 0, 1], 1e-4, 'panel faces the audience');
  near(axisOf(panel, [0, 1, 0]), [0, 1, 0], 1e-4, 'panel local Y is up');
  assert.ok(Math.abs(panel.size[0] / panel.size[1] - 1.5) < 1e-3, `poster aspect ${panel.size[0] / panel.size[1]}`);
  assert.equal(panel.size[2], .15);
  assert.ok(Math.abs(panel.position[2] + panel.size[2] / 2 - v.posterTopLeft[2]) < 1e-4, 'thickness behind the face');
  assertReprojects(venue, input, 1e-3);
});

test('部屋の隅 1 つなら、その側の壁と床だけを作り、なぞっていない方向は光の届く範囲まで延ばす', () => {
  const { venue: converted } = convert(front, 'oneCorner', { fovPrior: throwRatioPrior, locked: ['lensShiftX', 'lensShiftY'], initial: { lensShift: /** @type {[number, number]} */ ([0, .08]) } });
  const venue = ok(converted);
  const v = venue.vertices;
  assert.deepEqual(venue.objects.map(o => o.name), ['floor0', 'back0', 'left0']);
  const back = byName(venue, 'back0');
  const inner = back.position[2] + back.size[2] / 2;
  const rightEnd = back.position[0] + back.size[0] / 2 - .15;
  assert.ok(back.size[1] > v.backLeftUp[1] * 1.2, `back wall height ${back.size[1]} extends above the traced edge ${v.backLeftUp[1]}`);
  assert.ok(rightEnd > v.backRight[0], 'back wall extends past the traced point');
  // 出力画像の 4 隅の光は、奥の壁の範囲に収まる (三角の向きは three.js で独立に計算)。
  const q = new THREE.Quaternion(...venue.projector.quaternion);
  const origin = new THREE.Vector3(...venue.projector.position);
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const ray = projectorRay(venue.projector, x, y).applyQuaternion(q);
    const hit = origin.clone().addScaledVector(ray, (inner - origin.z) / ray.z);
    assert.ok(hit.y <= back.size[1] + 1e-6 && hit.x <= rightEnd + 1e-6, `image corner (${x}, ${y}) at ${hit.x.toFixed(3)}, ${hit.y.toFixed(3)}`);
  }
  const left = byName(venue, 'left0');
  assert.ok(left.position[2] + left.size[2] / 2 >= venue.projector.position[2] - 1e-6, 'side wall reaches the projector');
});
