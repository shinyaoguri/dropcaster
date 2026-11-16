import type { Projector, Quaternion, Vec3 } from '../practice/project.ts';
import { quadHomography } from '../utils/mappingTransform.ts';
import { covariance, levenbergMarquardt, type ResidualFunction } from './leastSquares.ts';

/**
 * 壁の上でなぞった実物の角 (出力画素) と、「長方形」「直交する角」「接地」などの形の知識から、
 * 会場の頂点とプロジェクタ条件を逆算する (#242 / #243)。
 *
 * プロジェクタは逆向きのカメラなので、壁の上で指した位置はプロジェクタ画素での像そのもの。
 * 未知数「プロジェクタ (位置・回転・縦画角・レンズシフト) ＋自由頂点」の再投影誤差と形の拘束を、
 * 1 つの Levenberg–Marquardt でまとめて最小化する。
 *
 * - なぞるモード: 固定頂点が無いとき。プロジェクタを原点・単位回転にロックし、プロジェクタ座標で解く
 *   (世界座標の 6 自由度は決まらないため)。縮尺は length 要素があればそれで、無ければ
 *   「最初の要素のなぞった点の重心までの距離 = assumedDistance」で仮に固定し、scaleKnown: false を返す。
 * - 測った会場モード (#158): 頂点に fixed (世界座標) があるとき。プロジェクタの姿勢と内部パラメータを解く。
 *
 * 投影の規約は ProjectorNudge.projectToNdc と同じ (カメラは −Z 向き、+X 右、+Y 上、
 * NDC = 視錐台座標 − 2 × lensShift)。出力画素は左上原点・y 下向き。
 */

export type PixelPoint = [number, number];

export interface ReconstructVertex {
  id: string;
  /** なぞった位置 (出力画素、左上原点・y 下向き)。光が当たらない頂点は省略できる。 */
  pixel?: PixelPoint;
  /** 測った世界座標 (m)。1 つでもあれば測った会場モードになる。 */
  fixed?: Vec3;
}

export type ReconstructElement =
  /** 実物の長方形。頂点は周に沿った順 (a → b → c → d)。 */
  | { kind: 'rectangle'; vertices: [string, string, string, string] }
  /**
   * 直交する 3 本の辺が集まる角。edges は各辺の上の点 (別の角の頂点でもよい)。
   * shape は凹 (部屋の隅のように内側から見る) か凸 (箱の角のように外側から見る) か。
   * 1 枚の像では両者を区別できない (ネッカーの立方体と同じ) ので、分かるなら必ず指定する。
   */
  | { kind: 'orthogonalCorner'; corner: string; edges: [string, string, string]; shape?: 'concave' | 'convex' }
  /** 頂点が 3 頂点の張る平面の上にある (接地など)。 */
  | { kind: 'onPlane'; vertex: string; plane: [string, string, string] }
  /** 2 本の辺が平行 (部屋の縦の辺どうし、向かい合う壁の床の辺など)。 */
  | { kind: 'parallel'; segments: [[string, string], [string, string]] }
  /** 測った 2 頂点間の距離 (m)。縮尺が決まる。 */
  | { kind: 'length'; vertices: [string, string]; meters: number };

export type ProjectorParameter = 'position' | 'rotation' | 'fov' | 'lensShiftX' | 'lensShiftY';

export type EstimatedProjector = Pick<Projector, 'position' | 'quaternion' | 'verticalFovDegrees' | 'aspect' | 'lensShift'>;

export interface ReconstructInput {
  output: { width: number; height: number };
  vertices: ReconstructVertex[];
  elements: ReconstructElement[];
  /** 初期値。測った会場モードでは position / quaternion が必要。 */
  initial?: Partial<Pick<Projector, 'position' | 'quaternion' | 'verticalFovDegrees' | 'lensShift'>>;
  /** 投射比の仕様などから分かる縦画角の事前分布。 */
  fovPrior?: { degrees: number; sigmaDegrees: number };
  /**
   * 推定しない (初期値に固定する) パラメータ。既定はなぞるモードで position / rotation / lensShiftX、
   * 測った会場モードで lensShiftX。なぞるモードの position / rotation は常にロックする。
   */
  locked?: ProjectorParameter[];
  /** なぞるモードで縮尺が分からないときに仮に置く、プロジェクタから最初の要素の重心までの距離 (m)。 */
  assumedDistance?: number;
}

