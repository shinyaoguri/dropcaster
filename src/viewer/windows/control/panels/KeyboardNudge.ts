/**
 * 矢印キー（+ Shift で 10px）で active mapping の source 矩形 or quad の隅を微調整する panel。
 *
 * 選択状態（どの quad の隅か / source 全体か）はこの panel が保持する。drag ハンドラ側は
 * mousedown 時に setSelection() / clearSelection() を呼んで状態を更新する（クロス panel API）。
 */

import type { CornerKey } from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';

export type NudgeSelection =
  | { type: 'quad'; corner: CornerKey }
  | { type: 'source' }
  | null;

export interface KeyboardNudgeAttachOptions {
  getQuadRefSize: () => { width: number; height: number };
  getSourceRefSize: () => { width: number; height: number };
  getSelectionBox: () => HTMLDivElement | null;
  /** mutation 直後に呼ぶ後処理（updateQuadTransform / updateAfterSourceChange + updateToolValues 等）。 */
  onAfterMutate: (type: 'quad' | 'source') => void;
}

export class KeyboardNudge {
  private scope: HTMLElement | null = null;
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: KeyboardNudgeAttachOptions | null = null;
  private selection: NudgeSelection = null;
  private boundHandler: ((e: KeyboardEvent) => void) | null = null;

  attach(scope: HTMLElement, doc: Document, ctrl: MappingsController, opts: KeyboardNudgeAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;
    this.boundHandler = (e: KeyboardEvent) => this.handleKey(e);
    doc.addEventListener('keydown', this.boundHandler);
  }

  setSelection(sel: NudgeSelection): void {
    this.selection = sel;
    this.refreshUI();
  }

  clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.refreshUI();
  }

  destroy(): void {
    if (this.doc && this.boundHandler) {
      this.doc.removeEventListener('keydown', this.boundHandler);
    }
    this.boundHandler = null;
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
    // テキスト入力中は矢印キーを奪わない（マッピング名のインライン編集など）
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;

    let dirX = 0, dirY = 0;
    switch (e.key) {
      case 'ArrowLeft':  dirX = -1; break;
      case 'ArrowRight': dirX =  1; break;
      case 'ArrowUp':    dirY = -1; break;
      case 'ArrowDown':  dirY =  1; break;
      default: return;
    }
    e.preventDefault();
    const pixels = e.shiftKey ? 10 : 1;

    if (this.selection.type === 'quad') {
      const corner = this.selection.corner;
      const ref = opts.getQuadRefSize();
      const q = ctrl.getActiveQuad();
      const p = q[corner];
      ctrl.setActiveQuad({
        ...q,
        [corner]: {
          x: p.x + (dirX * pixels * 100) / ref.width,
          y: p.y + (dirY * pixels * 100) / ref.height,
        },
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
