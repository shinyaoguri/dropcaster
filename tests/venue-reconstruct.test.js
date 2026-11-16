import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { estimateIntrinsicsFromRectangles, reconstructVenue } from '../src/viewer/venue/venueReconstruct.ts';
import { CONFIGS, OUTPUT, WORLD, compareUpToScale, observe, truthInProjectorFrame, truthProjector } from './fixtures/venue-reconstruct-scene.js';

// 観測 (なぞった画素) は fixtures の observe が既存の ProjectorNudge.projectToNdc で作る。推定器の投影式は写さない。

const front = truthProjector();
/** 客席の右前から部屋の左奥の隅を斜めに狙う配置 (隅に投影する現場を想定)。 */
const oblique = truthProjector({ position: [2.6, 2.4, 2.5] }, [-2.5, .8, -2.2]);
const throwRatioPrior = { degrees: 50, sigmaDegrees: 2 };

/** @param {import('../src/viewer/practice/project.ts').Projector} projector @param {keyof typeof CONFIGS} key */
function solve(projector, key, extra = {}) {
  const config = CONFIGS[key];
  return reconstructVenue({ output: OUTPUT, vertices: observe(projector, config.ids), elements: config.elements, ...extra });
}

/** 2 つの四元数の間の回転角 (度)。 */
function angleBetween(a, b) {
  const qa = new THREE.Quaternion(...a).normalize(), qb = new THREE.Quaternion(...b).normalize();
  return THREE.MathUtils.radToDeg(qa.angleTo(qb));
}

test('ノイズなしの部屋と箱から、画角・レンズシフト・縮尺を合わせた頂点が戻る', () => {
  const config = CONFIGS.roomAndBox;
  const result = solve(front, 'roomAndBox', { fovPrior: throwRatioPrior });
  assert.equal(result.frame, 'projector');
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  assert.ok(Math.abs(result.projector.verticalFovDegrees - 50) < 1e-4, `fov ${result.projector.verticalFovDegrees}`);
  assert.ok(Math.abs(result.projector.lensShift[1] - .08) < 1e-5, `shift ${result.projector.lensShift[1]}`);
  assert.deepEqual(result.projector.position, [0, 0, 0]);
  assert.ok(compareUpToScale(front, result.vertices, config.ids).maxError < 1e-6);
  assert.ok(result.rmsPixels < 1e-6);
  assert.equal(result.scaleKnown, false);
  assert.deepEqual(result.outliers, []);
});

test('投射比なしでも、斜めから見た箱の 2 面から画角が戻る (正面配置では決まらない)', () => {
  const obliqueResult = solve(oblique, 'boxTwoFaces');
  assert.ok(Math.abs(obliqueResult.projector.verticalFovDegrees - 50) < 1e-4);
  assert.ok(!obliqueResult.underdetermined.includes('fov'), obliqueResult.underdetermined.join(','));
  assert.ok((obliqueResult.uncertainty.fovDegrees ?? Infinity) < 2);

  const frontResult = solve(front, 'boxTwoFaces');
  assert.ok(frontResult.underdetermined.includes('fov'), 'a small box seen squarely gives too little perspective');
});

test('1 か所の長さを入れると縮尺がメートルに確定する', () => {
  const config = CONFIGS.room;
  const result = reconstructVenue({
    output: OUTPUT, vertices: observe(front, config.ids), fovPrior: throwRatioPrior,
    elements: [...config.elements, { kind: 'length', vertices: ['backLeft', 'backRight'], meters: 8 }],
  });
  assert.equal(result.scaleKnown, true);
  for (const id of config.ids) {
    const expected = truthInProjectorFrame(front, id);
    const actual = result.vertices[id];
    assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]) < 1e-5, id);
  }
});