export interface ReconstructResult {
  /** ok: 全未知数が決まった / underdetermined: 観測と拘束では決まらない量がある (値は参考) / failed: 解けなかった */
  status: 'ok' | 'underdetermined' | 'failed';
  /** projector: プロジェクタ座標 (なぞるモード) / world: 固定頂点の座標系 (測った会場モード) */
  frame: 'projector' | 'world';
  projector: EstimatedProjector;
  vertices: Record<string, Vec3>;
  /** 頂点ごとの再投影残差 (px)。なぞっていない頂点は含まない。 */
  residualPixels: Record<string, number>;
  rmsPixels: number;
  scaleKnown: boolean;
  /** 決まらない量: 'fov' | 'lensShiftX' | 'lensShiftY' | 'position' | 'rotation' | 'vertex:<id>' */
  underdetermined: string[];
  /** 1 px の観測誤差あたりの標準偏差。推定していない量は null。 */
  uncertainty: ReconstructUncertainty;
  /** 残差が他より突出して大きい頂点 (取り違え・寸法誤差の候補)。 */
  outliers: string[];
  iterations: number;
}

export interface ReconstructUncertainty {
  fovDegrees: number | null;
  lensShift: [number | null, number | null];
  positionMeters: number | null;
  rotationDegrees: number | null;
  /** 自由頂点のうち最も不確かなものの、標準偏差 / プロジェクタからの距離。 */
  worstVertexRelative: number | null;
}

const EMPTY_UNCERTAINTY: ReconstructUncertainty = {
  fovDegrees: null, lensShift: [null, null], positionMeters: null, rotationDegrees: null, worstVertexRelative: null,
};

/** 形の拘束の重み。無次元の残差 1e-4 が 1 px の再投影誤差と釣り合う (ほぼ厳密な拘束)。 */
const CONSTRAINT_WEIGHT = 1e4;
/**
 * 1 px の観測誤差あたりの標準偏差がこれを超えたら「決まらない」とみなす。
 * 画角 2° の誤差は奥行き方向の縮尺のおよそ 4% に当たり、3D 練習の見た目で気付く手前の大きさ。
 */
const MAX_FOV_STD_DEGREES = 2;
/** レンズシフトは向きとほぼ交絡し、誤差は会場の傾きとして現れるので、同じ傾きの角度で判定する。 */
const MAX_SHIFT_TILT_DEGREES = 1;
const MAX_ROTATION_STD_DEGREES = .5;
const MAX_RELATIVE_POSITION_STD = .05;
const DEFAULT_ASSUMED_DISTANCE = 4;
const DEFAULT_FOV = 40;
const FALLBACK_FOVS = [25, 40, 60];

type Mat3 = [number, number, number, number, number, number, number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.max(norm(a), 1e-12));
const toRadians = (degrees: number): number => degrees * Math.PI / 180;
const toDegrees = (radians: number): number => radians * 180 / Math.PI;

/** 回転ベクトル → 回転行列 (行優先。列がカメラの軸の世界での向き)。 */
function rotationMatrix(r: Vec3): Mat3 {
  const theta = norm(r);
  if (theta < 1e-12) return [1, -r[2], r[1], r[2], 1, -r[0], -r[1], r[0], 1];
  const [x, y, z] = scale(r, 1 / theta);
  const c = Math.cos(theta), s = Math.sin(theta), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

function quaternionToRotationVector(q: Quaternion): Vec3 {
  const [x, y, z, w0] = q;
  const length = Math.hypot(x, y, z, w0) || 1;
  let w = w0 / length;
  let v: Vec3 = [x / length, y / length, z / length];
  if (w < 0) { w = -w; v = scale(v, -1); }
  const sinHalf = norm(v);
  if (sinHalf < 1e-12) return scale(v, 2);
  const angle = 2 * Math.atan2(sinHalf, w);
  return scale(v, angle / sinHalf);
}

function rotationVectorToQuaternion(r: Vec3): Quaternion {
  const theta = norm(r);
  if (theta < 1e-12) return [r[0] / 2, r[1] / 2, r[2] / 2, 1];
  const s = Math.sin(theta / 2) / theta;
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(theta / 2)];
}

