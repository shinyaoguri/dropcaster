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
 *   - Undo / Redo の履歴 (EditHistory) もここで持つ。commit() のたびに確定済みの状態と比べて
 *     積むので、panel は連続操作の前後を beginGesture() / endGesture() で囲むだけでよい
 *     (draggable は第 4 引数にこの controller を渡すと自動で囲む)。
 *
 * 旧 ControlWindow にあった state / sourceSelectionData / quadData フィールドと
 * rebindActiveAliases / setActive{Source,Quad} / replaceState / handleStateUpdate /
 * broadcastStateMutation の責務を Step 9 でここに集約した。
 */

import {
  EditHistory,
  cloneMappingsState,
  hasNoDraftingMask,
  mappingsHistoryKey,
} from '../../utils/editHistory';
import {
  defaultMappingsState,
  getActiveItem,
  getActiveMapping,
  getActiveMask,
  isLocked,
  recomputeCanvasBounds,
  withMaskPointsSet,
  type Point,
  type Quad,
  type SourceRect,
  type MappingsState,
} from '../../utils/mappingTransform';

export type StateChangeListener = (state: MappingsState) => void;
export type HistoryChangeListener = (status: HistoryStatus) => void;
export type Unsubscribe = () => void;
export interface HistoryStatus { canUndo: boolean; canRedo: boolean }

export class MappingsController {
  private state: MappingsState = defaultMappingsState();
  private listeners = new Set<StateChangeListener>();
  private historyListeners = new Set<HistoryChangeListener>();
  private history = new EditHistory<MappingsState>(this.state, {
    clone: cloneMappingsState,
    key: mappingsHistoryKey,
    isSettled: hasNoDraftingMask,
  });
  private lastHistoryStatus: HistoryStatus | null = null;
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

  // ── 編集ロック (#190) ─────────────────────────────────────────
  // panel と下の in-place mutation はすべてこの 2 つで「幾何を編集してよいか」を判定する。
  // #121 の本番モード (全体を一時的にロックし、保存しない) は、ここに足せば全経路に効く。

  /** 面・マスク (省略時は active item) がロック中か。ロック中は幾何の編集・リセット・削除を受け付けない。 */
  isItemLocked(id?: string): boolean {
    const item = id === undefined ? getActiveItem(this.state) : this.state.mappings.find(m => m.id === id);
    return isLocked(item);
  }

  /** 出力がロック中か。ロック中は position / size の編集と削除を受け付けない。 */
  isOutputLocked(outputId: string): boolean {
    return isLocked(this.state.outputs.find(o => o.id === outputId));
  }

  // ── in-place mutation（drag/resize/nudge 用 — onChange は発火しない）──

  // ロック中の項目・出力 (#190) に対しては、以下の mutation はすべて何もしない。

  /** active source の中身を fn で in-place 書き換え（alias 参照は維持、mask 時は no-op）。 */
  mutateActiveSource(fn: (source: SourceRect) => void): void {
    const m = getActiveMapping(this.state);
    if (m && !this.isItemLocked(m.id)) fn(m.source);
  }

  /** active source をまるごと差し替える（mask 時は no-op）。 */
  setActiveSource(source: SourceRect): void {
    const m = getActiveMapping(this.state);
    if (m && !this.isItemLocked(m.id)) m.source = source;
  }

  /** active quad をまるごと差し替える（mask 時は no-op）。 */
  setActiveQuad(quad: Quad): void {
    const m = getActiveMapping(this.state);
    if (m && !this.isItemLocked(m.id)) m.quad = quad;
  }

  /**
   * active mask の頂点列を差し替える（mapping 時は no-op）。
   * 連続 drag では mask の points を直接 in-place 書き換えるが、明示置換が必要な操作（vertex 追加 /
   * 削除）はこの API を経由して新しい配列を作る。
   */
  setActiveMaskPoints(points: Point[]): void {
    const k = getActiveMask(this.state);
    if (!k || this.isItemLocked(k.id)) return;
    this.state = withMaskPointsSet(this.state, k.id, points);
  }

  /**
   * active mask の頂点を in-place 書き換える（drag 連続中の最適化用、onChange は発火しない）。
   * fn は配列を直接書き換える（push/splice/index 更新 OK）。mapping 時は no-op。
   */
  mutateActiveMaskPoints(fn: (points: Point[]) => void): void {
    const k = getActiveMask(this.state);
    if (k && !this.isItemLocked(k.id)) fn(k.points);
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
    if (!out || this.isOutputLocked(outputId)) return;
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
    // 外から来た状態 (初期同期・プロジェクト読み込み) は別の編集の続きではないので履歴を空にする。
    this.history.reset(next);
    this.fireChange();
    this.fireHistoryChange();
  }

  // ── notification / commit ─────────────────────────────────────

  /** ローカル alias mutation を親へ通知（drag/nudge は自前で呼ぶ）。 */
  commit(): void {
    this.commitFn(this.state);
    this.history.settle(this.state);
    // ペン描画の開始・終了でも Undo の可否が変わるので、積んだかどうかに関わらず確かめる。
    this.fireHistoryChange();
  }

  // ── Undo / Redo ───────────────────────────────────────────────

  /** 連続操作 (ドラッグ・矢印キー) の開始。endGesture までの commit は履歴 1 件にまとまる。 */
  beginGesture(): void {
    this.history.beginGesture();
    this.fireHistoryChange();
  }

  /** 連続操作の終了。最も外側が閉じたら、開始前との差分を 1 件積む。 */
  endGesture(): void {
    this.history.endGesture(this.state);
    this.fireHistoryChange();
  }

  /**
   * ボタンの有効・無効。ペン描画中は無効にする。ジェスチャ中 (ドラッグ・矢印キー) は
   * 無効にしない — 矢印キーの連続入力は呼び出し側が終わらせてから undo() を呼ぶ。
   */
  getHistoryStatus(): HistoryStatus {
    const busy = !hasNoDraftingMask(this.state);
    return { canUndo: !busy && this.history.canUndo, canRedo: !busy && this.history.canRedo };
  }

  /** 1 件戻す。戻せたら true。ジェスチャ中・ペン描画中は何もしない。 */
  undo(): boolean {
    return this.restore(this.history.undo(this.state));
  }

  /** 1 件やり直す。やり直せたら true。ジェスチャ中・ペン描画中は何もしない。 */
  redo(): boolean {
    return this.restore(this.history.redo(this.state));
  }

  /** Undo / Redo ボタンの有効・無効を追うための購読。 */
  onHistoryChange(listener: HistoryChangeListener): Unsubscribe {
    this.historyListeners.add(listener);
    return () => { this.historyListeners.delete(listener); };
  }

  private restore(next: MappingsState | null): boolean {
    if (!next) return false;
    // 通常の確定と同じ経路 (panel 再描画・出力窓・保存) で反映する。
    // 履歴側の基準は戻した状態になっているので、ここでの commit は新しい履歴を作らない。
    this.replaceState(next);
    this.fireHistoryChange();
    return true;
  }

  /** 状態が前回の通知から変わったときだけ通知する (ドラッグ中の毎フレームの commit から呼ばれるため)。 */
  private fireHistoryChange(): void {
    const status = this.getHistoryStatus();
    const last = this.lastHistoryStatus;
    if (last && last.canUndo === status.canUndo && last.canRedo === status.canRedo) return;
    this.lastHistoryStatus = status;
    for (const l of this.historyListeners) {
      try { l(status); } catch (error) {
        console.error('MappingsController: history listener エラー', error);
      }
    }
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
