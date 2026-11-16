import type { PixelPoint, ReconstructElement, ReconstructInput, ProjectorParameter } from './venueReconstruct.ts';

/**
 * 「なぞる」パネルで利用者が確定した点と形 (#246)。推定器 (venueReconstruct) への入力を組み立てる。
 * 会場の下書きとは別に保存し、書き出す会場ファイルには含めない (ADR 0023)。
 */

export type TraceTool = 'roomCorner' | 'boxCorner' | 'rectangle' | 'length';

export interface TracePoint {
  id: string;
  /** 出力画素 (左上原点・y 下向き) */
  pixel: PixelPoint;
}

export type TraceShape =
  /** points = [角, 縦の辺の上, 残りの辺の上, 残りの辺の上]。部屋の隅は凹、箱の角は凸。 */
  | { kind: 'roomCorner' | 'boxCorner'; points: [string, string, string, string] }
  /** 周に沿った 4 隅 */
  | { kind: 'rectangle'; points: [string, string, string, string] }
  | { kind: 'length'; points: [string, string]; meters: number };

export interface TraceDocument {
  version: 1;
  output: { width: number; height: number };
  points: TracePoint[];
  shapes: TraceShape[];
  /** 投射比 (投射距離 / 画像の幅)。分からなければ null。 */
  throwRatio: number | null;
  /** 縦のレンズシフト (画像の高さに対する比、Projector.lensShift[1] と同じ単位)。分からなければ null。 */
  lensShiftY: number | null;
}

/** 道具ごとの手順 (確定する点の数と、各手順の案内文のキー)。 */
export const TOOL_STEPS = {
  roomCorner: ['traceRoomCorner1', 'traceRoomCorner2', 'traceRoomCorner3', 'traceRoomCorner4'],
  boxCorner: ['traceBoxCorner1', 'traceBoxCorner2', 'traceBoxCorner3', 'traceBoxCorner4'],
  rectangle: ['traceRectangle1', 'traceRectangle2', 'traceRectangle3', 'traceRectangle4'],
  length: ['traceLength1', 'traceLength2'],
} as const satisfies Record<TraceTool, readonly string[]>;

/** 既存の点に吸着する距離 (出力の高さに対する比)。 */
export const SNAP_RATIO = .015;
/** 投射比から求めた縦画角の不確かさ。#244 の計測の前提 (仕様値とズーム位置のずれ)。 */
export const THROW_RATIO_SIGMA_DEGREES = 2;
export const MIN_THROW_RATIO = .1, MAX_THROW_RATIO = 10;
const MAX_POINTS = 512;

export function emptyTrace(width: number, height: number): TraceDocument {
  return { version: 1, output: { width, height }, points: [], shapes: [], throwRatio: null, lensShiftY: null };
}

/** 投射比と出力のアスペクト比から縦画角 (度)。 */
export function throwRatioToVerticalFov(throwRatio: number, aspect: number): number {
  return 2 * Math.atan(1 / (2 * throwRatio * aspect)) * 180 / Math.PI;
}

function nextId(doc: TraceDocument): string {
  const max = doc.points.reduce((m, p) => Math.max(m, Number(p.id.slice(1)) || 0), 0);
  return `p${max + 1}`;
}

/** 点の表示番号 (1 始まり)。 */
export function pointLabel(id: string): string { return `P${id.slice(1)}`; }

/** 既存の点の近くなら、その点を共有する。そうでなければ新しい点を足す。 */
export function placePoint(doc: TraceDocument, pixel: PixelPoint): { doc: TraceDocument; id: string; snapped: boolean } {
  const radius = SNAP_RATIO * doc.output.height;
  let nearest: TracePoint | null = null, best = radius;
  for (const p of doc.points) {
    const d = Math.hypot(p.pixel[0] - pixel[0], p.pixel[1] - pixel[1]);
    if (d <= best) { best = d; nearest = p; }
  }
  if (nearest) return { doc, id: nearest.id, snapped: true };
  const id = nextId(doc);
  return { doc: { ...doc, points: [...doc.points, { id, pixel: [pixel[0], pixel[1]] }] }, id, snapped: false };
}