/** カメラ座標 (Rᵀ (X − p))。 */
function toLocal(rotation: Mat3, position: Vec3, point: Vec3): Vec3 {
  const d = sub(point, position);
  return [
    rotation[0] * d[0] + rotation[3] * d[1] + rotation[6] * d[2],
    rotation[1] * d[0] + rotation[4] * d[1] + rotation[7] * d[2],
    rotation[2] * d[0] + rotation[5] * d[1] + rotation[8] * d[2],
  ];
}

/** カメラ座標の方向 → 世界座標の方向 (R d)。 */
function toWorldDirection(rotation: Mat3, d: Vec3): Vec3 {
  return [
    rotation[0] * d[0] + rotation[1] * d[1] + rotation[2] * d[2],
    rotation[3] * d[0] + rotation[4] * d[1] + rotation[5] * d[2],
    rotation[6] * d[0] + rotation[7] * d[1] + rotation[8] * d[2],
  ];
}

interface State {
  position: Vec3;
  rotationVector: Vec3;
  rotation: Mat3;
  /** tan(縦画角 / 2) */
  halfHeight: number;
  shift: [number, number];
  points: Map<string, Vec3>;
}

/** 9 個のプロジェクタ量の並び: 位置 3、回転ベクトル 3、ln tan(fov/2)、レンズシフト x / y。 */
const PROJECTOR_SLOTS: { parameter: ProjectorParameter; count: number }[] = [
  { parameter: 'position', count: 3 },
  { parameter: 'rotation', count: 3 },
  { parameter: 'fov', count: 1 },
  { parameter: 'lensShiftX', count: 1 },
  { parameter: 'lensShiftY', count: 1 },
];

class Problem {
  readonly aspect: number;
  readonly observed: ReconstructVertex[];
  readonly freeIds: string[];
  readonly fixedPoints = new Map<string, Vec3>();
  readonly worldMode: boolean;
  readonly locked: Set<ProjectorParameter>;
  readonly scaleKnown: boolean;
  /** 9 個のプロジェクタ量それぞれの、未知数ベクトル上の位置 (ロック中は -1)。 */
  readonly projectorIndex: number[] = [];
  readonly vertexIndex = new Map<string, number>();
  readonly size: number;
  base: number[] = new Array<number>(9).fill(0);
  readonly input: ReconstructInput;

  constructor(input: ReconstructInput) {
    this.input = input;
    const { width, height } = input.output;
    if (!(width > 0 && height > 0)) throw new RangeError('output size must be positive');
    this.aspect = width / height;
    const ids = new Set<string>();
    for (const v of input.vertices) {
      if (ids.has(v.id)) throw new RangeError(`duplicate vertex id: ${v.id}`);
      ids.add(v.id);
      if (v.fixed) this.fixedPoints.set(v.id, [...v.fixed] as Vec3);
    }
    for (const e of input.elements) for (const id of elementIds(e)) {
      if (!ids.has(id)) throw new RangeError(`unknown vertex id: ${id}`);
    }
    this.observed = input.vertices.filter(v => v.pixel);
    this.freeIds = input.vertices.filter(v => !v.fixed).map(v => v.id);
    this.worldMode = this.fixedPoints.size > 0;
    this.locked = new Set(input.locked ?? ['lensShiftX']);
    if (!this.worldMode) { this.locked.add('position'); this.locked.add('rotation'); }
    if (this.worldMode && !(input.initial?.position && input.initial.quaternion)) {
      throw new RangeError('initial position and quaternion are required when vertices are fixed');
    }
    this.scaleKnown = this.worldMode || input.elements.some(e => e.kind === 'length');
    let n = 0;
    for (const slot of PROJECTOR_SLOTS) {
      for (let k = 0; k < slot.count; k++) this.projectorIndex.push(this.locked.has(slot.parameter) ? -1 : n++);
    }
    for (const id of this.freeIds) { this.vertexIndex.set(id, n); n += 3; }
    this.size = n;
  }

