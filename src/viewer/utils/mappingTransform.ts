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
 * enabled が false の場合、メイン画面の投影出力からは除外される（コントロール上は編集可能）。
 *
 * 出力との関係は「quad の bounds と各出力の bounds の交差」だけで自動的に決まる。
 * mapping と output は独立した概念で、所属関係を持たない — quad を仮想キャンバス上の
 * どこに置くかで自然にどの出力に映るかが決まる。
 *
 * quad の座標は「仮想キャンバス」座標（px）。仮想キャンバス上の全出力（OutputDef.position
 * + OutputDef.size の矩形）と quad の交差部分だけが各出力で見える。
 *
 * kind は省略時 'mapping' として扱う（既存ファイルとの後方互換）。
 */
export interface MappingEntry {
  kind?: 'mapping';
  id: string;
  name?: string;
  enabled?: boolean;
  source: SourceRect;
  quad: Quad;
}

/**
 * マスク（黒い多角形）。enabled な mask は最前面に置かれて映像を隠す。
 * points は仮想キャンバス px 座標。state.mappings 配列内の順序が描画順（先頭ほど前面）を
 * 決める — mapping / mask の区別なく同じ並び順で扱う。
 *
 * drafting=true の間はペンツールで頂点を追加中の状態。点数 < 3 でも合法とし、出力には
 * 描画しない（プレビューでは未閉合のポリラインを表示する）。closed されると drafting は
 * 落ち、通常編集モードに移行する。
 */
export interface MaskEntry {
  kind: 'mask';
  id: string;
  name?: string;
  enabled?: boolean;
  /** 多角形頂点（仮想キャンバス px 座標）。drafting 中は空〜任意点数を許容。 */
  points: Point[];
  /** ペンツールで描画中フラグ。true の間は出力に描画されず、プレビューはポリライン表示。 */
  drafting?: boolean;
}

/** mapping と mask を統一的に扱う union（state.mappings の要素型）。 */
export type MappingItem = MappingEntry | MaskEntry;

export function isMaskEntry(item: MappingItem): item is MaskEntry {
  return item.kind === 'mask';
}

export function isMappingEntry(item: MappingItem): item is MappingEntry {
  return item.kind !== 'mask';
}

export function isMappingEnabled(m: MappingItem): boolean {
  return m.enabled !== false;
}

/**
 * 投影先の出力ウィンドウ／プロジェクタ1台ぶんの定義。
 *
 *  - position: 仮想キャンバス上の左上座標（px）。この出力がキャンバスのどこを担当するか。
 *  - size:     仮想キャンバス上のサイズ（px）。この出力が担当する矩形の幅・高さ。
 *              （実出力ウィンドウの解像度＝pixelSize とは独立。通常は一致するが、
 *               論理サイズと物理サイズを別にすることもできる）
 *  - screen:   出力ウィンドウを送り込みたい物理スクリーン情報（任意）。
 *              placeOnExternalScreen が利用する。
 *  - pixelSize: 実出力ウィンドウのバッキングストア相当解像度（任意）。未指定時は
 *              size をフォールバックに使う。aspect 計算の参考値。
 */
export interface OutputDef {
  id: string;
  name?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  screen?: { left: number; top: number; width: number; height: number; label?: string };
  pixelSize?: { width: number; height: number };
}

/**
 * マッピング機能全体の正規状態。
 *
 *  - version: 現在のスキーマバージョン（2）。v1 から非互換。
 *  - canvas: 仮想キャンバスのサイズ（px）。原点 (0,0) から全 output を包含する座標空間
 *    （quad は含めない — はみ出した quad はどの出力にも映らないだけ）。
 *    outputs を追加・移動・削除するたびに recomputeCanvasBounds で再計算される。
 *    削除時は withRemovedOutput が削除した出力の帯を詰めてから再計算する。
 *  - outputs は1件以上。複数の出力ウィンドウを同時に扱う場合は最大4件まで（UI 制約）。
 *  - 各 mapping の quad は仮想キャンバス px。output との関係は quad と output bounds の
 *    交差判定で自動的に決まる（mapping は output に所属しない）。
 *  - mappings は1件以上、activeId は常に mappings 中のいずれかを指す。
 *  - activeOutputId は「出力フレーム自体を選択中」の状態（layout 編集用、未選択なら undefined）。
 *
 * WindowController が単一の canonical 保持者で、ControlWindow / SketchPageView は
 * これの mirror をレンダリングするだけ。
 */
export interface MappingsState {
  version: 2;
  canvas: { width: number; height: number };
  outputs: OutputDef[];
  /** 描画項目（mapping / mask）の統一リスト。配列の先頭ほど前面（z-index 高）。 */
  mappings: MappingItem[];
  activeId: string;
  activeOutputId?: string;
}

let _idCounter = 0;
export function generateMappingId(): string {
  _idCounter += 1;
  return `m${Date.now().toString(36)}_${_idCounter}`;
}

let _maskIdCounter = 0;
export function generateMaskId(): string {
  _maskIdCounter += 1;
  return `k${Date.now().toString(36)}_${_maskIdCounter}`;
}

let _outputIdCounter = 0;
export function generateOutputId(): string {
  _outputIdCounter += 1;
  return `o${Date.now().toString(36)}_${_outputIdCounter}`;
}

