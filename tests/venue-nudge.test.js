import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dragRoll, dragRotate, dragTranslate, nudge, projectToNdc, projectorRay } from '../src/viewer/venue/ProjectorNudge.ts';

/** @returns {import('../src/viewer/practice/project.ts').Projector} */
function projector(overrides = {}) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.2, .3, .05, 'YXZ'));
  return { id: 'p', outputId: 'o', position: [.4, 1.6, 5], quaternion: [q.x, q.y, q.z, q.w],
    verticalFovDegrees: 40, aspect: 1.6, lensShift: [.1, .25], near: .1, far: 30, ...overrides };
}

/** 実際の描画と同じ three.js のカメラで点を NDC へ投影する (ProjectionPreview.setProjector と同じ組み立て)。 */
function threeNdc(config, point) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.fromArray(config.position); camera.quaternion.fromArray(config.quaternion); camera.updateMatrixWorld(true);
  const h = config.near * Math.tan(THREE.MathUtils.degToRad(config.verticalFovDegrees) / 2), w = h * config.aspect;
  camera.projectionMatrix.makePerspective(-w + 2*w*config.lensShift[0], w + 2*w*config.lensShift[0],
    h + 2*h*config.lensShift[1], -h + 2*h*config.lensShift[1], config.near, config.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const v = new THREE.Vector3(...point).project(camera);
  return [v.x, v.y];
}

/** 出力画像の NDC 座標。 @returns {[number, number]} */
const xy = (x, y) => [x, y];

/** @param {[number, number]} ndc */
function worldOnRay(config, ndc, distance = 4) {
  const dir = projectorRay(config, ndc[0], ndc[1]).applyQuaternion(new THREE.Quaternion(...config.quaternion));
  return new THREE.Vector3(...config.position).addScaledVector(dir, distance).toArray();
}

function near(actual, expected, tolerance = 1e-6) {
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < tolerance, `${actual} != ${expected}`));
}

test('projectorRay is the inverse of the lens-shifted projection used for rendering', () => {
  const config = projector();
  for (const ndc of [xy(0, 0), xy(-1, -1), xy(1, 1), xy(.3, -.7)]) {
    const point = worldOnRay(config, ndc);
    near(threeNdc(config, point), ndc);
    near(projectToNdc(config, point), ndc);
  }
  assert.equal(projectToNdc(config, new THREE.Vector3(...config.position).add(
    new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...config.quaternion))).toArray()), null);
});

test('dragging moves whatever was under the pointer to the new pointer position', () => {
  for (const config of [projector(), projector({ lensShift: [0, 0], aspect: 16 / 9, verticalFovDegrees: 70 })]) {
    const from = xy(-.4, .2), to = xy(.35, -.5), point = worldOnRay(config, from);
    const moved = dragRotate(config, from, to);
    near(threeNdc(moved, point), to);
    assert.deepEqual(moved.position, config.position);
    assert.ok(Math.abs(Math.hypot(...moved.quaternion) - 1) < 1e-9);
  }
});

test('nudges move the outline in the named direction in the output image', () => {
  const config = projector({ lensShift: [0, 0] }), point = worldOnRay(config, xy(0, 0), 5);
  const after = (action, amount) => threeNdc(nudge(config, action, amount), point);
  assert.ok(after('pan', 1)[0] > .01); assert.ok(Math.abs(after('pan', 1)[1]) < 1e-3);
  assert.ok(after('tilt', 1)[1] > .01); assert.ok(Math.abs(after('tilt', 1)[0]) < 1e-3);
  assert.ok(after('right', .1)[0] > .01); assert.ok(Math.abs(after('right', .1)[1]) < 1e-9);
  assert.ok(after('up', .1)[1] > .01); assert.ok(Math.abs(after('up', .1)[0]) < 1e-9);
  const offAxis = worldOnRay(config, xy(.5, 0), 5);
  assert.ok(threeNdc(nudge(config, 'roll', 5), offAxis)[1] > .01, 'a CCW roll lifts a point on the right');
  assert.ok(threeNdc(nudge(config, 'forward', .5), offAxis)[0] > .55, 'moving closer enlarges the outline');
  assert.ok(threeNdc(nudge(config, 'zoom', 2), offAxis)[0] > .52, 'zooming in enlarges the outline');
  assert.equal(nudge(config, 'zoom', -500).verticalFovDegrees, 170);
  assert.equal(nudge(config, 'zoom', 500).verticalFovDegrees, 1);
  assert.equal(nudge(config, 'zoom', 1.5).verticalFovDegrees, 38.5);
});

test('roll and translate drags carry what was under the pointer to the pointer', () => {
  const config = projector();
  const centre = xy(-2 * config.lensShift[0], -2 * config.lensShift[1]);
  // 光軸まわりに 90° 反時計回り: 右にあったものが上へ (縦横比を補正した半径は同じ)
  const from = xy(centre[0] + .3, centre[1]), to = xy(centre[0], centre[1] + .3 * config.aspect);
  const rolled = dragRoll(config, from, to);
  near(threeNdc(rolled, worldOnRay(config, from, 6)), to);
  near(threeNdc(rolled, worldOnRay(config, centre, 6)), centre);
  // 光軸方向の深さ depth の面上の点は、ドラッグに合わせてちょうど to へ動く
  const grab = xy(.2, .1), drop = xy(.5, -.2), wallPoint = worldOnRay(config, grab, 7);
  const depth = -projectorRay(config, grab[0], grab[1]).z * 7;
  near(threeNdc(dragTranslate(config, grab, drop, depth), wallPoint), drop);
});