  decode(x: readonly number[]): State {
    const value = (slot: number) => this.projectorIndex[slot] >= 0 ? x[this.projectorIndex[slot]] : this.base[slot];
    const position: Vec3 = [value(0), value(1), value(2)];
    const rotationVector: Vec3 = [value(3), value(4), value(5)];
    const points = new Map(this.fixedPoints);
    for (const [id, i] of this.vertexIndex) points.set(id, [x[i], x[i + 1], x[i + 2]]);
    return {
      position, rotationVector, rotation: rotationMatrix(rotationVector),
      halfHeight: Math.exp(value(6)), shift: [value(7), value(8)], points,
    };
  }

  /** 世界座標の点 → 出力画素。プロジェクタの背後なら null。 */
  project(state: State, point: Vec3): PixelPoint | null {
    const local = toLocal(state.rotation, state.position, point);
    const depth = -local[2];
    if (!(depth > 1e-9)) return null;
    const h = state.halfHeight, w = h * this.aspect;
    const ndcX = local[0] / depth / w - 2 * state.shift[0];
    const ndcY = local[1] / depth / h - 2 * state.shift[1];
    const { width, height } = this.input.output;
    return [(ndcX + 1) / 2 * width, (1 - ndcY) / 2 * height];
  }

  /** 出力画素を通る光線の、世界座標での単位方向。 */
  ray(state: State, pixel: PixelPoint): Vec3 {
    const { width, height } = this.input.output;
    const ndcX = pixel[0] / width * 2 - 1, ndcY = 1 - pixel[1] / height * 2;
    const h = state.halfHeight, w = h * this.aspect;
    return unit(toWorldDirection(state.rotation, [w * (ndcX + 2 * state.shift[0]), h * (ndcY + 2 * state.shift[1]), -1]));
  }

  readonly residuals: ResidualFunction = x => {
    const state = this.decode(x);
    const r: number[] = [];
    const point = (id: string) => state.points.get(id) as Vec3;
    for (const v of this.observed) {
      const p = this.project(state, point(v.id));
      const pixel = v.pixel as PixelPoint;
      if (p) r.push(p[0] - pixel[0], p[1] - pixel[1]);
      else r.push(1e6, 1e6);
    }
    for (const e of this.input.elements) {
      if (e.kind === 'rectangle') {
        const [a, b, c, d] = e.vertices.map(point);
        const size = Math.max((norm(sub(b, a)) + norm(sub(c, b)) + norm(sub(d, c)) + norm(sub(a, d))) / 4, 1e-9);
        const gap = scale(sub(add(a, c), add(b, d)), CONSTRAINT_WEIGHT / size);
        r.push(gap[0], gap[1], gap[2], CONSTRAINT_WEIGHT * dot(unit(sub(b, a)), unit(sub(d, a))));
      } else if (e.kind === 'orthogonalCorner') {
        const o = point(e.corner);
        const edges = e.edges.map(id => unit(sub(point(id), o)));
        const [e1, e2, e3] = edges;
        r.push(CONSTRAINT_WEIGHT * dot(e1, e2), CONSTRAINT_WEIGHT * dot(e1, e3), CONSTRAINT_WEIGHT * dot(e2, e3));
        if (e.shape) {
          // 凹なら角から見たプロジェクタは 3 本の辺の側 (内側)、凸なら反対側 (外側)。違反した分だけ罰する。
          const toProjector = unit(sub(state.position, o));
          const sign = e.shape === 'concave' ? 1 : -1;
          for (const edge of edges) r.push(CONSTRAINT_WEIGHT * Math.max(0, -sign * dot(toProjector, edge)));
        }
      } else if (e.kind === 'onPlane') {
        const [a, b, c] = e.plane.map(point);
        const normal = unit(cross(sub(b, a), sub(c, a)));
        const size = Math.max(norm(sub(b, a)), norm(sub(c, a)), 1e-9);
        r.push(CONSTRAINT_WEIGHT * dot(normal, sub(point(e.vertex), a)) / size);
      } else if (e.kind === 'parallel') {
        const [[a, b], [c, d]] = e.segments.map(([from, to]) => [point(from), point(to)]);
        const gap = scale(cross(unit(sub(b, a)), unit(sub(d, c))), CONSTRAINT_WEIGHT);
        r.push(gap[0], gap[1], gap[2]);
      } else {
        const [a, b] = e.vertices.map(point);
        r.push(CONSTRAINT_WEIGHT * (norm(sub(a, b)) - e.meters) / e.meters);
      }
    }
    if (!this.scaleKnown) {
      const distance = this.assumedDistance;
      r.push(CONSTRAINT_WEIGHT * (norm(sub(this.observedCentroid(state), state.position)) - distance) / distance);
    }
    const prior = this.input.fovPrior;
    if (prior && this.projectorIndex[6] >= 0) {
      r.push((toDegrees(2 * Math.atan(state.halfHeight)) - prior.degrees) / prior.sigmaDegrees);
    }
    return r;
  };

