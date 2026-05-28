/**
 * canonical state (MappingsState) の所有者。
 *
 * 設計方針:
 *   - active mapping の source / quad は同一参照（alias）を保持する。panel は
 *     `mutateActiveSource(fn => { fn.x = ... })` のように in-place で書き換える。
 *   - drag / nudge / resize 等の連続的な in-place mutation は onChange を発火しない
 *     （panel 側が個別に必要な部分だけ refresh する）。commit() で親へ broadcast する。
 *   - 「add / delete / activate / rename / import / reset」のように state そのものを
 *     差し替える操作は replaceState() で行う。これは onChange を発火するので、
 *     購読側（ControlWindow）が UI 全体を一括再描画する。
 *   - 親（WindowController）から push された state は applyExternal() で取り込む。
 *     onChange は発火するが commit はしない（自分が起点ではないので echo back させない）。
 *
 * 旧 ControlWindow にあった state / sourceSelectionData / quadData フィールドと
 * rebindActiveAliases / setActive{Source,Quad} / replaceState / handleStateUpdate /
 * broadcastStateMutation の責務を Step 9 でここに集約した。
 */

import {
  defaultMappingsState,
  getActiveMapping,
  getActiveMask,
  recomputeCanvasBounds,
  withMaskPointsSet,
  type Point,
  type Quad,
  type SourceRect,
  type MappingsState,
} from '../../utils/mappingTransform';

export type StateChangeListener = (state: MappingsState) => void;
export type Unsubscribe = () => void;

export class MappingsController {
  private state: MappingsState = defaultMappingsState();
  private listeners = new Set<StateChangeListener>();
  private commitFn: (state: MappingsState) => void;

  /** @param commit ローカル mutation 後に親へ broadcast するためのコールバック。 */
  constructor(commit: (state: MappingsState) => void) {
    this.commitFn = commit;
  }

  // ── read accessors ─────────────────────────────────────────────

  getState(): MappingsState { return this.state; }
  /**
   * active item が mapping のときの source。active item が mask のときは「空の matrix3d」になる
   * フォールバック値（0,0,100,100）を返す。呼び出し側は基本的に MappingArea 系の panel で
   * mask 中は非表示のため、フォールバック値は描画に使われない想定。
   */
  getActiveSource(): SourceRect {
    return getActiveMapping(this.state)?.source ?? { x: 0, y: 0, width: 100, height: 100 };
  }
  /**
   * active item が mapping のときの quad。mask 時はフォールバック quad（原点周辺の単位矩形）。
   * mask 時は MappingAreaPanel が非表示／pointer-events:none で隠れるため、この値は描画に使われない。
   */
  getActiveQuad(): Quad {
    return getActiveMapping(this.state)?.quad ?? {
      topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
      bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
    };
  }
  /** active item が mask のときの頂点配列。mapping 時は undefined。 */
  getActiveMaskPoints(): Point[] | undefined {
    return getActiveMask(this.state)?.points;
  }

  // ── in-place mutation（drag/resize/nudge 用 — onChange は発火しない）──

  /** active source の中身を fn で in-place 書き換え（alias 参照は維持、mask 時は no-op）。 */
  mutateActiveSource(fn: (source: SourceRect) => void): void {
    const m = getActiveMapping(this.state);
    if (m) fn(m.source);
  }

  /** active source をまるごと差し替える（mask 時は no-op）。 */
  setActiveSource(source: SourceRect): void {
    const m = getActiveMapping(this.state);
    if (m) m.source = source;
  }

  /** active quad をまるごと差し替える（mask 時は no-op）。 */
  setActiveQuad(quad: Quad): void {
    const m = getActiveMapping(this.state);
    if (m) m.quad = quad;
  }

