import type { Projector, Quaternion, Vec3, VenueObject } from '../practice/project.ts';
import { roomScene, venueObject } from '../practice/venueObjects.ts';
import type { ReconstructInput, ReconstructResult } from './venueReconstruct.ts';

/**
 * なぞるモードの推定結果 (プロジェクタ座標の頂点と、原点に置いたプロジェクタ) を、会場の世界座標
 * (床 Y=0・Y が上・奥の壁が −Z・客席が +Z、docs/venue-authoring.md の 1 章) の部材とプロジェクタ条件へ移す
 * (#245、規則の理由は ADR 0023)。
 *
 * - 部品: rectangle / orthogonalCorner が頂点を共有するものを 1 つの部品にまとめる。凹の角を含めば部屋、
 *   凸の角か向きの違う長方形を含めば箱、長方形が同じ平面にしか無ければ板。決まらない頂点を含む部品は作らない。
 * - 上: 部屋の隅の辺 (部屋が無ければ箱・板の辺と法線) のうち、出力画像の上に最も近い向き。
 * - 奥行き: 水平な辺のうち、プロジェクタへ向かう水平方向に最も近い向きを +Z (客席側) にする。
 * - 床: 決まった頂点の最も低いもの。原点 X/Z は部屋の中央 (部屋が無ければ頂点の外接矩形の中央)。
 * - 部屋のなぞっていない方向は、プロジェクタの光が届く範囲まで延ばす。箱の底は床まで延ばす。
 */

export type VenuePartRole = 'floor' | 'back' | 'left' | 'right' | 'box' | 'panel';

export interface ReconstructionToVenueOptions {
  /** id・outputId・near・far を引き継ぐプロジェクタ。 */
  projector: Projector;
  /** 部材の表示名。index は同じ role の中での 0 始まりの番号。 */
  name: (role: VenuePartRole, index: number) => string;
}

export interface SkippedPart {
  /** 部品の頂点 */
  vertices: string[];
  reason: 'underdetermined';
}

export type ReconstructionToVenueResult =
  | {
    status: 'ok';
    objects: VenueObject[];
    projector: Projector;
    /** 決まった頂点の世界座標。 */
    vertices: Record<string, Vec3>;
    /** false なら、寸法は推定の仮の単位 (部材とプロジェクタは同じ比率)。 */
    scaleKnown: boolean;
    skipped: SkippedPart[];
    /** 軸を決めた手掛かり: 部屋の隅か、それ以外の部品か。 */
    basis: 'room' | 'objects';
  }
  | { status: 'failed'; reason: 'reconstructionFailed' | 'measuredFrame' | 'nothingDetermined' };

/** 部屋のひな形 (roomScene) と同じ壁の厚さ。板にも使う。 */
const WALL_THICKNESS = .15;
/** 上の候補をまとめる角度の幅。部屋の隅 2 つの縦の辺など、同じ向きを指すものを平均する。 */
const SAME_DIRECTION_COS = Math.cos(30 * Math.PI / 180);
/** これより鉛直に近い辺は水平の候補にしない (水平成分の長さ)。 */
const MIN_HORIZONTAL = .5;
/** 長方形どうしの法線がこれより平行なら同じ平面とみなす。 */
const COPLANAR_COS = Math.cos(10 * Math.PI / 180);
/** 光の届く範囲として扱う、プロジェクタからの距離の上限 (なぞった頂点の最遠距離の倍率)。 */
const LIT_DISTANCE_FACTOR = 4;
const MIN_SIZE = .001;

type Mat3 = [Vec3, Vec3, Vec3];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.max(norm(a), 1e-12));
/** 行が新しい軸の行列で、点・方向を新しい座標へ移す。 */
const apply = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

function rotate(q: Quaternion, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(...q) || 1;
  const sign = q[3] < 0 ? -1 : 1;
  return q.map(v => sign * v / length) as Quaternion;
}

/** 列が回転後の X / Y / Z 軸になる回転の四元数。 */
function quaternionFromAxes(x: Vec3, y: Vec3, z: Vec3): Quaternion {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  const trace = m00 + m11 + m22;
  let q: Quaternion;
  if (trace > 0) {
    const s = .5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, .25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, .25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, .25 * s, (m10 - m01) / s];
  }
  return normalizeQuaternion(q);
}

interface Part {
  kind: 'room' | 'box' | 'panel';
  ids: string[];
  elements: ReconstructInput['elements'];
}