  get assumedDistance(): number { return this.input.assumedDistance ?? DEFAULT_ASSUMED_DISTANCE; }

  /**
   * 縮尺を仮に決める基準点の重心。最初の要素のなぞった頂点を使う。全体の重心にすると、
   * つながらない要素の不定性が他の要素へ混ざり、どこが決まらないのか見分けられなくなる。
   */
  observedCentroid(state: State): Vec3 {
    const observedIds = new Set(this.observed.map(v => v.id));
    const first = this.input.elements[0];
    const anchored = first ? elementIds(first).filter(id => observedIds.has(id)) : [];
    const sources = anchored.length > 0 ? anchored : observedIds.size > 0 ? [...observedIds] : [...state.points.keys()];
    let sum: Vec3 = [0, 0, 0];
    for (const id of sources) sum = add(sum, state.points.get(id) as Vec3);
    return scale(sum, 1 / Math.max(sources.length, 1));
  }

  /** プロジェクタ量の基準値 (ロック中の値・初期値) を設定する。 */
  setBase(fovDegrees: number, shift: [number, number]): void {
    const initial = this.input.initial ?? {};
    const position = this.worldMode ? initial.position ?? [0, 0, 0] : [0, 0, 0];
    const rotation = this.worldMode && initial.quaternion ? quaternionToRotationVector(initial.quaternion) : [0, 0, 0];
    this.base = [...position, ...rotation, Math.log(Math.tan(toRadians(fovDegrees) / 2)), shift[0], shift[1]];
  }

  /** 基準値と頂点の初期位置から未知数ベクトルを作る。 */
  pack(points: Map<string, Vec3>): number[] {
    const x = new Array<number>(this.size).fill(0);
    this.projectorIndex.forEach((index, slot) => { if (index >= 0) x[index] = this.base[slot]; });
    for (const [id, i] of this.vertexIndex) {
      const p = points.get(id) as Vec3;
      x[i] = p[0]; x[i + 1] = p[1]; x[i + 2] = p[2];
    }
    return x;
  }
}

function elementIds(e: ReconstructElement): string[] {
  if (e.kind === 'rectangle') return [...e.vertices];
  if (e.kind === 'orthogonalCorner') return [e.corner, ...e.edges];
  if (e.kind === 'onPlane') return [e.vertex, ...e.plane];
  if (e.kind === 'parallel') return e.segments.flat();
  return [...e.vertices];
}

/**
 * なぞった長方形の消失点と直交条件 v1ᵀ ω v2 = 0 (正方画素・skew なし) から、
 * 縦画角 (と、ロックしていなければ縦のレンズシフト) を線形に初期推定する。決まらなければ null。
 */