export function movePoint(doc: TraceDocument, id: string, pixel: PixelPoint): TraceDocument {
  return { ...doc, points: doc.points.map(p => p.id === id ? { id, pixel: [pixel[0], pixel[1]] } : p) };
}

/** 点と、その点を使う形を消す。 */
export function removePoint(doc: TraceDocument, id: string): TraceDocument {
  return { ...doc, points: doc.points.filter(p => p.id !== id), shapes: doc.shapes.filter(s => !s.points.includes(id)) };
}

/** どの形にも使われていない点を消す (なぞりかけの点を捨てるとき)。keep は残す。 */
export function dropUnused(doc: TraceDocument, keep: string[] = []): TraceDocument {
  const used = new Set([...keep, ...doc.shapes.flatMap(s => s.points)]);
  return { ...doc, points: doc.points.filter(p => used.has(p.id)) };
}

/** 出力解像度が変わったら、点を比例して移す。 */
export function resizeTrace(doc: TraceDocument, width: number, height: number): TraceDocument {
  if (doc.output.width === width && doc.output.height === height) return doc;
  const sx = width / doc.output.width, sy = height / doc.output.height;
  return { ...doc, output: { width, height }, points: doc.points.map(p => ({ id: p.id, pixel: [p.pixel[0] * sx, p.pixel[1] * sy] })) };
}

/**
 * 推定器への入力を組み立てる。形の知識に加え、次を自動で付ける:
 * - 部屋の隅・箱の角の縦の辺どうしは平行 (最初の部屋の隅の縦の辺へつなぐ)。
 * - 奥の辺を共有する 2 つの部屋の隅は、横の壁の床の辺どうしも平行。
 * - 床の隅 (縦の辺が像の上へ伸びる部屋の隅) があれば、箱の角の床側の点を床の上に置く (箱は床に置く、ADR 0023)。
 * 形に使われていない点 (なぞりかけ) は含めない。
 */