/** 出力解像度の初期値。実スクリーン情報が無い環境（getScreenDetails 未対応など）でのフォールバック。 */
export const DEFAULT_OUTPUT_WIDTH = 1920;
export const DEFAULT_OUTPUT_HEIGHT = 1080;
/** 出力同時表示の上限（UI 制約）。 */
export const MAX_OUTPUTS = 4;

/**
 * mappings 配列の index から識別色を生成。
 * 黄金角（137.508°）でずらすことで隣接 index が常に最大限離れた hue になる。
 */
export function mappingColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 75%, 60%)`;
}

/**
 * 既定の出力1件を生成する。position は原点（複数並べる場合は呼び出し側で
 * オフセットする — withAddedOutput が右に詰めて配置する）。
 */
export function defaultOutput(name?: string): OutputDef {
  return {
    id: generateOutputId(),
    name,
    position: { x: 0, y: 0 },
    size: { width: DEFAULT_OUTPUT_WIDTH, height: DEFAULT_OUTPUT_HEIGHT },
  };
}

/**
 * 全 outputs を包含する仮想キャンバス寸法（最小サイズ）を返す。
 * outputs が空なら DEFAULT_OUTPUT_WIDTH × DEFAULT_OUTPUT_HEIGHT。
 */
export function recomputeCanvasBounds(outputs: OutputDef[]): { width: number; height: number } {
  if (outputs.length === 0) {
    return { width: DEFAULT_OUTPUT_WIDTH, height: DEFAULT_OUTPUT_HEIGHT };
  }
  let w = 0;
  let h = 0;
  for (const o of outputs) {
    w = Math.max(w, o.position.x + o.size.width);
    h = Math.max(h, o.position.y + o.size.height);
  }
  return { width: w, height: h };
}

export function defaultMappingsState(): MappingsState {
  const out = defaultOutput('Output 1');
  const e: MappingEntry = {
    id: generateMappingId(),
    name: 'Mapping 1',
    source: { x: 0, y: 0, width: 100, height: 100 },
    quad: defaultQuad(out),
  };
  return {
    version: 2,
    canvas: recomputeCanvasBounds([out]),
    outputs: [out],
    mappings: [e],
    activeId: e.id,
  };
}

/**
 * 現 active item を返す。mapping / mask いずれも含む union を返すので、
 * 呼び出し側は isMappingEntry / isMaskEntry で絞る必要がある。
 * mappings が空のときは undefined を返す。
 */
export function getActiveItem(state: MappingsState): MappingItem | undefined {
  return state.mappings.find(m => m.id === state.activeId) ?? state.mappings[0];
}

/**
 * active item が mapping（kind !== 'mask'）なら返す。mask の時 / item が無い時は undefined。
 * source / quad を操作する呼び出し側はこれで絞ってから読む。
 */
export function getActiveMapping(state: MappingsState): MappingEntry | undefined {
  const item = getActiveItem(state);
  return item && isMappingEntry(item) ? item : undefined;
}

/** active item が mask なら返す。mapping の時は undefined。 */
export function getActiveMask(state: MappingsState): MaskEntry | undefined {
  const item = getActiveItem(state);
  return item && isMaskEntry(item) ? item : undefined;
}

/**
 * 新しい mapping を追加して active にする。可視性のため少しずらした quad で生成。
 * 配置位置は activeOutputId（あれば）の中央 → outputs[0] の中央 にフォールバック。
 * 既存項目数に応じて 4% 刻みの斜めオフセットで重ならないようにする。
 * 配列の先頭ほど前面なので新規 mapping は先頭に挿入する（追加直後に最前面で編集できる）。
 */
export function withAddedMapping(state: MappingsState): MappingsState {
  const id = generateMappingId();
  const targetOut =
    state.outputs.find(o => o.id === state.activeOutputId)
      ?? state.outputs[0];
  const mappingCount = state.mappings.filter(isMappingEntry).length;
  const offsetFrac = (mappingCount * 0.04) % 0.30;
  const px = (frac: number) => ({
    x: targetOut.position.x + (frac + offsetFrac) * targetOut.size.width,
    y: targetOut.position.y + (frac + offsetFrac) * targetOut.size.height,
  });
  const entry: MappingEntry = {
    id,
    name: `Mapping ${mappingCount + 1}`,
    source: { x: 0, y: 0, width: 100, height: 100 },
    quad: {
      topLeft:     { x: px(0.25).x, y: px(0.25).y },
      topRight:    { x: px(0.75).x, y: px(0.25).y },
      bottomRight: { x: px(0.75).x, y: px(0.75).y },
      bottomLeft:  { x: px(0.25).x, y: px(0.75).y },
    },
  };
  return { ...state, mappings: [entry, ...state.mappings], activeId: id };
}

/**
 * 新しい mask を追加して active にする。初期は drafting=true の空ポリゴンで、ペンツールで
 * 頂点を打って完成させる前提（MaskEditPanel が click ハンドラを張る）。配列の先頭ほど
 * 前面なので mask も先頭に挿入する（masks は最前面で映像を隠す用途のため、デフォルトで
 * 最も手前に置く）。
 */
export function withAddedMask(state: MappingsState): MappingsState {
  const id = generateMaskId();
  // 連打で 0 点の drafting マスクが累積するのを避ける（visible に何も無い空草稿は破棄）。
  // 2 点以上打ってる途中の中断は保存する（意図的な部分作業）。
  const cleaned = state.mappings.filter(m => !(isMaskEntry(m) && m.drafting && m.points.length === 0));
  const maskCount = cleaned.filter(isMaskEntry).length;
  const entry: MaskEntry = {
    kind: 'mask',
    id,
    name: `Mask ${maskCount + 1}`,
    points: [],
    drafting: true,
  };
  return { ...state, mappings: [entry, ...cleaned], activeId: id };
}

/** drafting mask に頂点を末尾追加する。drafting でない / mask でない時は no-op。 */
export function withMaskPointAppended(state: MappingsState, id: string, point: Point): MappingsState {
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === id && isMaskEntry(m) && m.drafting
        ? { ...m, points: [...m.points, { x: point.x, y: point.y }] }
        : m
    ),
  };
}

/**
 * drafting mask を「閉じる」（drafting=false）。3 頂点未満なら state そのまま（呼び出し側で
 * Esc/auto-discard する想定）。
 */
export function withMaskDraftingCommitted(state: MappingsState, id: string): MappingsState {
  const target = state.mappings.find(m => m.id === id);
  if (!target || !isMaskEntry(target) || !target.drafting) return state;
  if (target.points.length < 3) return state;
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === id && isMaskEntry(m) ? { ...m, drafting: false } : m
    ),
  };
}

/** 指定 id を削除（最後の1個は残す）。active が消えたら先頭を active に。 */
export function withRemovedMapping(state: MappingsState, id: string): MappingsState {
  if (state.mappings.length <= 1) return state;
  const filtered = state.mappings.filter(m => m.id !== id);
  if (filtered.length === state.mappings.length) return state;
  const activeId = id === state.activeId ? filtered[0].id : state.activeId;
  return { ...state, mappings: filtered, activeId };
}

/**
 * 項目を targetIndex の位置に移動した state を返す（drag-reorder 用）。
 * targetIndex はクランプされる。同一位置なら no-op。
 */
export function withMappingReordered(
  state: MappingsState,
  id: string,
  targetIndex: number,
): MappingsState {
  const from = state.mappings.findIndex(m => m.id === id);
  if (from < 0) return state;
  const clamped = Math.max(0, Math.min(state.mappings.length - 1, targetIndex));
  if (from === clamped) return state;
  const next = state.mappings.slice();
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return { ...state, mappings: next };
}

/** mask の頂点列を差し替えた state を返す（rename 等と同様の純関数）。 */
export function withMaskPointsSet(state: MappingsState, id: string, points: Point[]): MappingsState {
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === id && isMaskEntry(m) ? { ...m, points: points.map(p => ({ x: p.x, y: p.y })) } : m
    ),
  };
}

/** active 切替（存在しない id なら無視）。 */
export function withActiveSet(state: MappingsState, id: string): MappingsState {
  if (!state.mappings.some(m => m.id === id)) return state;
  return { ...state, activeId: id };
}

/** 指定 id の enabled をトグルする。 */
export function withMappingToggled(state: MappingsState, id: string): MappingsState {
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === id ? { ...m, enabled: !isMappingEnabled(m) } : m
    ),
  };
}

/** 指定 id の name を変更する（空文字なら id をフォールバック）。 */
export function withMappingRenamed(state: MappingsState, id: string, name: string): MappingsState {
  const trimmed = name.trim();
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === id ? { ...m, name: trimmed || undefined } : m
    ),
  };
}

/**
 * 出力を 1 件追加して activeOutputId に。MAX_OUTPUTS 到達時は no-op。
 * position は他出力の右側に水平に並べる。canvas も再計算。
 */
export function withAddedOutput(state: MappingsState): MappingsState {
  if (state.outputs.length >= MAX_OUTPUTS) return state;
  const rightmost = state.outputs.reduce(
    (acc, o) => Math.max(acc, o.position.x + o.size.width),
    0,
  );
  const newOut: OutputDef = {
    id: generateOutputId(),
    name: `Output ${state.outputs.length + 1}`,
    position: { x: rightmost, y: 0 },
    size: { width: DEFAULT_OUTPUT_WIDTH, height: DEFAULT_OUTPUT_HEIGHT },
  };
  const outputs = [...state.outputs, newOut];
  return {
    ...state,
    outputs,
    canvas: recomputeCanvasBounds(outputs),
    activeOutputId: newOut.id,
  };
}

/**
 * 出力を 1 件削除する。withAddedOutput（右端に 1 台ぶん広げる）の逆操作として、
 * 仮想キャンバスを詰め直す（#99、ADR 0008）。最後の 1 件・該当なしなら no-op。
 *
 *  1. 削除した出力の上にあり、残りのどの出力にも乗らなくなる mapping / mask（取り残し）を、
 *     削除した出力の中での相対位置を保ったまま残りの先頭の出力へ移す。
 *  2. 削除した出力が占めていた x / y の帯のうち、残りの出力に覆われていない部分を潰す。
 *     帯の外にある既存の隙間は触らない。
 *  3. 出力と item を一緒に平行移動する。item はいちばん大きく重なる出力（アンカー）と
 *     同じだけ動くので、各出力から見た item の位置は変わらない＝投影結果は変わらない。
 *
 * activeOutputId がその出力を指していたら undefined に戻す。
 */
export function withRemovedOutput(state: MappingsState, outputId: string): MappingsState {
  if (state.outputs.length <= 1) return state;
  const removed = state.outputs.find(o => o.id === outputId);
  if (!removed) return state; // 該当なし
  const remaining = state.outputs.filter(o => o.id !== outputId);
  const removedRect = outputRect(removed);
  const target = remaining[0];

  const gapsX = uncoveredParts(
    removed.position.x, removed.position.x + removed.size.width,
    remaining.map(o => [o.position.x, o.position.x + o.size.width]),
  );
  const gapsY = uncoveredParts(
    removed.position.y, removed.position.y + removed.size.height,
    remaining.map(o => [o.position.y, o.position.y + o.size.height]),
  );
  const shiftAt = (p: Point): Point => ({
    x: collapseShift(p.x, gapsX),
    y: collapseShift(p.y, gapsY),
  });

  const mappings = state.mappings.map(item => {
    const bounds = itemBounds(item);
    if (!bounds) return item;
    let anchor: OutputDef | undefined;
    let bestArea = 0;
    for (const o of remaining) {
      const area = overlapArea(bounds, outputRect(o));
      if (area > bestArea) {
        bestArea = area;
        anchor = o;
      }
    }
    let moved = item;
    if (!anchor && overlapArea(bounds, removedRect) > 0) {
      moved = translateItem(
        item,
        target.position.x - removed.position.x,
        target.position.y - removed.position.y,
      );
      anchor = target;
    }
    // どの出力にも乗らない item は自分の左上の位置で潰した分だけ動かす
    const shift = shiftAt(anchor ? anchor.position : { x: bounds.x, y: bounds.y });
    return translateItem(moved, shift.x, shift.y);
  });

  const outputs = remaining.map(o => {
    const shift = shiftAt(o.position);
    if (shift.x === 0 && shift.y === 0) return o;
    return { ...o, position: { x: o.position.x + shift.x, y: o.position.y + shift.y } };
  });

  return {
    ...state,
    outputs,
    mappings,
    canvas: recomputeCanvasBounds(outputs),
    activeOutputId: state.activeOutputId === outputId ? undefined : state.activeOutputId,
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function outputRect(o: OutputDef): Rect {
  return { x: o.position.x, y: o.position.y, width: o.size.width, height: o.size.height };
}

/** mapping の quad / mask の頂点の axis-aligned bounding box。頂点が無ければ null。 */
function itemBounds(item: MappingItem): Rect | null {
  const pts = isMaskEntry(item) ? item.points : quadVertices(item.quad);
  if (pts.length === 0) return null;
  let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 2 矩形の重なり面積。辺が接しているだけなら 0。 */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function translateItem(item: MappingItem, dx: number, dy: number): MappingItem {
  if (dx === 0 && dy === 0) return item;
  if (isMaskEntry(item)) {
    return { ...item, points: item.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  }
  return { ...item, quad: translateQuad(item.quad, dx, dy) };
}

/** 半開区間 [start, end) のうち、covers のどれにも覆われない部分区間を昇順で返す。 */
function uncoveredParts(start: number, end: number, covers: Array<[number, number]>): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let cursor = start;
  for (const [a, b] of [...covers].sort((p, q) => p[0] - q[0])) {
    if (cursor >= end) break;
    if (b <= cursor) continue;
    if (a >= end) break;
    if (a > cursor) parts.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) parts.push([cursor, end]);
  return parts;
}

/** gaps を潰したとき座標 v が動く量（0 以下）。gap の内側の点は gap の始点へ寄る。 */
function collapseShift(v: number, gaps: Array<[number, number]>): number {
  let shift = 0;
  for (const [a, b] of gaps) {
    if (v >= b) shift -= b - a;
    else if (v > a) shift -= v - a;
  }
  return shift;
}

/**
 * 出力の position（仮想キャンバス内の左上座標）と size（同サイズ）を更新。
 * 負座標は 0 にクランプ（仮想キャンバスは原点 (0,0) から始まる）。canvas も再計算。
 */
export function withOutputLayoutSet(
  state: MappingsState,
  outputId: string,
  patch: { position?: { x: number; y: number }; size?: { width: number; height: number } },
): MappingsState {
  const outputs = state.outputs.map(o => {
    if (o.id !== outputId) return o;
    const position = patch.position
      ? { x: Math.max(0, patch.position.x), y: Math.max(0, patch.position.y) }
      : o.position;
    const size = patch.size
      ? { width: Math.max(1, patch.size.width), height: Math.max(1, patch.size.height) }
      : o.size;
    return { ...o, position, size };
  });
  return { ...state, outputs, canvas: recomputeCanvasBounds(outputs) };
}

/** 出力をリネーム（空文字なら undefined）。 */
export function withOutputRenamed(state: MappingsState, outputId: string, name: string): MappingsState {
  const trimmed = name.trim();
  return {
    ...state,
    outputs: state.outputs.map(o =>
      o.id === outputId ? { ...o, name: trimmed || undefined } : o
    ),
  };
}

/** activeOutputId を設定。`undefined` で解除、無効 id は no-op。 */
export function withActiveOutputSet(state: MappingsState, outputId: string | undefined): MappingsState {
  if (outputId !== undefined && !state.outputs.some(o => o.id === outputId)) return state;
  return { ...state, activeOutputId: outputId };
}

/**
 * 任意の値が v2 MappingsState として妥当かチェックして返す（不正なら null）。
 * 保存ファイル / localStorage の読み込み時に使う。v1（quad が%）は受け付けない。
 */
export function parseMappingsState(data: unknown): MappingsState | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  // v1 を弾く（version フィールド無し / 1 はリジェクト）
  if (obj.version !== 2) return null;

  const list = obj.mappings;
  if (!Array.isArray(list) || list.length === 0) return null;

  const isPoint = (p: unknown): p is Point =>
    !!p && typeof (p as Point).x === 'number' && typeof (p as Point).y === 'number';

  // --- outputs を解析 ---
  const validOutputs: OutputDef[] = [];
  const rawOutputs = obj.outputs;
  if (Array.isArray(rawOutputs)) {
    for (const rawOut of rawOutputs) {
      if (!rawOut || typeof rawOut !== 'object') continue;
      const o = rawOut as Record<string, unknown>;
      if (typeof o.id !== 'string') continue;
      const pos = o.position as Record<string, unknown> | undefined;
      const sz = o.size as Record<string, unknown> | undefined;
      if (
        !pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' ||
        !sz || typeof sz.width !== 'number' || typeof sz.height !== 'number'
      ) continue;
      const screenRaw = o.screen as Record<string, unknown> | undefined;
      const screen =
        screenRaw &&
        typeof screenRaw.left === 'number' &&
        typeof screenRaw.top === 'number' &&
        typeof screenRaw.width === 'number' &&
        typeof screenRaw.height === 'number'
          ? {
              left: screenRaw.left,
              top: screenRaw.top,
              width: screenRaw.width,
              height: screenRaw.height,
              label: typeof screenRaw.label === 'string' ? screenRaw.label : undefined,
            }
          : undefined;
      const pixelRaw = o.pixelSize as Record<string, unknown> | undefined;
      const pixelSize =
        pixelRaw &&
        typeof pixelRaw.width === 'number' &&
        typeof pixelRaw.height === 'number'
          ? { width: pixelRaw.width, height: pixelRaw.height }
          : undefined;
      validOutputs.push({
        id: o.id,
        name: typeof o.name === 'string' ? o.name : undefined,
        position: { x: pos.x, y: pos.y },
        size: { width: sz.width, height: sz.height },
        screen,
        pixelSize,
      });
    }
  }
  if (validOutputs.length === 0) return null;
  const outputIdSet = new Set(validOutputs.map(o => o.id));

  // --- canvas: 明示値があれば採用、無ければ outputs から再計算 ---
  const canvasRaw = obj.canvas as Record<string, unknown> | undefined;
  const canvas =
    canvasRaw &&
    typeof canvasRaw.width === 'number' &&
    typeof canvasRaw.height === 'number'
      ? { width: canvasRaw.width, height: canvasRaw.height }
      : recomputeCanvasBounds(validOutputs);

  // --- mappings を解析（mapping / mask の混在配列） ---
  const validMappings: MappingItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== 'string') return null;
    const name = typeof m.name === 'string' ? m.name : undefined;
    const enabled = typeof m.enabled === 'boolean' ? m.enabled : undefined;

    if (m.kind === 'mask') {
      const rawPoints = m.points;
      if (!Array.isArray(rawPoints)) return null;
      const drafting = m.drafting === true;
      // drafting なら点数 0〜2 も合法（ペンツールで描画中の保存ファイルを許容）。
      if (!drafting && rawPoints.length < 3) return null;
      const points: Point[] = [];
      for (const p of rawPoints) {
        if (!isPoint(p)) return null;
        points.push({ x: p.x, y: p.y });
      }
      validMappings.push({ kind: 'mask', id: m.id, name, enabled, points, drafting: drafting || undefined });
      continue;
    }

    const src = m.source as Record<string, unknown> | undefined;
    if (!src) return null;
    if (
      typeof src.x !== 'number' ||
      typeof src.y !== 'number' ||
      typeof src.width !== 'number' ||
      typeof src.height !== 'number'
    ) return null;
    const q = m.quad as Record<string, unknown> | undefined;
    if (!q || !isPoint(q.topLeft) || !isPoint(q.topRight) || !isPoint(q.bottomRight) || !isPoint(q.bottomLeft)) {
      return null;
    }
    validMappings.push({
      id: m.id,
      name,
      enabled,
      source: { x: src.x, y: src.y, width: src.width, height: src.height },
      quad: {
        topLeft:     { x: q.topLeft.x,     y: q.topLeft.y },
        topRight:    { x: q.topRight.x,    y: q.topRight.y },
        bottomRight: { x: q.bottomRight.x, y: q.bottomRight.y },
        bottomLeft:  { x: q.bottomLeft.x,  y: q.bottomLeft.y },
      },
    });
  }

  let activeId = typeof obj.activeId === 'string' ? obj.activeId : '';
  if (!validMappings.some(m => m.id === activeId)) {
    activeId = validMappings[0].id;
  }

  let activeOutputId: string | undefined =
    typeof obj.activeOutputId === 'string' ? obj.activeOutputId : undefined;
  if (activeOutputId && !outputIdSet.has(activeOutputId)) {
    activeOutputId = undefined;
  }

  return { version: 2, canvas, outputs: validOutputs, mappings: validMappings, activeId, activeOutputId };
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

  // source は元 canvas / video 全体を 0..100% とする矩形。
  // destination container に表示されるべき元画像上の座標 p は、
  // container 内では (p - source.x) / source.width の位置に来る必要がある。
  //
  // そのためまず video 自身を 100 / source.width 倍に拡大し、
  // source.width% 分の元画像が container の 100% 幅をちょうど埋めるようにする。
  // 次に translate(-source.x%) をかける。CSS の translate(%) は「変形後の親」
  // ではなく「移動する要素自身のサイズ」基準なので、拡大済み video の
  // source.x% は元画像座標で source.x% ぶんの移動に相当する。
  //
  // 例: x=25,width=50 の場合、video 幅は 200%。translateX(-25%) は
  // 200% 幅の 25% = container 幅の 50% だけ左へ動くため、
  // 元画像の 25..75% が container の 0..100% に一致する。
  video.style.width = `${scaleX * 100}%`;
  video.style.height = `${scaleY * 100}%`;
  video.style.transform = `translate(${-source.x}%, ${-source.y}%)`;
}

/**
 * 既定 quad（仮想キャンバス px）。output を渡せばその中央 25..75% を覆う px 四角形、
 * 渡さなければ DEFAULT_OUTPUT_WIDTH/HEIGHT の中央。
 */
export function defaultQuad(output?: OutputDef): Quad {
  const base = output ?? {
    position: { x: 0, y: 0 },
    size: { width: DEFAULT_OUTPUT_WIDTH, height: DEFAULT_OUTPUT_HEIGHT },
  };
  const x0 = base.position.x + base.size.width * 0.25;
  const x1 = base.position.x + base.size.width * 0.75;
  const y0 = base.position.y + base.size.height * 0.25;
  const y1 = base.position.y + base.size.height * 0.75;
  return {
    topLeft:     { x: x0, y: y0 },
    topRight:    { x: x1, y: y0 },
    bottomRight: { x: x1, y: y1 },
    bottomLeft:  { x: x0, y: y1 },
  };
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

/** quad の重心（4 隅の平均）。scale/rotate の中心として使う。 */
export function quadCentroid(quad: Quad): Point {
  return {
    x: (quad.topLeft.x + quad.topRight.x + quad.bottomRight.x + quad.bottomLeft.x) / 4,
    y: (quad.topLeft.y + quad.topRight.y + quad.bottomRight.y + quad.bottomLeft.y) / 4,
  };
}

/**
 * quad の全 4 隅を `center` 中心に `factor` 倍する（形状はそのままで拡大縮小）。
 * factor < 0 は呼び出し側で防ぐ想定（負スケール = 反転は意図しない）。
 */
export function scaleQuadAround(quad: Quad, center: Point, factor: number): Quad {
  const scale = (p: Point): Point => ({
    x: center.x + (p.x - center.x) * factor,
    y: center.y + (p.y - center.y) * factor,
  });
  return {
    topLeft:     scale(quad.topLeft),
    topRight:    scale(quad.topRight),
    bottomRight: scale(quad.bottomRight),
    bottomLeft:  scale(quad.bottomLeft),
  };
}

/**
 * quad の全 4 隅を `center` 中心に `angleRad` 回転する（形状はそのままで回転）。
 * 正の angle = 反時計回り（数学的標準）— ただし画面座標は Y 軸下向きなので、見た目は時計回り。
 */
export function rotateQuadAround(quad: Quad, center: Point, angleRad: number): Quad {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rot = (p: Point): Point => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  };
  return {
    topLeft:     rot(quad.topLeft),
    topRight:    rot(quad.topRight),
    bottomRight: rot(quad.bottomRight),
    bottomLeft:  rot(quad.bottomLeft),
  };
}

/** a×b（2D 外積の z 成分）。画面座標（y 下向き）では正 = 見た目で時計回りに曲がる。 */
function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** quad の 4 隅を CORNER_KEYS 順（TL→TR→BR→BL）の配列で返す。 */
function quadVertices(quad: Quad): Point[] {
  return CORNER_KEYS.map(k => quad[k]);
}

/** 各頂点での曲がり（前の辺 × 次の辺）。CORNER_KEYS 順。 */
function quadTurns(quad: Quad): number[] {
  const v = quadVertices(quad);
  return v.map((p, i) => {
    const prev = v[(i + 3) % 4];
    const next = v[(i + 1) % 4];
    return cross(p.x - prev.x, p.y - prev.y, next.x - p.x, next.y - p.y);
  });
}

/**
 * quad が（退化していない）凸四角形か。
 *
 * 矩形 → quad のホモグラフィー（射影変換）は凸な矩形を必ず凸四角形へ写すので、凹んだ quad・
 * 自己交差した quad には正しい写像が存在しない。それでも係数は解けてしまい、同次座標の分母が
 * 映像の内部で符号を変えて、映像が quad の外側へ反転して描かれる（#95）。
 *
 * 4 頂点の曲がりがすべて同符号なら凸（4 頂点では同符号のまま 2 周はできない）。向きは
 * 時計回り・反時計回りのどちらも合法（左右・上下に反転させた quad も正しく写像できる）。
 * 自己交差（蝶ネクタイ形）は符号が混ざるので弾かれる。
 */
export function isConvexQuad(quad: Quad): boolean {
  const turns = quadTurns(quad);
  const eps = 1e-9;
  return turns.every(t => t > eps) || turns.every(t => t < -eps);
}

/**
 * 隅を動かすときに許す「遠近の強さ」の上限。
 *
 * 遠近の強さ = ホモグラフィーの同次座標の分母 w = g·u + h·v + 1 の、4 隅での最大 / 最小。
 * w が小さい隅ほど映像が大きく引き伸ばされる。凸でさえあればよいとして凸の境界すれすれ
 * まで隅を寄せると、この比が数百倍になってホモグラフィーがほぼ特異になり、枠線が quad の
 * 広い範囲を塗り、隅のわずかな動きで映像が大きく揺れる（#97）。#97 の配置で測ると、
 * 20 倍なら隅が 1px 動いたときの映像の動きが 1px 未満に収まる（測定値は ADR 0007）。
 * 台形でいえば平行な 2 辺の長さが 20:1。
 *
 * w の 4 隅での値は、反対側の隅の「角の三角形」（その隅と両隣の 3 点）の面積に比例するので、
 * 遠近の強さ = 4 つの曲がり（quadTurns）の絶対値の最大 / 最小、として求まる。
 */
const MAX_PERSPECTIVE_RATIO = 20;

/** n·p >= c の半平面（n は単位法線）。 */
interface HalfPlane { nx: number; ny: number; c: number }

/**
 * quad の隅 `corner` を `target` へ動かしたいときの、実際の移動先を返す。
 *
 * - 動かしても quad が凸で、遠近の強さが上限（MAX_PERSPECTIVE_RATIO）以下なら `target` を
 *   そのまま返す
 * - 元の quad がそもそも凸でない（凹んだ quad を保存した古い設定など）なら制限しない。
 *   ここで止めると隅を動かして直すこともできなくなるため
 * - それ以外は、条件を満たす領域のうち `target` にいちばん近い点を返す。限界を越えて
 *   引っぱると隅は境界に沿って滑る（その場で引っかかって止まらない）
 * - 元の quad の遠近の強さがすでに上限を超えているなら、上限の代わりに「いまより強く
 *   しない」を条件にする。いまの位置が必ず条件を満たすので、触った隅が飛ばない
 *
 * 4 つの曲がりは動かす隅 P について 1 次式（反対側の隅の曲がりは定数）なので、
 * 「曲がり j >= 曲がり k / 上限」はどの組も P の半平面になる。条件を満たす領域はその
 * 共通部分（凸多角形）で、最近点は一意に決まる。曲がりがすべて同符号 = 凸であることも
 * この条件に含まれる。
 */
export function constrainQuadCorner(quad: Quad, corner: CornerKey, target: Point): Point {
  if (!isConvexQuad(quad)) return { x: target.x, y: target.y };

  const origin = quad[corner];
  const s = Math.sign(quadTurns(quad)[0]);
  // 向きを掛けた曲がり（凸なら 4 つとも正）を、P = origin + (dx, dy) の 1 次式
  // t_j = base[j] + gx[j]·dx + gy[j]·dy として求める
  const turnsAt = (dx: number, dy: number) =>
    quadTurns({ ...quad, [corner]: { x: origin.x + dx, y: origin.y + dy } }).map(t => s * t);
  const base = turnsAt(0, 0);
  const gx = turnsAt(1, 0).map((t, j) => t - base[j]);
  const gy = turnsAt(0, 1).map((t, j) => t - base[j]);

  const rho = Math.min(1 / MAX_PERSPECTIVE_RATIO, Math.min(...base) / Math.max(...base));

  // t_j - rho·t_k >= 0 を、すべての組 (j, k) について半平面にする
  const planes: HalfPlane[] = [];
  for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 4; k++) {
      if (j === k) continue;
      const ax = gx[j] - rho * gx[k];
      const ay = gy[j] - rho * gy[k];
      const len = Math.hypot(ax, ay);
      if (len < 1e-12) continue;
      const nx = ax / len;
      const ny = ay / len;
      const atOrigin = (base[j] - rho * base[k]) / len;
      planes.push({ nx, ny, c: nx * origin.x + ny * origin.y - atOrigin });
    }
  }

  const tol = 1e-6;
  const inside = (p: Point) => planes.every(h => h.nx * p.x + h.ny * p.y >= h.c - tol);
  if (inside(target)) return { x: target.x, y: target.y };

  // 最近点の候補: 各境界線への垂線の足と、境界線どうしの交点（凸領域の頂点）
  const candidates: Point[] = [];
  for (const h of planes) {
    const d = h.c - (h.nx * target.x + h.ny * target.y);
    candidates.push({ x: target.x + d * h.nx, y: target.y + d * h.ny });
  }
  for (let a = 0; a < planes.length; a++) {
    for (let b = a + 1; b < planes.length; b++) {
      const h1 = planes[a], h2 = planes[b];
      const det = cross(h1.nx, h1.ny, h2.nx, h2.ny);
      if (Math.abs(det) < 1e-12) continue;
      candidates.push({
        x: (h1.c * h2.ny - h2.c * h1.ny) / det,
        y: (h1.nx * h2.c - h2.nx * h1.c) / det,
      });
    }
  }

  let best: Point | null = null;
  let bestDist = Infinity;
  for (const p of candidates) {
    if (!inside(p)) continue;
    const dist = Math.hypot(p.x - target.x, p.y - target.y);
    if (dist < bestDist) { best = p; bestDist = dist; }
  }
  // 候補が数値誤差ですべて弾かれたら動かさない（いまの位置は必ず条件を満たす）
  return best ?? { x: origin.x, y: origin.y };
}

/**
 * 行優先の 3×3 射影行列。CSS / WebGL の column-major への変換は利用側で行う。
 * 最後の係数も保持する（逆行列では 0 になり得るため、1 に固定しない）。
 */
export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * 左上原点・y 下向きの単位矩形 (0,0)-(1,1) を仮想キャンバス px の quad へ写す。
 * DOM / 描画エンジン非依存。CSS 出力とプレビュー用 GPU 合成で同じ係数を使う。
 * 退化・非凸・非有限の quad は null（従来の CSS 出力でも非表示）。
 *
 * 単位矩形 → 任意四角形 への 2D ホモグラフィー（perspective 込み）を直接構築:
 *   x' = (a*u + b*v + c) / (g*u + h*v + 1)
 *   y' = (d*u + e*v + f) / (g*u + h*v + 1)
 * 8 個の係数を 4 隅の写像条件から閉形式で解く（Heckbert の公式）。
 */
export function quadHomography(quad: Quad): Homography | null {
  if (!quadVertices(quad).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  if (!isConvexQuad(quad)) return null;

  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad;

  const det = (p1.x - p2.x) * (p3.y - p2.y) - (p3.x - p2.x) * (p1.y - p2.y);
  if (Math.abs(det) < 1e-9) return null;

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

  const matrix: Homography = [a, b, c, d, e, f, g, h, 1];
  return matrix.every(Number.isFinite) ? matrix : null;
}

/** 逆変換。特異・非有限の行列は null。quad の内外判定や crop は行わない。 */
export function invertHomography(matrix: Homography): Homography | null {
  if (!matrix.every(Number.isFinite)) return null;
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (det === 0 || !Number.isFinite(det)) return null;
  const inverse: Homography = [
    A / det, B / det, C / det,
    D / det, E / det, F / det,
    G / det, H / det, I / det,
  ];
  return inverse.every(Number.isFinite) ? inverse : null;
}

/** 同次除算を含む点の変換。無限遠・非有限の結果は null。範囲外の点はクランプしない。 */
export function transformPoint(matrix: Homography, point: Point): Point | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const w = g * point.x + h * point.y + i;
  if (w === 0 || !Number.isFinite(w)) return null;
  const x = (a * point.x + b * point.y + c) / w;
  const y = (d * point.x + e * point.y + f) / w;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** 出力内 UV（左上原点・y 下向き）→ 仮想キャンバス px。pixelSize / 3D 位置とは独立。 */
export function outputUvToCanvas(output: OutputDef, uv: Point): Point {
  return {
    x: output.position.x + uv.x * output.size.width,
    y: output.position.y + uv.y * output.size.height,
  };
}

/**
 * quad 内 UV → 元映像 UV（いずれも左上原点）。applyVideoCrop と同じ最小寸法を使う。
 * 0..1 外は映像の無い領域。GPU 側では discard し、端の画素へクランプして引き伸ばさない。
 */
export function cropUvToSourceUv(source: SourceRect, uv: Point): Point {
  return {
    x: (source.x + uv.x * Math.max(source.width, MIN_DIMENSION)) / 100,
    y: (source.y + uv.y * Math.max(source.height, MIN_DIMENSION)) / 100,
  };
}

/** pixel 矩形を quad へ写す CSS 表現。既存の演算順と column-major の配置を維持する。 */
function homographyMatrix3d(quad: Quad, width: number, height: number): string {
  if (width <= 0 || height <= 0) return 'none';
  const matrix = quadHomography(quad);
  if (!matrix) return 'none';
  const [a, b, c, d, e, f, g, h] = matrix;

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
 * container（CSS で canvas.width × canvas.height の px サイズに配置・
 * transform-origin: top left）の矩形を、quad（仮想キャンバス px 座標）の四角形に
 * 写像する matrix3d を適用する。container 自身のサイズは canvasWidth × canvasHeight
 * の CSS px と一致している前提（親の transform: scale() で実画面サイズに縮拡される）。
 *
 * 使われる場所:
 *  - OutputWindow: .dc-out-mapping
 *  - ControlWindow: #cropped-container / .preview-mapping.inactive
 *  （いずれも親が `.dc-canvas-window` or `#dc-output-canvas` で canvas px サイズ）
 */
export function applyQuadCanvas(
  container: HTMLElement,
  quad: Quad,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (canvasWidth <= 0 || canvasHeight <= 0) return;
  const transform = homographyMatrix3d(quad, canvasWidth, canvasHeight);
  if (transform === 'none') {
    // 退化 quad（共線・面積0）または凸でない quad。transform: none をそのまま適用すると
    // 未変形のフルキャンバス寸法の映像が出力に表示されてしまうので非表示にする。
    // 凸でない quad は正しく写像できず、描くと映像が quad の外側へ反転する（#95）。
    // 編集操作では constrainQuadCorner が凸を保つので、ここに来るのは古い設定ファイル由来だけ。
    container.style.visibility = 'hidden';
    return;
  }
  container.style.visibility = '';
  container.style.transform = transform;
}