export function estimateIntrinsicsFromRectangles(
  input: Pick<ReconstructInput, 'output' | 'vertices' | 'elements'>,
  shift: [number, number],
  solveShiftY: boolean,
): { verticalFovDegrees: number; lensShiftY: number } | null {
  const { width, height } = input.output;
  const aspect = width / height;
  const pixels = new Map(input.vertices.filter(v => v.pixel).map(v => [v.id, v.pixel as PixelPoint]));
  // 正方画素の座標 (u = NDC x × aspect, v = NDC y)。主点は (−2 sx aspect, −2 sy)、焦点距離は 1 / tan(fov/2)。
  const square = (p: PixelPoint) => ({ x: (p[0] / width * 2 - 1) * aspect, y: 1 - p[1] / height * 2 });
  const cu = -2 * shift[0] * aspect;
  const rows: [number, number, number][] = [];
  for (const e of input.elements) {
    if (e.kind !== 'rectangle') continue;
    const corners = e.vertices.map(id => pixels.get(id));
    if (corners.some(p => !p)) continue;
    const [a, b, c, d] = (corners as PixelPoint[]).map(square);
    const h = quadHomography({ topLeft: a, topRight: b, bottomRight: c, bottomLeft: d });
    if (!h) continue;
    const v1 = unit([h[0], h[3], h[6]]), v2 = unit([h[1], h[4], h[7]]);
    // u1u2 + v1v2 − cu(u1w2 + u2w1) − cv(v1w2 + v2w1) + k w1w2 = 0、k = f² + cu² + cv²
    rows.push([
      -(v1[1] * v2[2] + v2[1] * v1[2]),
      v1[2] * v2[2],
      -(v1[0] * v2[0] + v1[1] * v2[1]) + cu * (v1[0] * v2[2] + v2[0] * v1[2]),
    ]);
  }
  let cv = -2 * shift[1], k: number;
  if (solveShiftY && rows.length >= 2) {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const [p, q, rhs] of rows) { a11 += p * p; a12 += p * q; a22 += q * q; b1 += p * rhs; b2 += q * rhs; }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-12 * Math.max(a11 * a22, 1e-300)) return null;
    cv = (b1 * a22 - b2 * a12) / det;
    k = (a11 * b2 - a12 * b1) / det;
  } else if (rows.length >= 1) {
    let num = 0, den = 0;
    for (const [p, q, rhs] of rows) { num += q * (rhs - p * cv); den += q * q; }
    if (den < 1e-12) return null;
    k = num / den;
  } else {
    return null;
  }
  const f2 = k - cu * cu - cv * cv;
  if (!(f2 > 0)) return null;
  const fov = toDegrees(2 * Math.atan(1 / Math.sqrt(f2)));
  if (!(fov > 3 && fov < 150) || !Number.isFinite(cv)) return null;
  return { verticalFovDegrees: fov, lensShiftY: -cv / 2 };
}

/** 初期の頂点位置: 光線上の距離 distance に置き、角の頂点だけ factor 倍の距離にずらす。 */
function initialPoints(problem: Problem, state: State, distance: number, cornerFactor: number): Map<string, Vec3> {
  const corners = new Set(problem.input.elements.flatMap(e => e.kind === 'orthogonalCorner' ? [e.corner] : []));
  const points = new Map<string, Vec3>();
  const pixels = new Map(problem.observed.map(v => [v.id, v.pixel as PixelPoint]));
  for (const id of problem.freeIds) {
    const pixel = pixels.get(id);
    if (!pixel) continue;
    const d = distance * (corners.has(id) ? cornerFactor : 1);
    points.set(id, add(state.position, scale(problem.ray(state, pixel), d)));
  }
  // なぞっていない頂点は、なぞった点の重心のやや奥に置く (形の拘束が位置を決める)。
  const placed = [...points.values()];
  let centroid: Vec3 = add(state.position, scale(toWorldDirection(state.rotation, [0, 0, -1]), distance));
  if (placed.length > 0) centroid = scale(placed.reduce(add, [0, 0, 0] as Vec3), 1 / placed.length);
  problem.freeIds.forEach((id, i) => {
    if (!points.has(id)) points.set(id, add(centroid, [.1 * Math.cos(i), .1 * Math.sin(i), -.1]));
  });
  return points;
}

/**
 * なぞった角と形の知識から、会場の頂点とプロジェクタ条件を逆算する。
 * 複数の初期値 (画角の候補 × 角の凹凸) から解き、再投影誤差と拘束の合計が最小のものを返す。
 */
