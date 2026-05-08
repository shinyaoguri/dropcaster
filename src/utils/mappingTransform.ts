export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export const CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
export type CornerKey = typeof CORNER_KEYS[number];

/**
 * 個別マッピング。source crop と destination quad を1組持つ。
 */
export interface MappingEntry {
  id: string;
  name?: string;
  source: SourceRect;
  quad: Quad;
}

/**
 * マッピング機能全体の正規状態。
 * mappings は1件以上、activeId は常に mappings 中のいずれかを指す。
 * WindowController が単一の canonical 保持者で、ControlWindow / SketchPageView は
 * これの mirror をレンダリングするだけ。
 */
export interface MappingsState {
  mappings: MappingEntry[];
  activeId: string;
}

let _idCounter = 0;
export function generateMappingId(): string {
  _idCounter += 1;
  return `m${Date.now().toString(36)}_${_idCounter}`;
}

/**
 * mappings 配列の index から識別色を生成。
 * 黄金角（137.508°）でずらすことで隣接 index が常に最大限離れた hue になる。
 */
export function mappingColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 75%, 60%)`;
}

function defaultEntry(name?: string): MappingEntry {
  return {
    id: generateMappingId(),
    name,
    source: { x: 0, y: 0, width: 100, height: 100 },
    quad: defaultQuad(),
  };
}

export function defaultMappingsState(): MappingsState {
  const e = defaultEntry('Mapping 1');
  return { mappings: [e], activeId: e.id };
}

export function getActiveMapping(state: MappingsState): MappingEntry {
  return state.mappings.find(m => m.id === state.activeId) ?? state.mappings[0];
}

/** active な entry に partial を適用した新しい state を返す（純関数）。 */
export function withActiveMapping(
  state: MappingsState,
  patch: Partial<Pick<MappingEntry, 'source' | 'quad' | 'name'>>
): MappingsState {
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === state.activeId ? { ...m, ...patch } : m
    ),
  };
}

/** 新しい mapping を追加して active にする。可視性のため少しずらした quad で生成。 */
export function withAddedMapping(state: MappingsState): MappingsState {
  const offset = (state.mappings.length * 4) % 30; // 4% 刻みで重ならないよう少しずらす
  const id = generateMappingId();
  const entry: MappingEntry = {
    id,
    name: `Mapping ${state.mappings.length + 1}`,
    source: { x: 0, y: 0, width: 100, height: 100 },
    quad: {
      topLeft:     { x: 25 + offset, y: 25 + offset },
      topRight:    { x: 75 + offset, y: 25 + offset },
      bottomRight: { x: 75 + offset, y: 75 + offset },
      bottomLeft:  { x: 25 + offset, y: 75 + offset },
    },
  };
  return { mappings: [...state.mappings, entry], activeId: id };
}

/** 指定 id を削除（最後の1個は残す）。active が消えたら先頭を active に。 */
export function withRemovedMapping(state: MappingsState, id: string): MappingsState {
  if (state.mappings.length <= 1) return state;
  const filtered = state.mappings.filter(m => m.id !== id);
  const activeId = id === state.activeId ? filtered[0].id : state.activeId;
  return { mappings: filtered, activeId };
}

/** active 切替（存在しない id なら無視）。 */
export function withActiveSet(state: MappingsState, id: string): MappingsState {
  if (!state.mappings.some(m => m.id === id)) return state;
  return { ...state, activeId: id };
}

const MIN_DIMENSION = 0.0001;

/**
 * source 矩形（ソース canvas の % 座標）が親コンテナを正確に埋めるように
 * <video> のサイズと translate を計算する。X/Y は独立にスケールするので、
 * 矩形のアスペクト比に関わらず source 領域がそのまま destination 領域へ
 * 写像される（プロジェクタが任意矩形に投影するのと同じ挙動）。
 *
 * 利用条件:
 *  - 親要素は overflow: hidden で destination 矩形のサイズに設定
 *  - <video> は position: absolute; top: 0; left: 0;
 *    transform-origin: top left; object-fit: fill;
 */
export function applyVideoCrop(video: HTMLVideoElement, source: SourceRect): void {
  const safeWidth = Math.max(source.width, MIN_DIMENSION);
  const safeHeight = Math.max(source.height, MIN_DIMENSION);
  const scaleX = 100 / safeWidth;
  const scaleY = 100 / safeHeight;
  video.style.width = `${scaleX * 100}%`;
  video.style.height = `${scaleY * 100}%`;
  video.style.transform = `translate(${-source.x * scaleX}%, ${-source.y * scaleY}%)`;
}

export function defaultQuad(): Quad {
  return {
    topLeft:     { x: 25, y: 25 },
    topRight:    { x: 75, y: 25 },
    bottomRight: { x: 75, y: 75 },
    bottomLeft:  { x: 25, y: 75 },
  };
}

export function rectToQuad(rect: SourceRect): Quad {
  return {
    topLeft:     { x: rect.x,              y: rect.y },
    topRight:    { x: rect.x + rect.width, y: rect.y },
    bottomRight: { x: rect.x + rect.width, y: rect.y + rect.height },
    bottomLeft:  { x: rect.x,              y: rect.y + rect.height },
  };
}

export function quadBoundingRect(quad: Quad): SourceRect {
  const xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x];
  const ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function translateQuad(quad: Quad, dx: number, dy: number): Quad {
  return {
    topLeft:     { x: quad.topLeft.x + dx,     y: quad.topLeft.y + dy },
    topRight:    { x: quad.topRight.x + dx,    y: quad.topRight.y + dy },
    bottomRight: { x: quad.bottomRight.x + dx, y: quad.bottomRight.y + dy },
    bottomLeft:  { x: quad.bottomLeft.x + dx,  y: quad.bottomLeft.y + dy },
  };
}

export function cloneQuad(quad: Quad): Quad {
  return {
    topLeft:     { ...quad.topLeft },
    topRight:    { ...quad.topRight },
    bottomRight: { ...quad.bottomRight },
    bottomLeft:  { ...quad.bottomLeft },
  };
}

/**
 * 単位矩形 (0,0)-(width,height) を quad（pixel 座標、transform-origin: top left 基準）
 * に写像する CSS matrix3d 文字列を返す。退化（共線・面積0）なら 'none'。
 *
 * 単位矩形 → 任意四角形 への 2D ホモグラフィー（perspective 込み）を直接構築:
 *   x' = (a*u + b*v + c) / (g*u + h*v + 1)
 *   y' = (d*u + e*v + f) / (g*u + h*v + 1)
 * 8 個の係数を 4 隅の写像条件から閉形式で解く（Heckbert の公式）。
 */
function homographyMatrix3d(quad: Quad, width: number, height: number): string {
  if (width <= 0 || height <= 0) return 'none';

  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad;

  const det = (p1.x - p2.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p2.y);
  if (Math.abs(det) < 1e-9) return 'none';

  const rhsX = p0.x + p2.x - p1.x - p3.x;
  const rhsY = p0.y + p2.y - p1.y - p3.y;
  const g = (rhsX * (p3.y - p2.y) - (p3.x - p2.x) * rhsY) / det;
  const h = ((p1.x - p2.x) * rhsY - rhsX * (p1.y - p2.y)) / det;

  const a = p1.x * (g + 1) - p0.x;
  const b = p3.x * (h + 1) - p0.x;
  const c = p0.x;
  const d = p1.y * (g + 1) - p0.y;
  const e = p3.y * (h + 1) - p0.y;
  const f = p0.y;

  // 単位矩形の代わりに pixel 矩形 (width × height) を入力にしたいので u,v を割る
  const A = a / width,  B = b / height;
  const D = d / width,  E = e / height;
  const G = g / width,  H = h / height;

  // matrix3d は column-major:
  //   col1 = (A, D, 0, G)  -- x 入力に対する係数
  //   col2 = (B, E, 0, H)  -- y 入力に対する係数
  //   col3 = (0, 0, 1, 0)  -- z（未使用）
  //   col4 = (C, F, 0, 1)  -- 平行移動 + 同次成分
  return `matrix3d(${A}, ${D}, 0, ${G}, ${B}, ${E}, 0, ${H}, 0, 0, 1, 0, ${c}, ${f}, 0, 1)`;
}

/**
 * container を親要素 100% × 100% に配置したまま、その単位矩形を
 * quadPercent（親の % 座標）の四角形に写像する matrix3d を適用する。
 */
export function applyQuadTransform(container: HTMLElement, quadPercent: Quad): void {
  const parent = container.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W <= 0 || H <= 0) return;

  const pxQuad: Quad = {
    topLeft:     { x: quadPercent.topLeft.x     / 100 * W, y: quadPercent.topLeft.y     / 100 * H },
    topRight:    { x: quadPercent.topRight.x    / 100 * W, y: quadPercent.topRight.y    / 100 * H },
    bottomRight: { x: quadPercent.bottomRight.x / 100 * W, y: quadPercent.bottomRight.y / 100 * H },
    bottomLeft:  { x: quadPercent.bottomLeft.x  / 100 * W, y: quadPercent.bottomLeft.y  / 100 * H },
  };

  container.style.position = 'absolute';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.transformOrigin = 'top left';
  container.style.transform = homographyMatrix3d(pxQuad, W, H);
}
