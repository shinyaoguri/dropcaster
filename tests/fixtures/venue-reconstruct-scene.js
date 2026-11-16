// 会場の逆算 (src/viewer/venue/venueReconstruct.ts) を検証・計測するための合成会場。
// 観測 (なぞった画素) は既存の ProjectorNudge.projectToNdc (three.js 経由) で作り、推定器の式を写さない。
import * as THREE from 'three';
import { projectToNdc } from '../../src/viewer/venue/ProjectorNudge.ts';

export const OUTPUT = { width: 1920, height: 1080 };

/**
 * 8 × 6 × 3 m の部屋 (床 Y=0、奥の壁 Z=−3、左右の壁 X=±4) と、床に置いた 1 m の箱 (中心 (0, .5, −1))、
 * 奥の壁のポスター (どこともつながらない長方形)。
 * @type {Record<string, [number, number, number]>}
 */
export const WORLD = {
  // 奥の左右の隅 (床と 2 枚の壁が集まる角) と、そこから伸びる辺の上の点
  backLeft: [-4, 0, -3], backLeftUp: [-4, 2, -3], backLeftSide: [-4, 0, -1.5],
  backRight: [4, 0, -3], backRightUp: [4, 2, -3], backRightSide: [4, 0, -1.5],
  // 箱の上面 (奥左 → 奥右 → 手前右 → 手前左) と前面の下の辺
  boxTopBackLeft: [-.5, 1, -1.5], boxTopBackRight: [.5, 1, -1.5],
  boxTopFrontRight: [.5, 1, -.5], boxTopFrontLeft: [-.5, 1, -.5],
  boxBottomFrontRight: [.5, 0, -.5], boxBottomFrontLeft: [-.5, 0, -.5],
  // 奥の壁のポスター
  posterTopLeft: [-1.5, 2.4, -3], posterTopRight: [-.3, 2.4, -3],
  posterBottomRight: [-.3, 1.6, -3], posterBottomLeft: [-1.5, 1.6, -3],
};

/**
 * 正解のプロジェクタ。客席の後ろ・やや右の高い位置から奥の壁を見下ろす。
 * @param {Partial<import('../../src/viewer/practice/project.ts').Projector>} [overrides]
 * @param {[number, number, number]} [target]
 * @returns {import('../../src/viewer/practice/project.ts').Projector}
 */
export function truthProjector(overrides = {}, target = [0, 1, -3]) {
  const camera = new THREE.PerspectiveCamera();
  const position = overrides.position ?? [.3, 2, 5];
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...target));
  camera.rotateZ(THREE.MathUtils.degToRad(1));
  const q = camera.quaternion;
  return {
    id: 'p', outputId: 'o', position, quaternion: [q.x, q.y, q.z, q.w],
    verticalFovDegrees: 50, aspect: OUTPUT.width / OUTPUT.height, lensShift: [0, .08], near: .1, far: 30,
    ...overrides,
  };
}

/** 再現できる一様乱数 (mulberry32)。 @param {number} seed */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 正解のプロジェクタで頂点を出力画素へ投影する (なぞった位置)。光の外の点は例外にする。
 * @param {import('../../src/viewer/practice/project.ts').Projector} projector
 * @param {string[]} ids
 * @param {{ noise?: number, rng?: () => number, world?: Record<string, [number, number, number]> }} [options]
 *   noise: 各軸 ±noise px の一様ノイズ
 * @returns {import('../../src/viewer/venue/venueReconstruct.ts').ReconstructVertex[]}
 */
export function observe(projector, ids, { noise = 0, rng = Math.random, world = WORLD } = {}) {
  return ids.map(id => {
    const ndc = projectToNdc(projector, world[id]);
    if (!ndc || Math.abs(ndc[0]) > 1 || Math.abs(ndc[1]) > 1) throw new Error(`${id} is outside the projector image`);
    const jitter = () => (rng() * 2 - 1) * noise;
    return { id, pixel: [(ndc[0] + 1) / 2 * OUTPUT.width + jitter(), (1 - ndc[1]) / 2 * OUTPUT.height + jitter()] };
  });
}

/** 部屋の隅 (凹)。shape を外すと凹凸の手掛かりなし。 */
const corner = (prefix, shape = 'concave') => ({
  kind: 'orthogonalCorner', corner: prefix, edges: [`${prefix}Up`, prefix === 'backLeft' ? 'backRight' : 'backLeft', `${prefix}Side`],
  ...(shape ? { shape } : {}),
});
/** 箱の手前右上の角 (凸)。 */
const boxCorner = { kind: 'orthogonalCorner', corner: 'boxTopFrontRight', edges: ['boxTopFrontLeft', 'boxTopBackRight', 'boxBottomFrontRight'], shape: 'convex' };
const cornerIds = (prefix) => [prefix, `${prefix}Up`, `${prefix}Side`];
const boxTop = { kind: 'rectangle', vertices: ['boxTopBackLeft', 'boxTopBackRight', 'boxTopFrontRight', 'boxTopFrontLeft'] };
const boxFront = { kind: 'rectangle', vertices: ['boxTopFrontLeft', 'boxTopFrontRight', 'boxBottomFrontRight', 'boxBottomFrontLeft'] };
const boxIds = ['boxTopBackLeft', 'boxTopBackRight', 'boxTopFrontRight', 'boxTopFrontLeft', 'boxBottomFrontRight', 'boxBottomFrontLeft'];
const floor = /** @type {[string, string, string]} */ (['backLeft', 'backRight', 'backLeftSide']);
// 部屋の縦の辺どうし、左右の壁の床の辺どうしは平行 (直方体の部屋の知識)。
const roomParallels = [
  { kind: 'parallel', segments: [['backLeft', 'backLeftUp'], ['backRight', 'backRightUp']] },
  { kind: 'parallel', segments: [['backLeft', 'backLeftSide'], ['backRight', 'backRightSide']] },
];
// 床に置いた箱の縦の辺は、部屋の縦の辺と平行。
const boxUpright = { kind: 'parallel', segments: [['boxBottomFrontLeft', 'boxTopFrontLeft'], ['backLeft', 'backLeftUp']] };
const poster = { kind: 'rectangle', vertices: ['posterTopLeft', 'posterTopRight', 'posterBottomRight', 'posterBottomLeft'] };
const posterIds = ['posterTopLeft', 'posterTopRight', 'posterBottomRight', 'posterBottomLeft'];