export function reconstructVenue(input: ReconstructInput): ReconstructResult {
  const problem = new Problem(input);
  const initialShift: [number, number] = [input.initial?.lensShift?.[0] ?? 0, input.initial?.lensShift?.[1] ?? 0];

  const fovCandidates: { fov: number; shiftY: number }[] = [];
  const push = (fov: number, shiftY = initialShift[1]) => {
    if (!fovCandidates.some(c => Math.abs(c.fov - fov) < .5 && Math.abs(c.shiftY - shiftY) < 1e-3)) fovCandidates.push({ fov, shiftY });
  };
  if (input.initial?.verticalFovDegrees) push(input.initial.verticalFovDegrees);
  if (input.fovPrior) push(input.fovPrior.degrees);
  if (!problem.locked.has('fov')) {
    const linear = estimateIntrinsicsFromRectangles(input, initialShift, !problem.locked.has('lensShiftY'));
    if (linear) push(linear.verticalFovDegrees, problem.locked.has('lensShiftY') ? initialShift[1] : linear.lensShiftY);
    if (fovCandidates.length === 0) FALLBACK_FOVS.forEach(fov => push(fov));
  }
  if (fovCandidates.length === 0) push(DEFAULT_FOV);

  const hasCorners = input.elements.some(e => e.kind === 'orthogonalCorner');
  const cornerFactors = hasCorners ? [1, 1.25, .8] : [1];

  let best: { x: number[]; cost: number; iterations: number } | null = null;
  for (const candidate of fovCandidates) {
    problem.setBase(candidate.fov, [initialShift[0], candidate.shiftY]);
    const start = problem.decode(problem.pack(new Map(problem.freeIds.map(id => [id, [0, 0, -1] as Vec3]))));
    const distance = problem.worldMode
      ? meanDistance([...problem.fixedPoints.values()], start.position)
      : problem.assumedDistance;
    for (const factor of problem.worldMode ? [1] : cornerFactors) {
      const x0 = problem.pack(initialPoints(problem, start, distance, factor));
      const solved = levenbergMarquardt(problem.residuals, x0, { maxIterations: 300 });
      if (Number.isFinite(solved.cost) && (!best || solved.cost < best.cost)) {
        best = { x: solved.x, cost: solved.cost, iterations: solved.iterations };
      }
    }
  }

  const fallbackState = problem.decode(problem.pack(new Map(problem.freeIds.map(id => [id, [0, 0, -1] as Vec3]))));
  if (!best) return emptyResult(problem, fallbackState);
  const state = problem.decode(best.x);
  const residualPixels: Record<string, number> = {};
  let squared = 0, behind = false;
  for (const v of problem.observed) {
    const p = problem.project(state, state.points.get(v.id) as Vec3);
    if (!p) { behind = true; continue; }
    const pixel = v.pixel as PixelPoint;
    const e = Math.hypot(p[0] - pixel[0], p[1] - pixel[1]);
    residualPixels[v.id] = e;
    squared += e * e;
  }
  const rmsPixels = Math.sqrt(squared / Math.max(problem.observed.length, 1));
  const { underdetermined, uncertainty } = diagnose(problem, best.x, state);
  const outliers = findOutliers(residualPixels);
  return {
    status: behind || !Number.isFinite(rmsPixels) ? 'failed' : underdetermined.length > 0 ? 'underdetermined' : 'ok',
    frame: problem.worldMode ? 'world' : 'projector',
    projector: toProjector(problem, state),
    vertices: Object.fromEntries([...state.points].map(([id, p]) => [id, [...p] as Vec3])),
    residualPixels, rmsPixels, scaleKnown: problem.scaleKnown, underdetermined, uncertainty, outliers,
    iterations: best.iterations,
  };
}

function meanDistance(points: Vec3[], origin: Vec3): number {
  if (points.length === 0) return DEFAULT_ASSUMED_DISTANCE;
  return points.reduce((sum, p) => sum + norm(sub(p, origin)), 0) / points.length;
}

function toProjector(problem: Problem, state: State): EstimatedProjector {
  return {
    position: [...state.position] as Vec3,
    quaternion: rotationVectorToQuaternion(state.rotationVector),
    verticalFovDegrees: toDegrees(2 * Math.atan(state.halfHeight)),
    aspect: problem.aspect,
    lensShift: [...state.shift] as [number, number],
  };
}

