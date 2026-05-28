/**
 * active mask の編集 UI（ペンツールでの新規描画 + 既存マスクの頂点編集）を担当する panel。
 *
 * モード判定は active mask の drafting フラグ:
 *   - drafting=true → ペンツールモード。canvas-host の click で頂点を末尾追加し、
 *     最初の頂点をクリック / Enter で閉じる（→ drafting=false）。Esc で破棄。
 *     描画中の preview line は最後の頂点 → カーソル位置を結ぶ rubber-band として描画。
 *   - drafting=false → 通常編集モード。頂点 / 辺中点（＋）/ 重心（✦）ハンドルを表示し、
 *     ドラッグや右クリック削除で編集する。
 *
 * 描画は InactivePreviewPool.sync が canvas-mappings レイヤに行う（drafting で polyline /
 * commit 後 polygon の点列だけを与える）。ここは編集ハンドル群と pen mode 用 click 受けを
 * canvas-host / canvas-handles に張る。
 */

import {
  isMaskEntry,
  withMaskDraftingCommitted,
  withMaskPointAppended,
  withRemovedMapping,
  type MappingsState,
  type Point,
} from '../../../utils/mappingTransform';
import { CleanupStack } from '../../../utils/cleanupStack';
import type { MappingsController } from '../MappingsController';
import { draggable } from '../utils/draggable';
import { t } from '../../../i18n/index.js';

export interface MaskEditPanelAttachOptions {
  /** active mask の頂点が変わったあと、preview pool に再描画させるためのフック。 */
  onMaskChanged: () => void;
  /** canvas-handles レイヤ（頂点・辺中点・平行移動ハンドルの mount 先）。 */
  getCanvasHandles: () => HTMLElement | null;
}

interface VertexHandleEntry {
  el: HTMLDivElement;
  dispose: () => void;
}

interface EdgeHandleEntry {
  el: HTMLDivElement;
  dispose: () => void;
}

/**
 * 最初の頂点との近接判定（canvas px ではなくスクリーン px で判定）。
 * 16 px 以内に来たら「最初の頂点に snap して閉じる」モードに入る。
 */
const PEN_CLOSE_THRESHOLD_SCREEN_PX = 16;

export class MaskEditPanel {
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: MaskEditPanelAttachOptions | null = null;
  /** 編集モードの頂点ハンドル群（drafting=false 時のみ）。 */
  private vertexHandles: VertexHandleEntry[] = [];
  /** 編集モードの辺中点 + ハンドル群（drafting=false 時のみ）。 */
  private edgeHandles: EdgeHandleEntry[] = [];
  private translateHandle: HTMLDivElement | null = null;
  private translateDispose: (() => void) | null = null;
  /**
   * ペンツールモードの DOM（drafting=true 時のみ）。
   * - dots: 配置済み頂点を示す小マーカー（canvas-handles 内）。最初の頂点だけ「閉じる」ボタンとして
   *   クリック可能。
   * - rubberLine: 最後の頂点 → カーソル位置を結ぶ rubber-band SVG line。
   * - hintBadge: 操作ヒント（Enter で閉じる / Esc で取消）を画面に小さく表示する DOM。
   */
  private penDots: HTMLDivElement[] = [];
  private penRubberSvg: SVGSVGElement | null = null;
  private penRubberLine: SVGLineElement | null = null;
  private penHintBadge: HTMLDivElement | null = null;
  /** drafting 中に canvas-host へ張る listener の解除関数。 */
  private penDisposes: Array<() => void> = [];
  /** drafting 中の最後のカーソル位置（canvas px）。null = カーソルが host 外 or 未確定。 */
  private lastCursor: Point | null = null;

  private cleanups = new CleanupStack();

  attach(doc: Document, ctrl: MappingsController, opts: MaskEditPanelAttachOptions): void {
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;
    this.refresh();
  }

  /** state 変化に合わせて編集 UI を最新化（drafting / 編集モードの切替も含む）。 */
  refresh(): void {
    const ctrl = this.ctrl;
    const opts = this.opts;
    const doc = this.doc;
    if (!ctrl || !opts || !doc) return;
    const layer = opts.getCanvasHandles();
    if (!layer) return;

    const state = ctrl.getState();
    const item = state.mappings.find(m => m.id === state.activeId);
    if (!item || !isMaskEntry(item)) {
      this.clearEditingHandles();
      this.exitPenMode();
      return;
    }

    if (item.drafting) {
      // ペンツールモード — 編集ハンドルは出さず、canvas-host への click listener を張る
      this.clearEditingHandles();
      this.enterPenMode(layer, item.points);
      return;
    }

    // 通常編集モード — ペン関連を畳む
    this.exitPenMode();
    this.refreshEditingHandles(layer, item.points);
  }