export function toReconstructInput(doc: TraceDocument): ReconstructInput {
  const pixels = new Map(doc.points.map(p => [p.id, p.pixel]));
  const used = [...new Set(doc.shapes.flatMap(s => s.points))].filter(id => pixels.has(id));
  const elements: ReconstructElement[] = [];
  const rooms = doc.shapes.filter((s): s is Extract<TraceShape, { kind: 'roomCorner' }> => s.kind === 'roomCorner');
  const boxes = doc.shapes.filter((s): s is Extract<TraceShape, { kind: 'boxCorner' }> => s.kind === 'boxCorner');
  for (const s of doc.shapes) {
    if (s.kind === 'roomCorner' || s.kind === 'boxCorner') {
      elements.push({ kind: 'orthogonalCorner', corner: s.points[0], edges: [s.points[1], s.points[2], s.points[3]],
        shape: s.kind === 'roomCorner' ? 'concave' : 'convex' });
    } else if (s.kind === 'rectangle') {
      elements.push({ kind: 'rectangle', vertices: [...s.points] });
    } else {
      elements.push({ kind: 'length', vertices: [...s.points], meters: s.meters });
    }
  }
  const verticals = [...rooms, ...boxes].map(s => [s.points[0], s.points[1]] as [string, string]);
  for (const segment of verticals.slice(1)) elements.push({ kind: 'parallel', segments: [verticals[0], segment] });
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i].points, b = rooms[j].points;
    const sideA = a.slice(2).filter(id => id !== b[0]), sideB = b.slice(2).filter(id => id !== a[0]);
    // 奥の辺を共有する (片方の辺の点がもう片方の角) ときだけ、残りの辺は横の壁の床の辺どうし。
    if (sideA.length === 1 && sideB.length === 1 && (a.includes(b[0]) || b.includes(a[0]))) {
      elements.push({ kind: 'parallel', segments: [[a[0], sideA[0]], [b[0], sideB[0]]] });
    }
  }
  const floor = rooms.find(s => (pixels.get(s.points[1])?.[1] ?? 0) < (pixels.get(s.points[0])?.[1] ?? 0));
  if (floor) {
    const plane: [string, string, string] = [floor.points[0], floor.points[2], floor.points[3]];
    for (const box of boxes) {
      const [corner, vertical] = box.points;
      const ground = (pixels.get(vertical)?.[1] ?? 0) > (pixels.get(corner)?.[1] ?? 0) ? vertical : corner;
      if (!plane.includes(ground)) elements.push({ kind: 'onPlane', vertex: ground, plane });
    }
  }
  const aspect = doc.output.width / doc.output.height;
  const locked: ProjectorParameter[] = doc.lensShiftY === null ? ['lensShiftX'] : ['lensShiftX', 'lensShiftY'];
  return {
    output: { ...doc.output },
    vertices: used.map(id => ({ id, pixel: [...pixels.get(id)!] as PixelPoint })),
    elements,
    locked,
    ...(doc.lensShiftY === null ? {} : { initial: { lensShift: [0, doc.lensShiftY] as [number, number] } }),
    ...(doc.throwRatio === null ? {} : { fovPrior: { degrees: throwRatioToVerticalFov(doc.throwRatio, aspect), sigmaDegrees: THROW_RATIO_SIGMA_DEGREES } }),
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 保存値を検証する。壊れていれば null (捨てて空から始める)。 */
export function parseTraceDocument(value: unknown): TraceDocument | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const output = v.output as Record<string, unknown> | undefined;
  if (v.version !== 1 || !output || !finite(output.width) || !finite(output.height) || output.width < 1 || output.height < 1) return null;
  if (!Array.isArray(v.points) || !Array.isArray(v.shapes) || v.points.length > MAX_POINTS || v.shapes.length > MAX_POINTS) return null;
  const points: TracePoint[] = [];
  for (const raw of v.points as unknown[]) {
    const p = raw as Record<string, unknown>;
    if (!p || typeof p.id !== 'string' || !/^p\d+$/.test(p.id) || !Array.isArray(p.pixel) || p.pixel.length !== 2 || !p.pixel.every(finite)) return null;
    if (points.some(q => q.id === p.id)) return null;
    points.push({ id: p.id, pixel: [p.pixel[0], p.pixel[1]] });
  }
  const ids = new Set(points.map(p => p.id));
  const shapes: TraceShape[] = [];
  for (const raw of v.shapes as unknown[]) {
    const s = raw as Record<string, unknown>;
    if (!s || !Array.isArray(s.points) || !s.points.every(id => typeof id === 'string' && ids.has(id))) return null;
    if (new Set(s.points).size !== s.points.length) return null;
    if ((s.kind === 'roomCorner' || s.kind === 'boxCorner' || s.kind === 'rectangle') && s.points.length === 4) {
      shapes.push({ kind: s.kind, points: s.points as [string, string, string, string] });
    } else if (s.kind === 'length' && s.points.length === 2 && finite(s.meters) && s.meters > 0) {
      shapes.push({ kind: 'length', points: s.points as [string, string], meters: s.meters });
    } else return null;
  }
  const throwRatio = v.throwRatio === null ? null : finite(v.throwRatio) && v.throwRatio >= MIN_THROW_RATIO && v.throwRatio <= MAX_THROW_RATIO ? v.throwRatio : undefined;
  const lensShiftY = v.lensShiftY === null ? null : finite(v.lensShiftY) && Math.abs(v.lensShiftY) <= 2 ? v.lensShiftY : undefined;
  if (throwRatio === undefined || lensShiftY === undefined) return null;
  return { version: 1, output: { width: output.width, height: output.height }, points, shapes, throwRatio, lensShiftY };
}
