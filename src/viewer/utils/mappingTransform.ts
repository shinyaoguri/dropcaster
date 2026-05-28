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
 *  - canvas: 仮想キャンバスのサイズ（px）。全 output と全 quad を包含する座標空間。
 *    outputs を追加・移動するたびに recomputeCanvasBounds で再計算される。
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
 * 出力を 1 件削除。最後の 1 件なら no-op。
 * mapping は output と独立した存在なので、出力を消しても mapping は仮想キャンバス上に
 * そのまま残る（quad の位置によっては他の出力に映る、またはどこにも映らない状態になる）。
 * activeOutputId がその出力を指していたら undefined に戻す。
 */
export function withRemovedOutput(state: MappingsState, outputId: string): MappingsState {
  if (state.outputs.length <= 1) return state;
  const remaining = state.outputs.filter(o => o.id !== outputId);
  if (remaining.length === state.outputs.length) return state; // 該当なし
  return {
    ...state,
    outputs: remaining,
    canvas: recomputeCanvasBounds(remaining),
    activeOutputId: state.activeOutputId === outputId ? undefined : state.activeOutputId,
  };
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
  container.style.transform = homographyMatrix3d(quad, canvasWidth, canvasHeight);
}
