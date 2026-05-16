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
 * outputId は所属する出力（OutputDef）の id を指す。quad の座標は当該出力フレームの
 * 0..100% で表現される（出力ごとに別の解像度・配置を持っても座標系は共通）。
 */
export interface MappingEntry {
  id: string;
  outputId: string;
  name?: string;
  enabled?: boolean;
  source: SourceRect;
  quad: Quad;
}

export function isMappingEnabled(m: MappingEntry): boolean {
  return m.enabled !== false;
}

/**
 * 投影先の出力ウィンドウ／プロジェクタ1台ぶんの定義。
 *
 *  - layout: コントロール上で複数出力を同時に並べて見せるための「ステージ座標」。
 *    実ピクセル相当（典型的には `getScreenDetails()` の screens[].left/top/width/height
 *    をそのまま流せる）。コントロール側では transform: scale() で縮小表示される。
 *  - screen: 出力ウィンドウを送り込みたい物理スクリーン情報（任意）。
 *    placeOnExternalScreen が利用する。
 *  - pixelSize: 実出力ウィンドウのバッキングストア相当解像度（任意。未指定時は layout の
 *    width/height を流用）。
 */
export interface OutputDef {
  id: string;
  name?: string;
  layout: { x: number; y: number; width: number; height: number };
  screen?: { left: number; top: number; width: number; height: number; label?: string };
  pixelSize?: { width: number; height: number };
}

/**
 * マッピング機能全体の正規状態。
 *
 *  - outputs は1件以上。複数の出力ウィンドウを同時に扱う場合は最大4件まで（UI 制約）。
 *  - 各 mapping は outputId で出力フレームに割り当てられ、quad はその出力フレームの
 *    0..100% で記述される。
 *  - mappings は1件以上、activeId は常に mappings 中のいずれかを指す。
 *  - activeOutputId は「出力フレーム自体を選択中」の状態（layout 編集用、未選択なら undefined）。
 *
 * WindowController が単一の canonical 保持者で、ControlWindow / SketchPageView は
 * これの mirror をレンダリングするだけ。
 */
export interface MappingsState {
  outputs: OutputDef[];
  mappings: MappingEntry[];
  activeId: string;
  activeOutputId?: string;
}