test('測った頂点を固定すると、同じ推定器でプロジェクタ条件だけが戻る (#158)', () => {
  const config = CONFIGS.roomAndBox;
  const vertices = observe(front, config.ids).map(v => ({ ...v, fixed: WORLD[v.id] }));
  const off = new THREE.Quaternion(...front.quaternion)
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.06, -.05, .03)));
  const result = reconstructVenue({
    output: OUTPUT, vertices, elements: [],
    initial: { position: [front.position[0] + .4, front.position[1] - .2, front.position[2] + .3],
      quaternion: [off.x, off.y, off.z, off.w], verticalFovDegrees: 44 },
  });
  assert.equal(result.frame, 'world');
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  assert.equal(result.scaleKnown, true);
  result.projector.position.forEach((v, i) => assert.ok(Math.abs(v - front.position[i]) < 1e-5, `position ${i}`));
  assert.ok(angleBetween(result.projector.quaternion, front.quaternion) < 1e-4);
  assert.ok(Math.abs(result.projector.verticalFovDegrees - 50) < 1e-4);
  assert.ok(Math.abs(result.projector.lensShift[1] - .08) < 1e-5);
});

test('固定頂点があるのに初期の姿勢が無ければ例外にする', () => {
  assert.throws(() => reconstructVenue({
    output: OUTPUT, vertices: [{ id: 'a', pixel: [10, 10], fixed: [0, 0, 0] }], elements: [],
  }), /initial position and quaternion/);
});

test('失敗系: 正面向きの長方形 1 つでは画角が決まらないと返す', () => {
  const squarely = truthProjector({ position: [-.9, 2, 5] }, [-.9, 2, -3]);
  const result = solve(squarely, 'frontalPoster');
  assert.equal(result.status, 'underdetermined');
  assert.ok(result.underdetermined.includes('fov'), result.underdetermined.join(','));
});

test('失敗系: 部屋の隅 1 つだけでは画角が決まらず、投射比を与えると決まる', () => {
  const alone = solve(front, 'oneCorner');
  assert.ok(alone.underdetermined.includes('fov'), alone.underdetermined.join(','));
  const withPrior = solve(front, 'oneCorner', { fovPrior: { degrees: 50, sigmaDegrees: 1 } });
  assert.ok(!withPrior.underdetermined.includes('fov'), withPrior.underdetermined.join(','));
});

test('部屋の隅 1 つでも、凹と指定し画角とレンズシフトを仕様値で与えれば、凸の解に取り違えず戻る', () => {
  // 隅 1 つの拘束は 3 本なので、会場の回転 3 を決めると画角・レンズシフトは残らない。仕様値で固定する。
  /** @type {Pick<import('../src/viewer/venue/venueReconstruct.ts').ReconstructInput, 'initial' | 'locked'>} */
  const known = { initial: { verticalFovDegrees: 50, lensShift: [0, .08] }, locked: ['fov', 'lensShiftX', 'lensShiftY'] };
  const result = solve(front, 'oneCorner', known);
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  assert.ok(compareUpToScale(front, result.vertices, CONFIGS.oneCorner.ids).maxError < 1e-4);
  // 同じ像を凸と指定すると、反対側の解釈に寄せられて正解から離れる (指定が効いていることの確認)。
  const flipped = CONFIGS.oneCorner.elements.map(e => e.kind === 'orthogonalCorner' ? { ...e, shape: /** @type {const} */ ('convex') } : e);
  const wrong = reconstructVenue({ output: OUTPUT, vertices: observe(front, CONFIGS.oneCorner.ids), elements: flipped, ...known });
  assert.ok(compareUpToScale(front, wrong.vertices, CONFIGS.oneCorner.ids).maxError > .5);
});

test('失敗系: どこともつながらない面は、その頂点の奥行きが決まらないと返す', () => {
  const result = solve(oblique, 'disconnected');
  assert.equal(result.status, 'underdetermined');
  for (const id of CONFIGS.disconnected.ids) {
    assert.equal(result.underdetermined.includes(`vertex:${id}`), id.startsWith('poster'), id);
  }
});

