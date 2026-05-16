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
  recomputeCanvasBounds,
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
  getActiveSource(): SourceRect { return getActiveMapping(this.state).source; }
  getActiveQuad(): Quad { return getActiveMapping(this.state).quad; }

  // ── in-place mutation（drag/resize/nudge 用 — onChange は発火しない）──

  /** active source の中身を fn で in-place 書き換え（alias 参照は維持）。 */
  mutateActiveSource(fn: (source: SourceRect) => void): void {
    fn(this.getActiveSource());
  }

  /** active source をまるごと差し替える（reset / 初期全選択など）。 */
  setActiveSource(source: SourceRect): void {
    getActiveMapping(this.state).source = source;
  }

  /** active quad をまるごと差し替える。 */
  setActiveQuad(quad: Quad): void {
    getActiveMapping(this.state).quad = quad;
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
