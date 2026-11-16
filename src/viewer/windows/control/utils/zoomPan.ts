/**
 * 編集ビュー（ソース列・マッピング列）に、お絵描きアプリのような拡大・パンの操作を付ける部品。
 *
 *   - ホイール（トラックパッドのピンチ = ctrl+wheel を含む）: カーソル位置を中心に拡大・縮小
 *   - Space を押しながら左ドラッグ / 中ボタンドラッグ: パン
 *   - viewport 右下のボタン: 縮小・倍率表示・拡大・全体表示に戻す
 *
 * 表示の状態（ViewZoom）を持つだけで、描画は onChange を受けた呼び出し側が行う。
 * 編集の state には触れないので、Undo 履歴にも保存にも入らない。
 *
 * パンの mousedown は viewport の capture phase で取り、stopPropagation する。四隅・crop 枠・
 * マスク頂点などのドラッグ（draggable は mousedown を見る）より先に取るため。パンの直後の click も
 * 1 回だけ握りつぶし、マスクのペン描画（host の click で頂点を足す）に点が増えないようにする。
 */

import { t, type MessageKey } from '../../../i18n/index.js';
import {
  FIT_VIEW,
  ZOOM_BUTTON_STEP,
  isFitView,
  panBy,
  wheelZoomFactor,
  zoomAt,
  type ViewGeometry,
  type ViewZoom,
  type ZoomLimits,
} from '../../../utils/viewZoom';

export interface ZoomPanOptions {
  limits: ZoomLimits;
  /** 現在の全体表示の幾何。まだレイアウトされていない（寸法 0 等）ときは null。 */
  getGeometry: (view: ViewZoom) => ViewGeometry | null;
  /** 表示の状態が変わったときに呼ばれる。 */
  onChange: (view: ViewZoom) => void;
}

export interface ZoomPanHandle {
  getView(): ViewZoom;
  reset(): void;
  dispose(): void;
}