test('失敗系: 箱の上面だけでは箱の高さが決まらない', () => {
  const result = solve(front, 'cornersAndBoxTopOnly', { fovPrior: throwRatioPrior });
  for (const id of CONFIGS.cornersAndBoxTopOnly.ids) {
    assert.equal(result.underdetermined.includes(`vertex:${id}`), id.startsWith('box'), id);
  }
});

test('失敗系: 取り違えた 1 点を外れ値として最初に挙げる', () => {
  const config = CONFIGS.roomAndBox;
  const vertices = observe(front, config.ids).map(v => v.id === 'boxTopFrontRight'
    ? { ...v, pixel: /** @type {[number, number]} */ ([v.pixel[0] + 30, v.pixel[1] - 20]) } : v);
  const result = reconstructVenue({ output: OUTPUT, vertices, elements: config.elements, fovPrior: throwRatioPrior });
  assert.equal(result.outliers[0], 'boxTopFrontRight', JSON.stringify(result.residualPixels));
});

test('入力の誤り: 重複した頂点 id と、要素が参照する未知の id を拒否する', () => {
  assert.throws(() => reconstructVenue({ output: OUTPUT, vertices: [{ id: 'a' }, { id: 'a' }], elements: [] }), /duplicate/);
  assert.throws(() => reconstructVenue({
    output: OUTPUT, vertices: [{ id: 'a' }], elements: [{ kind: 'length', vertices: ['a', 'b'], meters: 1 }],
  }), /unknown vertex id: b/);
});

test('長方形の消失点から画角と縦のレンズシフトを線形に初期推定する', () => {
  const config = CONFIGS.boxTwoFaces;
  const estimate = estimateIntrinsicsFromRectangles(
    { output: OUTPUT, vertices: observe(oblique, config.ids), elements: config.elements }, [0, 0], true);
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.verticalFovDegrees - 50) < 1e-6, `fov ${estimate.verticalFovDegrees}`);
  assert.ok(Math.abs(estimate.lensShiftY - .08) < 1e-6, `shift ${estimate.lensShiftY}`);
  // 長方形が 1 つも無ければ推定しない
  assert.equal(estimateIntrinsicsFromRectangles(
    { output: OUTPUT, vertices: observe(front, CONFIGS.room.ids), elements: CONFIGS.room.elements }, [0, 0], true), null);
});

test('凸の角は、プロジェクタから 2 面しか見えない配置でも正解の解に戻る (#246)', () => {
  // 正面のプロジェクタ (x = 0.3) は箱の右の面 (x = 0.5) より内側にあり、角の 3 本の辺のすべての外側にはいない。
  // 凸の拘束は「内側の 8 分円にいない」ことだけを求め、反対側の解釈 (凹の隅) だけを除く。
  /** @type {import('../src/viewer/venue/venueReconstruct.ts').ReconstructElement} */
  const boxCorner = { kind: 'orthogonalCorner', corner: 'boxTopFrontRight', edges: ['boxBottomFrontRight', 'boxTopFrontLeft', 'boxTopBackRight'], shape: 'convex' };
  const result = solve(front, 'roomAndBox', { fovPrior: throwRatioPrior, elements: [...CONFIGS.roomAndBox.elements, boxCorner] });
  assert.equal(result.status, 'ok', result.underdetermined.join(','));
  assert.ok(result.rmsPixels < 1e-3, `rms ${result.rmsPixels}`);
  assert.ok(compareUpToScale(front, result.vertices, CONFIGS.roomAndBox.ids).maxError < 1e-4);
  // 凸と指定した角を、内側から見た凹の隅として解く解釈は罰する。
  const oneBox = reconstructVenue({ output: OUTPUT, vertices: observe(oblique, CONFIGS.boxTwoFacesCorner.ids), elements: CONFIGS.boxTwoFacesCorner.elements });
  assert.ok(compareUpToScale(oblique, oneBox.vertices, CONFIGS.boxTwoFacesCorner.ids).maxError < 1e-3);
});
