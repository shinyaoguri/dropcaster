/**
 * 矢印キー（+ Shift で 10px）で active mapping の source 矩形 or quad の隅を微調整する panel。
 *
 * 選択状態（どの quad の隅か / source 全体か）はこの panel が保持する。drag ハンドラ側は
 * mousedown 時に setSelection() / clearSelection() を呼んで状態を更新する（クロス panel API）。
 *
 * Undo の履歴では、同じ対象への矢印キーの連続入力 (長押しのリピート・小刻みな連打) を 1 件にまとめる。
 * 最初の keydown で beginGesture し、矢印キーを離して NUDGE_IDLE_MS のあいだ次の入力が無いとき、
 * または選択の変更・ウィンドウの blur・endNudge() の呼び出し (Undo の直前) で endGesture する。
 */

import { constrainQuadCorner, type CornerKey } from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

export type NudgeSelection =
  | { type: 'quad'; corner: CornerKey }
  | { type: 'source' }
  | null;

export interface KeyboardNudgeAttachOptions {
  /**
   * quad のステップ係数。「出力ウィンドウ上の 1 screen-px が仮想キャンバスの何 px に
   * 相当するか」を x/y 別に返す。具体的には `out.size.width / out.bounds.innerWidth` の値。
   * 出力未起動時は out.size / out.size = 1（= 1 canvas-px ステップ）にフォールバック。
   */
  getQuadStepPerScreenPx: () => { x: number; y: number };
  getSourceRefSize: () => { width: number; height: number };
  getSelectionBox: () => HTMLDivElement | null;
  /** mutation 直後に呼ぶ後処理（updateQuadTransform / updateAfterSourceChange + updateToolValues 等）。 */
  onAfterMutate: (type: 'quad' | 'source') => void;
}

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
/** 矢印キーを離してから、連続入力が終わったとみなすまでの時間。 */
export const NUDGE_IDLE_MS = 800;

export class KeyboardNudge {
  private scope: HTMLElement | null = null;
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: KeyboardNudgeAttachOptions | null = null;
  private selection: NudgeSelection = null;
  private boundHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;
  /** 矢印キーの連続入力を Undo の 1 件として囲んでいる最中か。 */
  private nudging = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  attach(scope: HTMLElement, doc: Document, ctrl: MappingsController, opts: KeyboardNudgeAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;
    this.boundHandler = (e: KeyboardEvent) => this.handleKey(e);
    this.boundKeyUp = (e: KeyboardEvent) => {
      if (!this.nudging || !ARROW_KEYS.has(e.key)) return;
      this.clearIdleTimer();
      this.idleTimer = setTimeout(() => this.endNudge(), NUDGE_IDLE_MS);
    };
    this.boundBlur = () => this.endNudge();
    doc.addEventListener('keydown', this.boundHandler);
    doc.addEventListener('keyup', this.boundKeyUp);
    doc.defaultView?.addEventListener('blur', this.boundBlur);
  }

  /** 矢印キーの連続入力を閉じ、Undo の 1 件として確定する。入力中でなければ何もしない。 */
  endNudge(): void {
    this.clearIdleTimer();
    if (!this.nudging) return;
    this.nudging = false;
    this.ctrl?.endGesture();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  setSelection(sel: NudgeSelection): void {
    this.endNudge();
    this.selection = sel;
    // Drag handles prevent the browser's default focus change. Release stale tab focus
    // so arrow keys edit the selected handle after switching back to the mapping pane.
    // 入力欄・select も同じ。フォーカスが残ると、矢印キーは選んだ隅ではなく欄の値を変える (#206)。
    const focused = this.doc?.activeElement;
    if (sel && (focused?.getAttribute('role') === 'tab' || focused?.matches('input, textarea, select, [contenteditable]'))) (focused as HTMLElement).blur();
    this.refreshUI();
  }

  clearSelection(): void {
    this.endNudge();
    if (!this.selection) return;
    this.selection = null;
    this.refreshUI();
  }

  destroy(): void {
    this.endNudge();
    if (this.doc && this.boundHandler) {
      this.doc.removeEventListener('keydown', this.boundHandler);
    }
    if (this.doc && this.boundKeyUp) this.doc.removeEventListener('keyup', this.boundKeyUp);
    if (this.boundBlur) this.doc?.defaultView?.removeEventListener('blur', this.boundBlur);
    this.boundHandler = null;
    this.boundKeyUp = null;
    this.boundBlur = null;
    this.scope = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
    this.selection = null;
  }

  /** 選択中のハンドル / 枠に .kbd-selected を付け替える。 */
  private refreshUI(): void {
    const scope = this.scope;
    const opts = this.opts;
    if (!scope || !opts) return;
    const sel = this.selection;
    scope
      .querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle')
      .forEach(h => h.classList.toggle('kbd-selected', sel?.type === 'quad' && h.dataset.corner === sel.corner));
    opts.getSelectionBox()?.classList.toggle('kbd-selected', sel?.type === 'source');
  }

  private handleKey(e: KeyboardEvent): void {
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!ctrl || !opts) return;
    if (!this.selection) return;
    // 入力欄の矢印キーは奪わない（マッピング名のインライン編集、数値欄の増減、select の選択など）
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]')) return;

    let dirX = 0, dirY = 0;
    switch (e.key) {
      case 'ArrowLeft':  dirX = -1; break;
      case 'ArrowRight': dirX =  1; break;
      case 'ArrowUp':    dirY = -1; break;
      case 'ArrowDown':  dirY =  1; break;
      default: return;
    }
    e.preventDefault();
    // ロック中の面は隅も crop も動かさない (#190)。キーは消費して、ページのスクロールにも回さない。
    if (ctrl.isItemLocked()) return;
    const pixels = e.shiftKey ? 10 : 1;
    this.clearIdleTimer();
    if (!this.nudging) {
      this.nudging = true;
      ctrl.beginGesture();
    }

    if (this.selection.type === 'quad') {
      const corner = this.selection.corner;
      const step = opts.getQuadStepPerScreenPx();
      const q = ctrl.getActiveQuad();
      const p = q[corner];
      // 1 screen-px = step.x canvas-px。pixels（1 or 10）ぶん × step が仮想キャンバス px ステップ。
      // quad が凹む位置へは動かさない（凹んだ quad は映像が反転する。#95）
      const target = {
        x: p.x + dirX * pixels * step.x,
        y: p.y + dirY * pixels * step.y,
      };
      ctrl.setActiveQuad({
        ...q,
        [corner]: constrainQuadCorner(q, corner, target),
      });
      opts.onAfterMutate('quad');
      ctrl.commit();
    } else {
      const ref = opts.getSourceRefSize();
      ctrl.mutateActiveSource(s => {
        s.x = Math.max(0, Math.min(100 - s.width,  s.x + (dirX * pixels * 100) / ref.width));
        s.y = Math.max(0, Math.min(100 - s.height, s.y + (dirY * pixels * 100) / ref.height));
      });
      opts.onAfterMutate('source');
      ctrl.commit();
    }
  }
}