/** rectangle / orthogonalCorner が頂点を共有するものを部品にまとめ、種類を決める。 */
function findParts(input: ReconstructInput, points: Record<string, Vec3>): Part[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  const structural = input.elements.filter(e => e.kind === 'rectangle' || e.kind === 'orthogonalCorner');
  const idsOf = (e: ReconstructInput['elements'][number]) => e.kind === 'rectangle' ? [...e.vertices]
    : e.kind === 'orthogonalCorner' ? [e.corner, ...e.edges] : [];
  for (const e of structural) {
    const ids = idsOf(e);
    for (const id of ids) if (!parent.has(id)) parent.set(id, id);
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
  }
  const groups = new Map<string, Part>();
  for (const e of structural) {
    const root = find(idsOf(e)[0]);
    const part = groups.get(root) ?? { kind: 'panel', ids: [], elements: [] };
    part.elements.push(e);
    for (const id of idsOf(e)) if (!part.ids.includes(id)) part.ids.push(id);
    groups.set(root, part);
  }
  for (const part of groups.values()) {
    if (part.elements.some(e => e.kind === 'orthogonalCorner' && e.shape === 'concave')) part.kind = 'room';
    else if (part.elements.some(e => e.kind === 'orthogonalCorner')) part.kind = 'box';
    else {
      const normals = part.elements.flatMap(e => e.kind === 'rectangle' && e.vertices.every(id => points[id])
        ? [rectangleAxes(e.vertices.map(id => points[id]) as Vec3[]).normal] : []);
      part.kind = normals.every(n => Math.abs(dot(n, normals[0])) >= COPLANAR_COS) ? 'panel' : 'box';
    }
  }
  return [...groups.values()];
}

function rectangleAxes([a, b, , d]: Vec3[]): { u: Vec3; v: Vec3; normal: Vec3 } {
  const u = unit(sub(b, a)), v = unit(sub(d, a));
  return { u, v, normal: unit(cross(u, v)) };
}

/** 部品の形が表す直交する向き (角の 3 辺、長方形の 2 辺と法線)。 */
function partAxes(part: Part, points: Record<string, Vec3>): Vec3[] {
  return part.elements.flatMap(e => {
    if (e.kind === 'rectangle') {
      const { u, v, normal } = rectangleAxes(e.vertices.map(id => points[id]));
      return [u, v, normal];
    }
    if (e.kind === 'orthogonalCorner') return e.edges.map(id => unit(sub(points[id], points[e.corner])));
    return [];
  });
}

/** reference に最も近い候補を選び、その 30° 以内の候補を同じ向きにそろえて平均する。 */
function dominantDirection(candidates: Vec3[], reference: Vec3): Vec3 {
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(dot(c, reference)) > Math.abs(dot(best, reference))) best = c;
  best = dot(best, reference) < 0 ? scale(best, -1) : best;
  let sum: Vec3 = [0, 0, 0];
  for (const c of candidates) {
    const cosine = dot(c, best);
    if (Math.abs(cosine) >= SAME_DIRECTION_COS) sum = add(sum, cosine < 0 ? scale(c, -1) : c);
  }
  return unit(sum);
}

/**
 * なぞった角の推定結果を、世界座標の会場部材とプロジェクタ条件へ移す。
 * 測った会場モード (frame: 'world'、#158) の結果は扱わない。
 */