let _idCounter = 0;
export function generateMappingId(): string {
  _idCounter += 1;
  return `m${Date.now().toString(36)}_${_idCounter}`;
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
 * 既定の出力1件を生成する。layout は原点に配置（複数並べる場合は呼び出し側で
 * 適切にオフセットする — 未配置レイアウト計算は本ファイルの責務外）。
 */
export function defaultOutput(name?: string): OutputDef {
  return {
    id: generateOutputId(),
    name,
    layout: { x: 0, y: 0, width: DEFAULT_OUTPUT_WIDTH, height: DEFAULT_OUTPUT_HEIGHT },
  };
}

export function defaultMappingsState(): MappingsState {
  const out = defaultOutput('Output 1');
  const e: MappingEntry = {
    id: generateMappingId(),
    outputId: out.id,
    name: 'Mapping 1',
    source: { x: 0, y: 0, width: 100, height: 100 },
    quad: defaultQuad(),
  };
  return { outputs: [out], mappings: [e], activeId: e.id };
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

/**
 * 新しい mapping を追加して active にする。可視性のため少しずらした quad で生成。
 * 割り当て先は activeOutputId（あれば）→ outputs[0] の順で決まる。
 */
export function withAddedMapping(state: MappingsState): MappingsState {
  const offset = (state.mappings.length * 4) % 30; // 4% 刻みで重ならないよう少しずらす
  const id = generateMappingId();
  const outputId =
    (state.activeOutputId && state.outputs.some(o => o.id === state.activeOutputId))
      ? state.activeOutputId
      : state.outputs[0].id;
  const entry: MappingEntry = {
    id,
    outputId,
    name: `Mapping ${state.mappings.length + 1}`,
    source: { x: 0, y: 0, width: 100, height: 100 },
    quad: {
      topLeft:     { x: 25 + offset, y: 25 + offset },
      topRight:    { x: 75 + offset, y: 25 + offset },
      bottomRight: { x: 75 + offset, y: 75 + offset },
      bottomLeft:  { x: 25 + offset, y: 75 + offset },
    },
  };
  return { ...state, mappings: [...state.mappings, entry], activeId: id };
}

/** 指定 id を削除（最後の1個は残す）。active が消えたら先頭を active に。 */
export function withRemovedMapping(state: MappingsState, id: string): MappingsState {
  if (state.mappings.length <= 1) return state;
  const filtered = state.mappings.filter(m => m.id !== id);
  const activeId = id === state.activeId ? filtered[0].id : state.activeId;
  return { ...state, mappings: filtered, activeId };
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

/** mapping の所属出力を変更する。outputId が無効なら no-op。 */
export function withMappingReassigned(state: MappingsState, id: string, outputId: string): MappingsState {
  if (!state.outputs.some(o => o.id === outputId)) return state;
  return {
    ...state,
    mappings: state.mappings.map(m =>
      m.id === id ? { ...m, outputId } : m
    ),
  };
}

/**
 * 出力を 1 件追加して activeOutputId に。MAX_OUTPUTS 到達時は no-op。
 * layout は他出力の右側に水平に並べる。
 */
export function withAddedOutput(state: MappingsState): MappingsState {
  if (state.outputs.length >= MAX_OUTPUTS) return state;
  const rightmost = state.outputs.reduce(
    (acc, o) => Math.max(acc, o.layout.x + o.layout.width),
    0,
  );
  const newOut: OutputDef = {
    id: generateOutputId(),
    name: `Output ${state.outputs.length + 1}`,
    layout: { x: rightmost, y: 0, width: DEFAULT_OUTPUT_WIDTH, height: DEFAULT_OUTPUT_HEIGHT },
  };
  return { ...state, outputs: [...state.outputs, newOut], activeOutputId: newOut.id };
}

/**
 * 出力を 1 件削除。最後の 1 件なら no-op。所属 mapping は残りの先頭出力へ再割当する
 * （mapping そのものは消えない — ユーザが明示的に消すべき）。
 * activeOutputId がその出力を指していたら undefined に戻す。
 */
export function withRemovedOutput(state: MappingsState, outputId: string): MappingsState {
  if (state.outputs.length <= 1) return state;
  const remaining = state.outputs.filter(o => o.id !== outputId);
  if (remaining.length === state.outputs.length) return state; // 該当なし
  const fallbackId = remaining[0].id;
  return {
    ...state,
    outputs: remaining,
    mappings: state.mappings.map(m =>
      m.outputId === outputId ? { ...m, outputId: fallbackId } : m
    ),
    activeOutputId: state.activeOutputId === outputId ? undefined : state.activeOutputId,
  };
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
 * 任意の値が MappingsState として妥当かチェックして返す（不正なら null）。
 * 保存ファイルや localStorage の読み込み時に使う。
 *
 * 旧フォーマット互換: outputs フィールドが無い／空／不正な場合は既定の単一出力を
 * 生成し、outputId を持たない mapping にはそれを割り当てる（旧データはこの分岐を通る）。
 */
export function parseMappingsState(data: unknown): MappingsState | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const list = obj.mappings;
  if (!Array.isArray(list) || list.length === 0) return null;

  const isPoint = (p: unknown): p is Point =>
    !!p && typeof (p as Point).x === 'number' && typeof (p as Point).y === 'number';

  // --- outputs を解析（不正な要素は捨て、0 件になったら既定を1つ生やす） ---
  const validOutputs: OutputDef[] = [];
  const rawOutputs = obj.outputs;
  if (Array.isArray(rawOutputs)) {
    for (const rawOut of rawOutputs) {
      if (!rawOut || typeof rawOut !== 'object') continue;
      const o = rawOut as Record<string, unknown>;
      if (typeof o.id !== 'string') continue;
      const layout = o.layout as Record<string, unknown> | undefined;
      if (
        !layout ||
        typeof layout.x !== 'number' ||
        typeof layout.y !== 'number' ||
        typeof layout.width !== 'number' ||
        typeof layout.height !== 'number'
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
        layout: {
          x: layout.x,
          y: layout.y,
          width: layout.width,
          height: layout.height,
        },
        screen,
        pixelSize,
      });
    }
  }
  if (validOutputs.length === 0) {
    validOutputs.push(defaultOutput('Output 1'));
  }
  const defaultOutputId = validOutputs[0].id;
  const outputIdSet = new Set(validOutputs.map(o => o.id));

  // --- mappings を解析（outputId が無い／無効なら defaultOutputId を割り当て） ---
  const validMappings: MappingEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== 'string') return null;
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
    const rawOutputId = typeof m.outputId === 'string' ? m.outputId : null;
    const outputId =
      rawOutputId && outputIdSet.has(rawOutputId) ? rawOutputId : defaultOutputId;
    validMappings.push({
      id: m.id,
      outputId,
      name: typeof m.name === 'string' ? m.name : undefined,
      enabled: typeof m.enabled === 'boolean' ? m.enabled : undefined,
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

  return { outputs: validOutputs, mappings: validMappings, activeId, activeOutputId };
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

export function defaultQuad(): Quad {
  return {
    topLeft:     { x: 25, y: 25 },
    topRight:    { x: 75, y: 25 },
    bottomRight: { x: 75, y: 75 },
    bottomLeft:  { x: 25, y: 75 },
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
 * container（親要素 100% × 100% に配置・transform-origin: top left）の単位矩形を
 * quadPercent（親の % 座標）の四角形に写像する matrix3d を適用する。
 * 配置系のスタイル（position/inset/width/height/transform-origin）は呼び出し側 CSS が持つ前提:
 *  - ControlWindow: #cropped-container / .preview-mapping.inactive
 *  - OutputWindow: .dc-out-mapping
 * （毎フレーム同じ値を書き直すとレイアウトを汚すので transform だけ更新する）
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

  container.style.transform = homographyMatrix3d(pxQuad, W, H);
}
