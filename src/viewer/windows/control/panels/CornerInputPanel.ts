/**
 * ツール列の「マッピング設定」— active mapping の四隅 (x, y) を数値で表示・入力する panel (#192)。
 *
 * テンプレに既にある DOM を wire するだけで自前 DOM は持たない:
 *   - #mapping-{tl,tr,bl,br}-{x,y}-input — 8 つの <input type="number">（data-quad-corner / data-quad-axis 付き。隅のハンドルの data-corner とは分ける）
 *   - #mapping-corner-error              — 採用しなかった理由を出す <p role="alert">
 *
 * 入力欄の change / Enter / Escape は OutputSettingsPanel と同じ約束 (#113):
 *   - change（blur 含む）: 隅を置く。ドラッグ・矢印キーと同じ条件 (placeQuadCorner = constrainQuadCorner。
 *     ADR 0007) を破る値・数値でない値は採用せず、欄を確定済みの値へ戻して理由を出す
 *   - Enter: blur を発火させて change を経由
 *   - Escape: 確定済みの値に戻して blur（その blur の change は commit しない = 取消）
 * 確定は Undo / Redo の 1 件になる (setActiveQuad + commit。矢印キーの連続入力の途中なら先に閉じる)。
 *
 * 表示は refresh() で更新する。ControlWindow の updateToolValues から呼ばれるので、ドラッグ・矢印キー・
 * Undo / Redo・選択の切替に追従する。focus 中の欄は上書きしない（タイプ中の値を消さない）。
 * active が mask（または mapping が無い）ときは欄を空にして無効にする。
 */

import { t, type MessageKey } from '../../../i18n/index.js';
import { getActiveMapping, placeQuadCorner, type CornerKey, type QuadCornerRejection } from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

export interface CornerInputPanelAttachOptions {
  /** 確定の直前。矢印キーの連続入力の途中なら、そこまでを別の 1 件として閉じる。 */
  onBeforeCommit: () => void;
  /** 隅を置いた直後の後処理（matrix3d・ハンドル・非 active preview・ツール値の更新）。 */
  onQuadCommitted: () => void;
}

type Axis = 'x' | 'y';

/** 欄の表示形式。読み取り専用の表示だった頃 (#192 以前) と同じ小数 1 桁。 */
const format = (v: number) => v.toFixed(1);

export class CornerInputPanel {
  private scope: HTMLElement | null = null;
  private ctrl: MappingsController | null = null;
  private opts: CornerInputPanelAttachOptions | null = null;
  /** Escape の取消で blur している間。その blur で飛ぶ change を commit させない。 */
  private cancelling = false;
  /** 理由を出している対象の mapping。選択が変わったら理由を消す。 */
  private errorFor: string | null = null;

  attach(scope: HTMLElement, ctrl: MappingsController, opts: CornerInputPanelAttachOptions): void {
    this.scope = scope;
    this.ctrl = ctrl;
    this.opts = opts;
    for (const input of this.inputs()) this.bind(input);
    this.refresh();
  }

  /** active mapping の四隅を欄へ書き戻す。focus 中の欄はスキップ。 */
  refresh(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    if (!scope || !ctrl) return;
    const state = ctrl.getState();
    const mapping = getActiveMapping(state);
    if (this.errorFor !== null && this.errorFor !== (mapping?.id ?? null)) this.showError(null);
    const activeEl = scope.ownerDocument?.activeElement;
    for (const input of this.inputs()) {
      if (!mapping) {
        input.disabled = true;
        input.value = '';
        continue;
      }
      input.disabled = false;
      if (input === activeEl) continue;
      const { corner, axis } = this.fieldOf(input);
      input.value = format(mapping.quad[corner][axis]);
    }
  }

  destroy(): void {
    // listener は <input> 要素に直接付いており、scope ごと置換で消えるため明示的な off は不要。
    this.scope = null;
    this.ctrl = null;
    this.opts = null;
    this.errorFor = null;
  }