export function reconstructionToVenue(
  input: ReconstructInput, result: ReconstructResult, options: ReconstructionToVenueOptions,
): ReconstructionToVenueResult {
  if (result.status === 'failed') return { status: 'failed', reason: 'reconstructionFailed' };
  if (result.frame !== 'projector') return { status: 'failed', reason: 'measuredFrame' };
  const undetermined = new Set(result.underdetermined.flatMap(u => u.startsWith('vertex:') ? [u.slice(7)] : []));
  const points = result.vertices;
  const parts = findParts(input, points);
  const skipped: SkippedPart[] = [];
  const determined = parts.filter(part => {
    const ok = part.ids.every(id => points[id] && !undetermined.has(id));
    if (!ok) skipped.push({ vertices: [...part.ids], reason: 'underdetermined' });
    return ok;
  });
  if (determined.length === 0) return { status: 'failed', reason: 'nothingDetermined' };

  // プロジェクタ座標での、出力画像の上とプロジェクタの位置。
  const estimated = result.projector;
  const imageUp = rotate(estimated.quaternion, [0, 1, 0]);
  const rooms = determined.filter(part => part.kind === 'room');
  const basis = rooms.length > 0 ? 'room' : 'objects';
  const axisSource = rooms.length > 0 ? rooms : determined;
  const candidates = axisSource.flatMap(part => partAxes(part, points));
  const up = dominantDirection(candidates, imageUp);

  const determinedIds = [...new Set(determined.flatMap(part => part.ids))];
  const centroid = scale(determinedIds.reduce((sum, id) => add(sum, points[id]), [0, 0, 0] as Vec3), 1 / determinedIds.length);
  const flatten = (v: Vec3): Vec3 => sub(v, scale(up, dot(v, up)));
  let towardProjector = flatten(sub(estimated.position, centroid));
  if (norm(towardProjector) < 1e-9) towardProjector = flatten(rotate(estimated.quaternion, [0, 0, 1]));
  towardProjector = unit(towardProjector);
  // 直交する形なので、水平な辺を上の軸回りに 90° 回したものも奥行きの候補になる。
  const horizontal = candidates.map(flatten).filter(h => norm(h) >= MIN_HORIZONTAL).map(unit);
  const depthAxis = unit(flatten(dominantDirection([...horizontal, ...horizontal.map(h => cross(up, h))], towardProjector)));
  const rightAxis = cross(up, depthAxis);
  const toWorld: Mat3 = [rightAxis, up, depthAxis];

  // まず向きだけそろえ (原点はプロジェクタ座標のまま)、床と原点を決めてから平行移動する。
  const aligned = (id: string) => apply(toWorld, points[id]);
  const projectorAligned = apply(toWorld, estimated.position);
  const floorY = Math.min(...determinedIds.map(id => aligned(id)[1]));

  const objects: VenueObject[] = [];
  let origin: Vec3;
  if (rooms.length > 0) {
    const room = buildRoom(rooms, aligned, floorY, projectorAligned, litRays(estimated, toWorld), options);
    origin = room.origin;
    objects.push(...room.objects);
  } else {
    const xs = determinedIds.map(id => aligned(id)[0]), zs = determinedIds.map(id => aligned(id)[2]);
    origin = [(Math.min(...xs) + Math.max(...xs)) / 2, floorY, (Math.min(...zs) + Math.max(...zs)) / 2];
  }
  const world = (id: string) => sub(aligned(id), origin);

  let boxes = 0, panels = 0;
  for (const part of determined) {
    if (part.kind === 'box') objects.push(buildBox(part, world, options.name('box', boxes++)));
    else if (part.kind === 'panel') objects.push(buildPanel(part, world, sub(projectorAligned, origin), options.name('panel', panels++)));
  }

  const vertices: Record<string, Vec3> = {};
  for (const id of Object.keys(points)) if (!undetermined.has(id)) vertices[id] = world(id);
  const worldRotation = quaternionFromAxes([rightAxis[0], up[0], depthAxis[0]], [rightAxis[1], up[1], depthAxis[1]], [rightAxis[2], up[2], depthAxis[2]]);
  const projector: Projector = {
    ...options.projector,
    position: sub(projectorAligned, origin),
    quaternion: normalizeQuaternion(multiply(worldRotation, estimated.quaternion)),
    verticalFovDegrees: estimated.verticalFovDegrees,
    aspect: estimated.aspect,
    lensShift: [...estimated.lensShift],
  };
  return { status: 'ok', objects, projector, vertices, scaleKnown: result.scaleKnown, skipped, basis };
}

/** 出力画像の 4 隅を通る光線 (向きをそろえた座標の方向)。 */
function litRays(projector: ReconstructResult['projector'], toWorld: Mat3): Vec3[] {
  const h = Math.tan(projector.verticalFovDegrees * Math.PI / 360), w = h * projector.aspect;
  const [sx, sy] = projector.lensShift;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
    apply(toWorld, rotate(projector.quaternion, [w * (x + 2 * sx), h * (y + 2 * sy), -1])));
}