function emptyResult(problem: Problem, state: State): ReconstructResult {
  return {
    status: 'failed', frame: problem.worldMode ? 'world' : 'projector', projector: toProjector(problem, state),
    vertices: {}, residualPixels: {}, rmsPixels: Infinity, scaleKnown: problem.scaleKnown,
    underdetermined: [], uncertainty: EMPTY_UNCERTAINTY, outliers: [], iterations: 0,
  };
}

/**
 * 1 px の観測誤差あたりの標準偏差 (不確かさ) と、それが閾値を超えて「決まらない」量。
 * 拘束と事前分布は重み付き残差に含まれるので、ここでの標準偏差は条件付きの値になる。
 */
function diagnose(problem: Problem, x: number[], state: State): { underdetermined: string[]; uncertainty: ReconstructUncertainty } {
  const c = covariance(problem.residuals, x);
  const variance = (i: number) => i >= 0 ? c[i][i] : 0;
  const std = (i: number) => i >= 0 ? Math.sqrt(c[i][i]) : null;
  const underdetermined: string[] = [];
  const fovIndex = problem.projectorIndex[6];
  const h = state.halfHeight;
  const fovStd = fovIndex >= 0 ? toDegrees(2 * h / (1 + h * h)) * Math.sqrt(variance(fovIndex)) : null;
  if (fovStd !== null && !(fovStd <= MAX_FOV_STD_DEGREES)) underdetermined.push('fov');
  const shiftStd: [number | null, number | null] = [std(problem.projectorIndex[7]), std(problem.projectorIndex[8])];
  const tilt = (shift: number | null, half: number) => shift === null ? null : toDegrees(Math.atan(2 * shift * half));
  const shiftTilt = [tilt(shiftStd[0], h * problem.aspect), tilt(shiftStd[1], h)];
  if (shiftTilt[0] !== null && !(shiftTilt[0] <= MAX_SHIFT_TILT_DEGREES)) underdetermined.push('lensShiftX');
  if (shiftTilt[1] !== null && !(shiftTilt[1] <= MAX_SHIFT_TILT_DEGREES)) underdetermined.push('lensShiftY');
  const distances = [...state.points.values()].map(p => norm(sub(p, state.position)));
  const sceneDistance = distances.reduce((a, b) => a + b, 0) / Math.max(distances.length, 1);
  const position = problem.projectorIndex.slice(0, 3);
  const positionStd = position[0] >= 0 ? Math.sqrt(position.reduce((sum, i) => sum + variance(i), 0)) : null;
  if (positionStd !== null && !(positionStd <= MAX_RELATIVE_POSITION_STD * sceneDistance)) underdetermined.push('position');
  const rotation = problem.projectorIndex.slice(3, 6);
  const rotationStd = rotation[0] >= 0 ? toDegrees(Math.sqrt(Math.max(...rotation.map(variance)))) : null;
  if (rotationStd !== null && !(rotationStd <= MAX_ROTATION_STD_DEGREES)) underdetermined.push('rotation');
  let worstVertex = 0;
  for (const [id, i] of problem.vertexIndex) {
    const relative = Math.sqrt(c[i][i] + c[i + 1][i + 1] + c[i + 2][i + 2])
      / Math.max(norm(sub(state.points.get(id) as Vec3, state.position)), 1e-9);
    worstVertex = Math.max(worstVertex, Number.isFinite(relative) ? relative : Infinity);
    if (!(relative <= MAX_RELATIVE_POSITION_STD)) underdetermined.push(`vertex:${id}`);
  }
  return {
    underdetermined,
    uncertainty: {
      fovDegrees: fovStd, lensShift: shiftStd, positionMeters: positionStd, rotationDegrees: rotationStd,
      worstVertexRelative: problem.vertexIndex.size > 0 ? worstVertex : null,
    },
  };
}

/** 残差の中央値から突出した頂点。全体の誤差が小さいときは 6 px を下限にする。 */
function findOutliers(residualPixels: Record<string, number>): string[] {
  const values = Object.values(residualPixels).sort((a, b) => a - b);
  if (values.length < 5) return [];
  const median = values[Math.floor(values.length / 2)];
  const threshold = Math.max(6, 5 * median);
  return Object.entries(residualPixels).filter(([, e]) => e > threshold).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