/**
 * なぞり方の構成。ids はなぞる頂点、elements は形の知識。
 * @type {Record<string, { label: string, ids: string[], elements: import('../../src/viewer/venue/venueReconstruct.ts').ReconstructElement[] }>}
 */
export const CONFIGS = {
  boxTwoFaces: { label: '箱の長方形 2 面 (上面＋前面)', ids: boxIds, elements: [boxTop, boxFront] },
  boxTwoFacesCorner: { label: '箱の長方形 2 面＋手前の角が凸', ids: boxIds, elements: [boxTop, boxFront, boxCorner] },
  oneCorner: { label: '部屋の隅 1 つ (凹)', ids: [...cornerIds('backLeft'), 'backRight'], elements: [corner('backLeft')] },
  oneCornerAmbiguous: { label: '部屋の隅 1 つ (凹凸の指定なし)', ids: [...cornerIds('backLeft'), 'backRight'], elements: [corner('backLeft', null)] },
  twoCorners: { label: '部屋の隅 2 つ (奥の辺を共有)', ids: [...cornerIds('backLeft'), ...cornerIds('backRight')], elements: [corner('backLeft'), corner('backRight')] },
  room: {
    label: '部屋の隅 2 つ＋平行 (縦の辺どうし・左右の床の辺どうし)',
    ids: [...cornerIds('backLeft'), ...cornerIds('backRight')],
    elements: [corner('backLeft'), corner('backRight'), ...roomParallels],
  },
  roomAndBox: {
    label: '部屋 (隅 2 つ＋平行)＋箱 (上面・前面、接地、縦の辺が部屋と平行)',
    ids: [...cornerIds('backLeft'), ...cornerIds('backRight'), ...boxIds],
    elements: [corner('backLeft'), corner('backRight'), ...roomParallels, boxTop, boxFront, boxUpright,
      { kind: 'onPlane', vertex: 'boxBottomFrontLeft', plane: floor },
      { kind: 'onPlane', vertex: 'boxBottomFrontRight', plane: floor }],
  },
  cornersAndBox: {
    label: '部屋の隅 2 つ＋箱 (上面・前面、前面の下を床に接地)',
    ids: [...cornerIds('backLeft'), ...cornerIds('backRight'), ...boxIds],
    elements: [corner('backLeft'), corner('backRight'), boxTop, boxFront,
      { kind: 'onPlane', vertex: 'boxBottomFrontLeft', plane: floor },
      { kind: 'onPlane', vertex: 'boxBottomFrontRight', plane: floor }],
  },
  cornersAndBoxTopOnly: {
    label: '部屋の隅 2 つ＋箱の上面だけ (高さの手掛かりなし)',
    ids: [...cornerIds('backLeft'), ...cornerIds('backRight'), ...boxIds.slice(0, 4)],
    elements: [corner('backLeft'), corner('backRight'), boxTop],
  },
  frontalPoster: { label: '正面向きの長方形 1 つ (ポスター)', ids: posterIds, elements: [poster] },
  disconnected: { label: '箱 2 面＋つながらないポスター', ids: [...boxIds, ...posterIds], elements: [boxTop, boxFront, poster] },
};

/**
 * 正解の頂点をプロジェクタ座標 (Rᵀ (X − p)) へ移す。なぞるモードの推定結果と比べるため。
 * @param {import('../../src/viewer/practice/project.ts').Projector} projector
 * @param {string} id
 * @returns {[number, number, number]}
 */
export function truthInProjectorFrame(projector, id) {
  const v = new THREE.Vector3(...WORLD[id]).sub(new THREE.Vector3(...projector.position))
    .applyQuaternion(new THREE.Quaternion(...projector.quaternion).invert());
  return [v.x, v.y, v.z];
}

/**
 * なぞるモードの推定頂点 (プロジェクタ座標・縮尺は仮) を正解と比べる。
 * 縮尺 s は最小二乗で合わせ、合わせた後の頂点誤差 (m) を返す。
 * @param {import('../../src/viewer/practice/project.ts').Projector} projector
 * @param {Record<string, [number, number, number]>} estimated
 * @param {string[]} ids
 */
export function compareUpToScale(projector, estimated, ids) {
  let num = 0, den = 0;
  for (const id of ids) {
    const e = estimated[id], t = truthInProjectorFrame(projector, id);
    num += e[0] * t[0] + e[1] * t[1] + e[2] * t[2];
    den += e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  }
  const s = num / den;
  const errors = ids.map(id => {
    const e = estimated[id], t = truthInProjectorFrame(projector, id);
    return Math.hypot(s * e[0] - t[0], s * e[1] - t[1], s * e[2] - t[2]);
  });
  return { scale: s, maxError: Math.max(...errors), errors };
}
