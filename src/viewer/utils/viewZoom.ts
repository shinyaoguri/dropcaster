/**
 * 編集ビュー（ソース列・マッピング列）の拡大・パンの計算。表示だけの状態で、保存も Undo もしない。
 *
 * 座標の約束:
 *   - ビュー内の位置は viewport 左上を原点とした画面 px。
 *   - 「全体表示」(zoom = 1, pan = 0) のとき、内容は寸法 contentW × contentH で、その中心が
 *     (originX, originY) に来る。内容上の点 c（全体表示の px、左上原点）の画面位置は
 *       screen = origin + pan + (c - content / 2) × zoom
 *   - zoom は全体表示に対する倍率（1 = 100%）。
 */

export interface ViewZoom {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ViewGeometry {
  viewW: number;
  viewH: number;
  /** 全体表示のときの内容の中心（viewport 内の画面 px）。 */
  originX: number;
  originY: number;
  /** 全体表示のときの内容の寸法（画面 px）。 */
  contentW: number;
  contentH: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export const FIT_VIEW: Readonly<ViewZoom> = Object.freeze({ zoom: 1, panX: 0, panY: 0 });

/** パンしても内容をこの画面 px 以上は viewport 内に残す（見失わないため）。 */
export const PAN_KEEP_VISIBLE_PX = 48;

/** ボタンで 1 段拡大・縮小するときの倍率。 */
export const ZOOM_BUTTON_STEP = 1.25;

export function clampZoom(zoom: number, limits: ZoomLimits): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

/** 内容が viewport から完全に出ていかないようにパン量を制限する。 */
export function clampView(view: ViewZoom, geom: ViewGeometry): ViewZoom {
  return {
    zoom: view.zoom,
    panX: clampAxis(view.panX, view.zoom, geom.viewW, geom.originX, geom.contentW),
    panY: clampAxis(view.panY, view.zoom, geom.viewH, geom.originY, geom.contentH),
  };
}

function clampAxis(pan: number, zoom: number, view: number, origin: number, content: number): number {
  const half = (content * zoom) / 2;
  // 内容が小さいときは、内容の幅の分までしか要求しない
  const keep = Math.min(PAN_KEEP_VISIBLE_PX, half * 2, view);
  // 内容の右端 (origin + pan + half) が keep 以上、左端 (origin + pan - half) が view - keep 以下
  const lo = keep - origin - half;
  const hi = view - keep - origin + half;
  if (!(lo <= hi)) return 0;
  return Math.min(hi, Math.max(lo, pan));
}

/**
 * anchor（viewport 内の画面 px）の下にある内容の点を動かさずに、倍率を factor 倍する。
 * 倍率は limits に収め、パンは clampView で制限する。
 */
export function zoomAt(
  view: ViewZoom,
  factor: number,
  anchor: { x: number; y: number },
  geom: ViewGeometry,
  limits: ZoomLimits,
): ViewZoom {
  const zoom = clampZoom(view.zoom * factor, limits);
  const r = zoom / view.zoom;
  // screen = origin + pan + (c - half) × zoom を anchor で解き、zoom' で同じ screen になる pan' を求める
  const panX = (anchor.x - geom.originX) * (1 - r) + view.panX * r;
  const panY = (anchor.y - geom.originY) * (1 - r) + view.panY * r;
  return clampView({ zoom, panX, panY }, geom);
}

export function panBy(view: ViewZoom, dx: number, dy: number, geom: ViewGeometry): ViewZoom {
  return clampView({ zoom: view.zoom, panX: view.panX + dx, panY: view.panY + dy }, geom);
}

/** WheelEvent の deltaMode（0: px, 1: 行, 2: ページ）を px にそろえる係数。 */
const DELTA_MODE_PX = [1, 16, 800];
/** 1 イベントで動かす量の上限（px 換算）。高速スクロールで一気に飛ばないように。 */
const MAX_WHEEL_PX = 300;

/**
 * ホイール 1 イベント分の拡大率。下へ回す（deltaY > 0）と縮小。
 * トラックパッドのピンチは ctrlKey 付きの小さな deltaY で届くので、感度を上げる。
 */
export function wheelZoomFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
  const px = e.deltaY * (DELTA_MODE_PX[e.deltaMode] ?? 1);
  const clamped = Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, px));
  const sensitivity = e.ctrlKey ? 0.01 : 0.002;
  return Math.exp(-clamped * sensitivity);
}

export function isFitView(view: ViewZoom): boolean {
  return view.zoom === 1 && view.panX === 0 && view.panY === 0;
}