  /**
   * active mask の頂点列を差し替える（mapping 時は no-op）。
   * 連続 drag では mask の points を直接 in-place 書き換えるが、明示置換が必要な操作（vertex 追加 /
   * 削除）はこの API を経由して新しい配列を作る。
   */
  setActiveMaskPoints(points: Point[]): void {
    const k = getActiveMask(this.state);
    if (!k) return;
    this.state = withMaskPointsSet(this.state, k.id, points);
  }

  /**
   * active mask の頂点を in-place 書き換える（drag 連続中の最適化用、onChange は発火しない）。
   * fn は配列を直接書き換える（push/splice/index 更新 OK）。mapping 時は no-op。
   */
  mutateActiveMaskPoints(fn: (points: Point[]) => void): void {
    const k = getActiveMask(this.state);
    if (k) fn(k.points);
  }

  /**
   * 指定 output の position / size を in-place 書き換える（onChange は発火しない）。
   * LayoutPanel の drag/resize 中に毎フレーム呼ぶ用。最終位置は commit() で親へ伝搬される。
   * position は (0,0) 以上に、size は 1 以上にクランプする（withOutputLayoutSet と同じ）。
   *
   * **canvas dim は recompute しない**。drag 中に canvas dim が伸び縮みすると、
   *   - LayoutPanel の fitScale が毎フレーム変わって他出力が連動して縮む
   *   - canvasWindow / preview の matrix3d 分母が毎フレーム変わって preview が揺れる
   *   - OutputWindow の canvasEl が再リサイズされる
   * のように複数箇所がフラッシュする。canvas dim は quad の絶対座標から見た「matrix3d の
   * 分母」でしかなく、更新しなくても描画は正しい（quad は絶対 px なので任意の dim で
   * 表現できる）。recompute は drag 終了時に commitOutputLayoutBounds() で行う。
   */
  mutateOutputLayout(
    outputId: string,
    patch: { position?: { x: number; y: number }; size?: { width: number; height: number } },
  ): void {
    const out = this.state.outputs.find(o => o.id === outputId);
    if (!out) return;
    if (patch.position) {
      out.position.x = Math.max(0, patch.position.x);
      out.position.y = Math.max(0, patch.position.y);
    }
    if (patch.size) {
      out.size.width = Math.max(1, patch.size.width);
      out.size.height = Math.max(1, patch.size.height);
    }
  }

  /**
   * drag 終了時に canvas dim を outputs から再計算して state に反映する。
   * mutateOutputLayout を一連使った後に 1 回だけ呼ぶ想定。
   */
  commitOutputLayoutBounds(): void {
    this.state.canvas = recomputeCanvasBounds(this.state.outputs);
  }

  // ── full state replacement（onChange を発火する）─────────────────

  /**
   * state を新しいオブジェクトに置き換え、listener へ通知 + 親へ commit。
   * mapping 追加 / 削除 / active 切替 / rename / import 等で使う。
   */
  replaceState(next: MappingsState): void {
    if (!isValidState(next)) return;
    this.state = next;
    this.fireChange();
    this.commit();
  }

  /**
   * 親（WindowController）から push された state を反映。listener には通知するが
   * commit はしない（こちら起点ではないので echo back させない）。
   */
  applyExternal(next: MappingsState): void {
    if (!isValidState(next)) return;
    this.state = next;
    this.fireChange();
  }

  // ── notification / commit ─────────────────────────────────────

  /** ローカル alias mutation を親へ通知（drag/nudge は自前で呼ぶ）。 */
  commit(): void {
    this.commitFn(this.state);
  }

  /** state が「丸ごと差し替わった」時の通知を購読する（in-place mutation では発火しない）。 */
  onChange(listener: StateChangeListener): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private fireChange(): void {
    for (const l of this.listeners) {
      try { l(this.state); } catch (error) {
        console.error('MappingsController: listener エラー', error);
      }
    }
  }
}

function isValidState(state: MappingsState | null | undefined): state is MappingsState {
  return !!state && Array.isArray(state.mappings) && state.mappings.length > 0;
}