const ICON_ATTRS = 'viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  out: `<svg ${ICON_ATTRS}><path d="M5 12h14"/></svg>`,
  in: `<svg ${ICON_ATTRS}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  fit: `<svg ${ICON_ATTRS}><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>`,
};

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function attachZoomPan(viewport: HTMLElement, doc: Document, opts: ZoomPanOptions): ZoomPanHandle {
  let view: ViewZoom = { ...FIT_VIEW };
  let pointerInside = false;
  let spaceDown = false;
  let panning: { lastX: number; lastY: number } | null = null;
  let suppressClick = false;
  const disposers: (() => void)[] = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document | Window,
    type: K | string,
    fn: (e: never) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, fn as EventListener, options);
    disposers.push(() => target.removeEventListener(type, fn as EventListener, options));
  };

  // ── 右下のボタン ─────────────────────────────────────────
  const controls = doc.createElement('div');
  controls.className = 'dc-zoom-controls';
  controls.setAttribute('role', 'toolbar');
  setLabel(controls, 'control.zoom.label', false);
  const outBtn = makeButton('control.zoom.out', ICONS.out);
  const level = doc.createElement('span');
  level.className = 'dc-zoom-level';
  level.setAttribute('aria-live', 'polite');
  const inBtn = makeButton('control.zoom.in', ICONS.in);
  const fitBtn = makeButton('control.zoom.fit', ICONS.fit);
  controls.append(outBtn, level, inBtn, fitBtn);
  viewport.appendChild(controls);
  disposers.push(() => controls.remove());
  // ボタン上のマウス操作は下の編集ビューへ渡さない
  listen(controls, 'mousedown', (e: MouseEvent) => e.stopPropagation());
  listen(outBtn, 'click', () => zoomFromCenter(1 / ZOOM_BUTTON_STEP));
  listen(inBtn, 'click', () => zoomFromCenter(ZOOM_BUTTON_STEP));
  listen(fitBtn, 'click', () => setView({ ...FIT_VIEW }));

  function makeButton(key: MessageKey, icon: string): HTMLButtonElement {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'dc-zoom-btn';
    btn.innerHTML = icon;
    setLabel(btn, key, true);
    return btn;
  }

  function setLabel(el: HTMLElement, key: MessageKey, withTitle: boolean): void {
    // 言語切替時は applyControlTranslations が data-i18n-* から書き戻す
    el.dataset.i18nAriaLabel = key;
    el.setAttribute('aria-label', t(key));
    if (withTitle) {
      el.dataset.i18nTitle = key;
      el.title = t(key);
    }
  }

  function renderControls(): void {
    level.textContent = `${Math.round(view.zoom * 100)}%`;
    outBtn.disabled = view.zoom <= opts.limits.min;
    inBtn.disabled = view.zoom >= opts.limits.max;
    fitBtn.disabled = isFitView(view);
  }

  function setView(next: ViewZoom): void {
    if (next.zoom === view.zoom && next.panX === view.panX && next.panY === view.panY) return;
    view = next;
    renderControls();
    opts.onChange(view);
  }

  function zoomFromCenter(factor: number): void {
    const geom = opts.getGeometry(view);
    if (!geom) return;
    setView(zoomAt(view, factor, { x: geom.viewW / 2, y: geom.viewH / 2 }, geom, opts.limits));
  }

  // ── ホイール: カーソル位置を中心に拡大・縮小 ───────────────────
  listen(viewport, 'wheel', (e: WheelEvent) => {
    if (e.deltaY === 0) return;
    const geom = opts.getGeometry(view);
    if (!geom) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setView(zoomAt(view, wheelZoomFactor(e), anchor, geom, opts.limits));
  }, { passive: false });

  // ── パン: Space + 左ドラッグ / 中ボタンドラッグ ─────────────────
  const syncCursor = () => {
    viewport.classList.toggle('dc-pan-ready', spaceDown && pointerInside && !panning);
    viewport.classList.toggle('dc-panning', !!panning);
  };
  listen(viewport, 'mouseenter', () => { pointerInside = true; syncCursor(); });
  listen(viewport, 'mouseleave', () => { pointerInside = false; syncCursor(); });
  listen(doc, 'keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !pointerInside || isEditableTarget(e.target)) return;
    // ページのスクロールや、フォーカス中のボタンの押下にさせない
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; syncCursor(); }
  });
  listen(doc, 'keyup', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !spaceDown) return;
    spaceDown = false;
    syncCursor();
  });
  const win = doc.defaultView;
  if (win) listen(win, 'blur', () => { spaceDown = false; endPan(); syncCursor(); });

  const onPanMove = (e: MouseEvent) => {
    if (!panning) return;
    const dx = e.clientX - panning.lastX;
    const dy = e.clientY - panning.lastY;
    panning.lastX = e.clientX;
    panning.lastY = e.clientY;
    const geom = opts.getGeometry(view);
    if (geom) setView(panBy(view, dx, dy, geom));
  };
  const onPanUp = () => {
    endPan();
    // この mouseup に続く click だけを握りつぶす。click が来ない（viewport の外で離した）ときに備えて次のタスクで戻す
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  };
  function endPan(): void {
    if (!panning) return;
    panning = null;
    doc.removeEventListener('mousemove', onPanMove);
    doc.removeEventListener('mouseup', onPanUp);
    syncCursor();
  }
  disposers.push(endPan);

  listen(viewport, 'mousedown', (e: MouseEvent) => {
    const isPan = e.button === 1 || (e.button === 0 && spaceDown);
    if (!isPan) return;
    e.preventDefault();
    e.stopPropagation();
    if (panning) return;
    panning = { lastX: e.clientX, lastY: e.clientY };
    doc.addEventListener('mousemove', onPanMove);
    doc.addEventListener('mouseup', onPanUp);
    syncCursor();
  }, { capture: true });
  listen(viewport, 'click', (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true });
  // 中ボタンのクリック（auxclick）で、リンクを開く等の既定の動作をさせない
  listen(viewport, 'auxclick', (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); });

  renderControls();

  return {
    getView: () => view,
    reset: () => setView({ ...FIT_VIEW }),
    dispose: () => {
      for (const d of disposers.splice(0).reverse()) d();
      viewport.classList.remove('dc-pan-ready', 'dc-panning');
    },
  };
}