  destroy(): void {
    this.cleanups.runAll();
    this.clearEditingHandles();
    this.exitPenMode();
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
  }

  // ── 編集モード（drafting=false）──────────────────────────────

  private refreshEditingHandles(layer: HTMLElement, points: Point[]): void {
    const doc = this.doc;
    if (!doc) return;

    while (this.vertexHandles.length > points.length) {
      const v = this.vertexHandles.pop()!;
      v.dispose();
      v.el.remove();
    }
    while (this.vertexHandles.length < points.length) {
      const idx = this.vertexHandles.length;
      this.vertexHandles.push(this.buildVertexHandle(doc, layer, idx));
    }
    while (this.edgeHandles.length > points.length) {
      const e = this.edgeHandles.pop()!;
      e.dispose();
      e.el.remove();
    }
    while (this.edgeHandles.length < points.length) {
      const idx = this.edgeHandles.length;
      this.edgeHandles.push(this.buildEdgeHandle(doc, layer, idx));
    }

    for (let i = 0; i < points.length; i++) {
      const v = this.vertexHandles[i];
      v.el.style.left = `${points[i].x}px`;
      v.el.style.top = `${points[i].y}px`;
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.edgeHandles[i].el.style.left = `${mx}px`;
      this.edgeHandles[i].el.style.top = `${my}px`;
    }

    if (!this.translateHandle) {
      this.translateHandle = this.buildTranslateHandle(doc, layer);
    } else if (this.translateHandle.parentElement !== layer) {
      layer.appendChild(this.translateHandle);
    }
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    if (points.length > 0) { cx /= points.length; cy /= points.length; }
    this.translateHandle.style.left = `${cx}px`;
    this.translateHandle.style.top = `${cy}px`;
  }

  private clearEditingHandles(): void {
    for (const v of this.vertexHandles) { v.dispose(); v.el.remove(); }
    this.vertexHandles = [];
    for (const e of this.edgeHandles) { e.dispose(); e.el.remove(); }
    this.edgeHandles = [];
    this.translateDispose?.();
    this.translateDispose = null;
    this.translateHandle?.remove();
    this.translateHandle = null;
  }