  // ── internals ───────────────────────────────────────────────

  private inputs(): HTMLInputElement[] {
    return Array.from(this.scope?.querySelectorAll<HTMLInputElement>('input.corner-input[data-quad-corner][data-quad-axis]') ?? []);
  }

  private fieldOf(input: HTMLInputElement): { corner: CornerKey; axis: Axis } {
    return { corner: input.dataset.quadCorner as CornerKey, axis: input.dataset.quadAxis as Axis };
  }

  private bind(input: HTMLInputElement): void {
    input.addEventListener('change', () => this.commit(input));
    // 書き直し始めたら前の理由は消す（欄の赤枠も）
    input.addEventListener('input', () => { if (this.errorFor !== null) this.showError(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancel(input); }
    });
  }

  /**
   * 編集を取り消す。refresh() は focus 中の欄を書き換えないので、確定済みの値をこの欄へ明示的に
   * 書き戻してから blur する。blur で change が飛ぶ実装でも commit させない（取消で履歴を積まない）。
   */
  private cancel(input: HTMLInputElement): void {
    this.showError(null);
    const value = this.committedValue(input);
    if (value !== undefined) input.value = value;
    this.cancelling = true;
    try { input.blur(); } finally { this.cancelling = false; }
  }

  /** 対象の隅の確定済みの値（欄の表示形式）。active mapping が無ければ undefined。 */
  private committedValue(input: HTMLInputElement): string | undefined {
    const mapping = this.ctrl ? getActiveMapping(this.ctrl.getState()) : undefined;
    if (!mapping) return undefined;
    const { corner, axis } = this.fieldOf(input);
    return format(mapping.quad[corner][axis]);
  }

  private commit(input: HTMLInputElement): void {
    if (this.cancelling) return;
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!ctrl || !opts) return;
    const mapping = getActiveMapping(ctrl.getState());
    if (!mapping) return;
    const { corner, axis } = this.fieldOf(input);
    // type="number" は数値として読めない入力を '' にする。'' も数値でないものとして扱う
    const raw = input.value.trim() === '' ? Number.NaN : Number(input.value);
    const current = mapping.quad[corner];
    const target = axis === 'x' ? { x: raw, y: current.y } : { x: current.x, y: raw };
    const placed = placeQuadCorner(mapping.quad, corner, target);
    if (!placed.ok) {
      const value = this.committedValue(input);
      if (value !== undefined) input.value = value;
      this.showError(mapping.id, input, this.rejectionMessage(placed.reason, corner, axis, target, placed.nearest));
      return;
    }
    this.showError(null);
    opts.onBeforeCommit();
    ctrl.setActiveQuad(placed.quad);
    ctrl.commit();
    opts.onQuadCommitted();
  }

  private rejectionMessage(
    reason: QuadCornerRejection, corner: CornerKey, axis: Axis,
    target: { x: number; y: number }, nearest: { x: number; y: number },
  ): string {
    const name = t(`control.mappingSettings.corner.${corner}` as MessageKey);
    if (reason === 'notNumber') return t('control.mappingSettings.reject.notNumber', { corner: name, axis });
    const key = reason === 'notConvex' ? 'control.mappingSettings.reject.notConvex' : 'control.mappingSettings.reject.tooSteep';
    return t(key, { corner: name, x: format(target.x), y: format(target.y), nx: format(nearest.x), ny: format(nearest.y) });
  }

  /** 理由を出す（mappingId = null で消す）。採用しなかった欄に aria-invalid を付ける。 */
  private showError(mappingId: string | null, input?: HTMLInputElement, message = ''): void {
    const box = this.scope?.querySelector<HTMLElement>('#mapping-corner-error');
    for (const el of this.inputs()) el.removeAttribute('aria-invalid');
    this.errorFor = mappingId;
    if (!box) return;
    if (mappingId === null) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    input?.setAttribute('aria-invalid', 'true');
    box.textContent = message;
    box.hidden = false;
  }
}