function buildRoom(
  rooms: Part[], aligned: (id: string) => Vec3, floorY: number, projector: Vec3, rays: Vec3[],
  options: ReconstructionToVenueOptions,
): { origin: Vec3; objects: VenueObject[] } {
  const ids = [...new Set(rooms.flatMap(part => part.ids))];
  const at = ids.map(aligned);
  const corners = rooms.flatMap(part => part.elements.flatMap(e => e.kind === 'orthogonalCorner' && e.shape === 'concave' ? [e] : []));
  let hasFloor = false;
  const lefts: number[] = [], rights: number[] = [], backs: number[] = [];
  for (const corner of corners) {
    const o = aligned(corner.corner);
    const edges = corner.edges.map(id => sub(aligned(id), o));
    const vertical = edges.reduce((a, b) => Math.abs(unit(b)[1]) > Math.abs(unit(a)[1]) ? b : a);
    if (vertical[1] > 0) hasFloor = true;
    const along = edges.filter(e => e !== vertical).reduce((a, b) => Math.abs(b[0]) > Math.abs(a[0]) ? b : a);
    // 奥の壁に沿う辺が +X へ伸びるなら、その隅は左端 (左の壁が立つ)。
    (along[0] > 0 ? lefts : rights).push(o[0]);
    backs.push(o[2]);
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const back = mean(backs);
  // 奥の壁の面に当たる光の範囲。ほぼ平行で遠くへ抜ける光線は数えない。
  const reach = LIT_DISTANCE_FACTOR * Math.max(...at.map(p => norm(sub(p, projector))));
  const lit = rays.flatMap(ray => {
    const t = (back - projector[2]) / ray[2];
    return t > 0 && t * norm(ray) <= reach ? [add(projector, scale(ray, t))] : [];
  });
  const xs = [...at.map(p => p[0]), ...lit.map(p => p[0])];
  const left = lefts.length > 0 ? mean(lefts) : Math.min(...xs);
  const right = rights.length > 0 ? mean(rights) : Math.max(...xs);
  const top = Math.max(...at.map(p => p[1]), ...lit.map(p => p[1]));
  const front = Math.max(...at.map(p => p[2]), projector[2]);
  const width = Math.max(right - left, MIN_SIZE), height = Math.max(top - floorY, MIN_SIZE), depth = Math.max(front - back, MIN_SIZE);
  const roles: VenuePartRole[] = ['floor', 'back', 'left', 'right'];
  const scene = roomScene(width, height, depth, roles.map(role => options.name(role, 0)) as [string, string, string, string]);
  const keep = [hasFloor, true, lefts.length > 0, rights.length > 0];
  return {
    origin: [(left + right) / 2, floorY, back + depth / 2],
    objects: (scene.objects ?? []).filter((_, i) => keep[i]),
  };
}

/** 部品の水平な辺の向きで外接直方体を取り、底を床まで延ばす。 */
function buildBox(part: Part, world: (id: string) => Vec3, name: string): VenueObject {
  const axes = part.elements.flatMap(e => e.kind === 'rectangle'
    ? [sub(world(e.vertices[1]), world(e.vertices[0])), sub(world(e.vertices[3]), world(e.vertices[0]))]
    : e.kind === 'orthogonalCorner' ? e.edges.map(id => sub(world(id), world(e.corner))) : []);
  const horizontal = axes.map(a => [a[0], 0, a[2]] as Vec3)
    .filter((h, i) => norm(h) >= MIN_HORIZONTAL * norm(axes[i]))
    .reduce((a, b) => norm(b) > norm(a) ? b : a, [1, 0, 0]);
  // 局所の X を最も長い水平な辺に合わせ、Y 軸回りの角度を ±45° に畳む。
  let angle = Math.atan2(-horizontal[2], horizontal[0]);
  angle -= Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  const ex: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)], ez: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
  const at = part.ids.map(world);
  const range = (values: number[]) => [Math.min(...values), Math.max(...values)];
  const [x0, x1] = range(at.map(p => dot(p, ex))), [z0, z1] = range(at.map(p => dot(p, ez)));
  const top = Math.max(...at.map(p => p[1]));
  const object = venueObject('box', name);
  object.size = [Math.max(x1 - x0, MIN_SIZE), Math.max(top, MIN_SIZE), Math.max(z1 - z0, MIN_SIZE)];
  object.position = add(add(scale(ex, (x0 + x1) / 2), scale(ez, (z0 + z1) / 2)), [0, top / 2, 0]);
  object.quaternion = normalizeQuaternion([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
  return object;
}

/** 長方形の向きの薄い壁。厚みは面の奥 (プロジェクタと反対側) に置く。 */
function buildPanel(part: Part, world: (id: string) => Vec3, projector: Vec3, name: string): VenueObject {
  const rectangle = part.elements.find(e => e.kind === 'rectangle');
  const corners = (rectangle?.kind === 'rectangle' ? rectangle.vertices : part.ids).map(world);
  let { u: ex, v: ey, normal } = rectangleAxes(corners);
  const at = part.ids.map(world);
  const center0 = scale(at.reduce(add, [0, 0, 0] as Vec3), 1 / at.length);
  if (dot(normal, sub(projector, center0)) < 0) normal = scale(normal, -1);
  // 面内の軸のうち、上に近いほうを局所の Y にし、上向きにそろえる。
  ey = cross(normal, ex);
  if (Math.abs(ex[1]) > Math.abs(ey[1])) [ex, ey] = [ey, scale(ex, -1)];
  if (ey[1] < 0) { ex = scale(ex, -1); ey = scale(ey, -1); }
  const range = (values: number[]) => [Math.min(...values), Math.max(...values)];
  const [x0, x1] = range(at.map(p => dot(p, ex))), [y0, y1] = range(at.map(p => dot(p, ey)));
  const plane = dot(center0, normal);
  const object = venueObject('wall', name);
  object.size = [Math.max(x1 - x0, MIN_SIZE), Math.max(y1 - y0, MIN_SIZE), WALL_THICKNESS];
  object.position = add(add(scale(ex, (x0 + x1) / 2), scale(ey, (y0 + y1) / 2)), scale(normal, plane - WALL_THICKNESS / 2));
  object.quaternion = quaternionFromAxes(ex, ey, normal);
  return object;
}