  private buildVertexHandle(doc: Document, layer: HTMLElement, indexAtCreate: number): VertexHandleEntry {
    const el = doc.createElement('div');
    el.className = 'mask-vertex-handle';
    el.dataset.vertexIndex = String(indexAtCreate);
    el.title = t('maskEdit.vertex.title');
    layer.appendChild(el);

    const getIndex = (): number => {
      const v = el.dataset.vertexIndex;
      return v ? parseInt(v, 10) : 0;
    };

    type Snap = { startX: number; startY: number; initial: Point };
    const dispose = draggable<Snap>(el, doc, {
      onStart: (e) => {
        const ctrl = this.ctrl;
        if (!ctrl) return null;
        const state = ctrl.getState();
        const mask = state.mappings.find(m => m.id === state.activeId);
        if (!mask || !isMaskEntry(mask)) return null;
        const idx = getIndex();
        if (idx < 0 || idx >= mask.points.length) return null;
        el.classList.add('dragging');
        e.stopPropagation();
        e.preventDefault();
        return { startX: e.clientX, startY: e.clientY, initial: { ...mask.points[idx] } };
      },
      onMove: (e, snap) => {
        const ctrl = this.ctrl;
        const opts = this.opts;
        if (!ctrl || !opts) return;
        const parent = el.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const state = ctrl.getState();
        const dx = ((e.clientX - snap.startX) / rect.width) * state.canvas.width;
        const dy = ((e.clientY - snap.startY) / rect.height) * state.canvas.height;
        const idx = getIndex();
        ctrl.mutateActiveMaskPoints((pts) => {
          if (idx < 0 || idx >= pts.length) return;
          pts[idx] = { x: snap.initial.x + dx, y: snap.initial.y + dy };
        });
        ctrl.commit();
        this.refresh();
        opts.onMaskChanged();
      },
      onEnd: () => { el.classList.remove('dragging'); },
    });

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      this.removeVertex(getIndex());
    };
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      this.removeVertex(getIndex());
    };
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('click', onClick);

    return {
      el,
      dispose: () => {
        dispose();
        el.removeEventListener('contextmenu', onContext);
        el.removeEventListener('click', onClick);
      },
    };
  }

  private buildEdgeHandle(doc: Document, layer: HTMLElement, indexAtCreate: number): EdgeHandleEntry {
    const el = doc.createElement('div');
    el.className = 'mask-edge-handle';
    el.dataset.edgeIndex = String(indexAtCreate);
    el.title = t('maskEdit.edge.title');
    el.textContent = '+';
    layer.appendChild(el);
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const v = el.dataset.edgeIndex;
      const idx = v ? parseInt(v, 10) : 0;
      this.insertVertexAfter(idx);
    };
    el.addEventListener('click', onClick);
    return {
      el,
      dispose: () => { el.removeEventListener('click', onClick); },
    };
  }

  private buildTranslateHandle(doc: Document, layer: HTMLElement): HTMLDivElement {
    const el = doc.createElement('div');
    el.className = 'mask-translate-handle';
    el.title = t('maskEdit.translate.title');
    el.textContent = '✦';
    layer.appendChild(el);

    type Snap = { startX: number; startY: number; initial: Point[] };
    const dispose = draggable<Snap>(el, doc, {
      onStart: (e) => {
        const ctrl = this.ctrl;
        if (!ctrl) return null;
        const state = ctrl.getState();
        const mask = state.mappings.find(m => m.id === state.activeId);
        if (!mask || !isMaskEntry(mask)) return null;
        el.classList.add('dragging');
        e.stopPropagation();
        e.preventDefault();
        return {
          startX: e.clientX,
          startY: e.clientY,
          initial: mask.points.map(p => ({ x: p.x, y: p.y })),
        };
      },
      onMove: (e, snap) => {
        const ctrl = this.ctrl;
        const opts = this.opts;
        if (!ctrl || !opts) return;
        const parent = el.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const state = ctrl.getState();
        const dx = ((e.clientX - snap.startX) / rect.width) * state.canvas.width;
        const dy = ((e.clientY - snap.startY) / rect.height) * state.canvas.height;
        ctrl.mutateActiveMaskPoints((pts) => {
          for (let i = 0; i < pts.length; i++) {
            pts[i] = { x: snap.initial[i].x + dx, y: snap.initial[i].y + dy };
          }
        });
        ctrl.commit();
        this.refresh();
        opts.onMaskChanged();
      },
      onEnd: () => { el.classList.remove('dragging'); },
    });
    this.translateDispose = dispose;
    return el;
  }

  private removeVertex(idx: number): void {
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!ctrl || !opts) return;
    const state = ctrl.getState();
    const mask = state.mappings.find(m => m.id === state.activeId);
    if (!mask || !isMaskEntry(mask)) return;
    if (mask.points.length <= 3) return;
    if (idx < 0 || idx >= mask.points.length) return;
    const next = mask.points.slice();
    next.splice(idx, 1);
    ctrl.setActiveMaskPoints(next);
    ctrl.commit();
    this.refresh();
    opts.onMaskChanged();
  }

  private insertVertexAfter(idx: number): void {
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!ctrl || !opts) return;
    const state = ctrl.getState();
    const mask = state.mappings.find(m => m.id === state.activeId);
    if (!mask || !isMaskEntry(mask)) return;
    const points = mask.points;
    if (idx < 0 || idx >= points.length) return;
    const a = points[idx];
    const b = points[(idx + 1) % points.length];
    const mid: Point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const next = points.slice();
    next.splice(idx + 1, 0, mid);
    ctrl.setActiveMaskPoints(next);
    ctrl.commit();
    this.refresh();
    opts.onMaskChanged();
  }

  // ── ペンツールモード（drafting=true）──────────────────────────

  /**
   * canvas-host に click / mousemove listener を張り、頂点マーカーと rubber-band line を
   * canvas-handles に作る。host の transform: scale() を考慮して client px → canvas px に
   * 変換する（OutputVizPanel と同じ計算）。
   */
  private enterPenMode(handlesLayer: HTMLElement, points: Point[]): void {
    const doc = this.doc;
    if (!doc) return;
    const host = handlesLayer.parentElement as HTMLElement | null;
    if (!host) return;
    const svgNs = 'http://www.w3.org/2000/svg';

    // ヒントバッジは canvas-host の外（#output-stage の直下）に置く。
    // canvas-host は transform: scale() なので、中に置くと拡大率に応じて文字サイズが変わる。
    if (!this.penHintBadge) {
      const stage = host.parentElement;
      if (stage) {
        const hint = doc.createElement('div');
        hint.className = 'mask-pen-hint';
        hint.textContent = t('maskEdit.pen.hint');
        stage.appendChild(hint);
        this.penHintBadge = hint;
      }
    }

    // rubber-band line
    if (!this.penRubberSvg) {
      const svg = doc.createElementNS(svgNs, 'svg') as SVGSVGElement;
      svg.classList.add('mask-pen-rubber');
      svg.setAttribute('preserveAspectRatio', 'none');
      const line = doc.createElementNS(svgNs, 'line') as SVGLineElement;
      svg.appendChild(line);
      handlesLayer.appendChild(svg);
      this.penRubberSvg = svg;
      this.penRubberLine = line;
    }
    const state = this.ctrl?.getState();
    if (state) {
      this.penRubberSvg.setAttribute('viewBox', `0 0 ${state.canvas.width} ${state.canvas.height}`);
      this.penRubberSvg.style.width = `${state.canvas.width}px`;
      this.penRubberSvg.style.height = `${state.canvas.height}px`;
    }

    // 頂点ドット — 数を合わせる
    while (this.penDots.length > points.length) {
      const d = this.penDots.pop()!;
      d.remove();
    }
    while (this.penDots.length < points.length) {
      const idx = this.penDots.length;
      const d = doc.createElement('div');
      d.className = 'mask-pen-dot';
      d.dataset.penIndex = String(idx);
      handlesLayer.appendChild(d);
      this.penDots.push(d);
    }
    // 最初の頂点（idx=0）は close のクリック target を兼ねる
    for (let i = 0; i < this.penDots.length; i++) {
      const d = this.penDots[i];
      d.style.left = `${points[i].x}px`;
      d.style.top = `${points[i].y}px`;
      d.classList.toggle('first', i === 0);
    }

    // 既に listener が張られていれば再 attach は不要（refresh 連打）
    if (this.penDisposes.length > 0) {
      this.updateRubber();
      return;
    }
    host.classList.add('mask-pen-mode');

    const clientToCanvas = (e: MouseEvent): Point | null => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const scale = parseFloat(host.style.getPropertyValue('--canvas-scale')) || 1;
      return {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale,
      };
    };

    const onClick = (e: MouseEvent) => {
      const ctrl = this.ctrl;
      const opts = this.opts;
      if (!ctrl || !opts) return;
      const state = ctrl.getState();
      const mask = state.mappings.find(m => m.id === state.activeId);
      if (!mask || !isMaskEntry(mask) || !mask.drafting) return;

      // 既存頂点ドット上のクリック: first で 3 点以上なら close、それ以外は no-op（重複追加を防ぐ）
      const target = e.target as HTMLElement | null;
      if (target && target.classList.contains('mask-pen-dot')) {
        if (target.classList.contains('first') && mask.points.length >= 3) {
          e.preventDefault();
          e.stopPropagation();
          this.commitDrafting(mask.id);
        }
        return;
      }
      // 既存ハンドル上は触らない（保険）
      if (target && (target.classList.contains('mask-vertex-handle')
                 || target.classList.contains('mask-edge-handle')
                 || target.classList.contains('mask-translate-handle'))) return;

      const canvasPt = clientToCanvas(e);
      if (!canvasPt) return;
      e.preventDefault();
      e.stopPropagation();

      // 最初の頂点近接（screen px 16 以内）で close — snap-to-close
      if (mask.points.length >= 3) {
        const first = mask.points[0];
        const scale = parseFloat(host.style.getPropertyValue('--canvas-scale')) || 1;
        const dxScreen = (canvasPt.x - first.x) * scale;
        const dyScreen = (canvasPt.y - first.y) * scale;
        if (Math.hypot(dxScreen, dyScreen) < PEN_CLOSE_THRESHOLD_SCREEN_PX) {
          this.commitDrafting(mask.id);
          return;
        }
      }
      ctrl.replaceState(withMaskPointAppended(ctrl.getState(), mask.id, canvasPt));
    };

    const onMove = (e: MouseEvent) => {
      const p = clientToCanvas(e);
      if (!p) return;
      this.lastCursor = p;
      this.updateRubber();
    };

    const onLeave = () => {
      this.lastCursor = null;
      this.updateRubber();
    };

    const onKey = (e: KeyboardEvent) => {
      const ctrl = this.ctrl;
      if (!ctrl) return;
      const state = ctrl.getState();
      const mask = state.mappings.find(m => m.id === state.activeId);
      if (!mask || !isMaskEntry(mask) || !mask.drafting) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (mask.points.length >= 3) this.commitDrafting(mask.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelDrafting(mask.id);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && mask.points.length > 0) {
        e.preventDefault();
        const next = mask.points.slice(0, -1);
        ctrl.setActiveMaskPoints(next);
        ctrl.commit();
        this.refresh();
        this.opts?.onMaskChanged();
      }
    };

    host.addEventListener('click', onClick);
    host.addEventListener('mousemove', onMove);
    host.addEventListener('mouseleave', onLeave);
    // keydown は host に focus が無くても拾えるよう document に張る
    doc.addEventListener('keydown', onKey);
    this.penDisposes.push(
      () => host.removeEventListener('click', onClick),
      () => host.removeEventListener('mousemove', onMove),
      () => host.removeEventListener('mouseleave', onLeave),
      () => doc.removeEventListener('keydown', onKey),
    );

    this.updateRubber();
  }

  private exitPenMode(): void {
    this.penDisposes.forEach(d => { try { d(); } catch { /* ignore */ } });
    this.penDisposes = [];
    for (const d of this.penDots) d.remove();
    this.penDots = [];
    this.penRubberSvg?.remove();
    this.penRubberSvg = null;
    this.penRubberLine = null;
    this.penHintBadge?.remove();
    this.penHintBadge = null;
    this.lastCursor = null;
    const layer = this.opts?.getCanvasHandles();
    const host = layer?.parentElement as HTMLElement | null;
    host?.classList.remove('mask-pen-mode');
  }

  /** rubber-band line を最後の頂点 → カーソルに合わせて更新。 */
  private updateRubber(): void {
    const line = this.penRubberLine;
    if (!line) return;
    const ctrl = this.ctrl;
    if (!ctrl) return;
    const state = ctrl.getState();
    const mask = state.mappings.find(m => m.id === state.activeId);
    if (!mask || !isMaskEntry(mask) || !mask.drafting) {
      line.setAttribute('x1', '0'); line.setAttribute('x2', '0');
      line.setAttribute('y1', '0'); line.setAttribute('y2', '0');
      return;
    }
    const cursor = this.lastCursor;
    const last = mask.points[mask.points.length - 1];
    if (!cursor || !last) {
      line.setAttribute('x1', '0'); line.setAttribute('x2', '0');
      line.setAttribute('y1', '0'); line.setAttribute('y2', '0');
      return;
    }
    line.setAttribute('x1', String(last.x));
    line.setAttribute('y1', String(last.y));
    line.setAttribute('x2', String(cursor.x));
    line.setAttribute('y2', String(cursor.y));
  }

  private commitDrafting(maskId: string): void {
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!ctrl || !opts) return;
    const next = withMaskDraftingCommitted(ctrl.getState(), maskId);
    if (next === ctrl.getState()) return; // 3 点未満などで no-op
    ctrl.replaceState(next);
    // refresh は replaceState → fireChange → ControlWindow.refreshAllFromState で呼ばれる
  }

  private cancelDrafting(maskId: string): void {
    const ctrl = this.ctrl;
    if (!ctrl) return;
    // 描画中マスクごと削除（最後の 1 個なら削除されないが、その場合 drafting のまま残る）。
    // 一覧の中に他項目があれば withRemovedMapping が新しい active に切り替える。
    ctrl.replaceState(withRemovedMapping(ctrl.getState(), maskId));
  }

  /** state が外から差し替わった時に呼ぶ。 */
  applyStateChange(_state: MappingsState): void {
    this.refresh();
  }
}
