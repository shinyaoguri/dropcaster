/**
 * マッピングカラム（warp 後プレビュー）の panel。
 *
 * 担当:
 *   - active mapping の quad 4 隅 (.quad-handle) を独立に動かしてホモグラフィー変形
 *   - cropped-container 本体のドラッグで quad 全体を平行移動
 *   - #reset-mapping-btn でデフォルト quad に戻す
 *   - 親 (.dc-mapping-area) の寸法変化（カラムリサイザ追従）に応じた matrix3d 再計算
 *   - クロップ済み <video> へのストリーム bind と source rect クロップの適用
 *   - **multi-output**: active mapping の outputId に応じて自身の DOM（cropped-container +
 *     4 quad-handles）を該当する `.dc-mapping-area[data-output-id="..."]` にぶら下げ直す。
 *
 * state mutation は MappingsController 経由。drag は utils/draggable で document
 * listener のリーク対策が組み込まれている。
 *
 * 「quad が変わった」副次効果（非 active プレビューの同期・ツール値の再描画）は
 * onQuadChanged コールバックで親に通知する。
 */

import {
  CORNER_KEYS,
  applyQuadCanvas,
  applyVideoCrop,
  cloneQuad,
  defaultQuad,
  mappingColor,
  translateQuad,
  type CornerKey,
  type Quad,
} from '../../../utils/mappingTransform';
import type { MappingsController } from '../MappingsController';
import { draggable } from '../utils/draggable';

export interface MappingAreaPanelAttachOptions {
  setKeyboardQuadSelection: (corner: CornerKey) => void;
  clearKeyboardSelection: () => void;
  /** quad 変更時の副次更新（非 active preview sync + ツール値更新）に使う。 */
  onQuadChanged: () => void;
  /** cropped-video の loadedmetadata 時に呼ばれる。親側で videoActualDimensions を反映する用。 */
  onCroppedVideoMetadata?: (dimensions: { width: number; height: number }) => void;
  /**
   * 仮想キャンバス全体の mapping レイヤ（cropped-container の mount 先）。
   * canvas-host の中にあり、canvas px サイズで scale 適用済みの座標系で動く。
   */
  getCanvasMappings: () => HTMLElement | null;
  /**
   * 仮想キャンバス全体の handles レイヤ（4 隅ハンドルの mount 先）。
   * canvas-host 内なので親の scale が適用される — ハンドル本体は --canvas-counter-scale で
   * 逆スケールしてサイズ 14px を維持する。
   */
  getCanvasHandles: () => HTMLElement | null;
}

export class MappingAreaPanel {
  private scope: HTMLElement | null = null;
  private doc: Document | null = null;
  private win: Window | null = null;
  private ctrl: MappingsController | null = null;
  private opts: MappingAreaPanelAttachOptions | null = null;
  private croppedContainer: HTMLDivElement | null = null;
  private croppedVideo: HTMLVideoElement | null = null;
  private mappingVideo: HTMLVideoElement | null = null;
  /** 4 隅の quad-handle 要素群。cropped-container と一緒に親に動く。 */
  private handles: HTMLDivElement[] = [];
  private cleanups: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private observedArea: HTMLElement | null = null;
  private resizeRafId: number | null = null;
  private streamSetupTimeout: number | null = null;

  attach(scope: HTMLElement, doc: Document, win: Window, ctrl: MappingsController, opts: MappingAreaPanelAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.win = win;
    this.ctrl = ctrl;
    this.opts = opts;
    this.mappingVideo = scope.querySelector('#mapping-video') as HTMLVideoElement | null;

    this.createElements();
    this.wireResetButton();
    this.setupQuadBodyDrag();
    this.setupQuadHandles();
    this.mountInActiveOutput();
    this.refreshTransform();
    this.setupResizeObserver();

    // ストリームが MappingStream 経由で届くのを待ってから bind
    this.streamSetupTimeout = win.setTimeout(() => {
      this.streamSetupTimeout = null;
      this.setupCroppedVideoStream();
    }, 1000);
  }

  /** active mapping の outputId が変わった時に呼ぶ — DOM を該当 output 配下へ動かす。 */
  refreshActiveMount(): void {
    this.mountInActiveOutput();
    this.refreshTransform();
  }

  /** quad の matrix3d / mapping color / 4 隅ハンドル位置 / video clip-path を全部最新化。 */
  refreshTransform(): void {
    const ctrl = this.ctrl;
    const scope = this.scope;
    if (!ctrl || !scope || !this.croppedContainer) return;

    const state = ctrl.getState();
    const quad = ctrl.getActiveQuad();

    // cropped-container は canvas-mappings 直下に置かれ、サイズは canvas px と一致。matrix3d
    // は quad（仮想キャンバス px）と canvas 寸法を使う。
    this.croppedContainer.style.width = `${state.canvas.width}px`;
    this.croppedContainer.style.height = `${state.canvas.height}px`;
    applyQuadCanvas(this.croppedContainer, quad, state.canvas.width, state.canvas.height);

    // active な mapping の色を CSS 変数として伝播
    const activeIdx = state.mappings.findIndex(m => m.id === state.activeId);
    const activeColor = mappingColor(activeIdx >= 0 ? activeIdx : 0);
    this.croppedContainer.style.setProperty('--mapping-color', activeColor);
    for (const h of this.handles) h.style.setProperty('--mapping-color', activeColor);

    this.updateQuadHandlePositions(quad);
    this.refreshVideoCrop();

    this.opts?.onQuadChanged();
  }

  /** source rect 変更時に呼ぶ（clip-path のみ更新）。 */
  refreshVideoCrop(): void {
    const ctrl = this.ctrl;
    if (!ctrl || !this.croppedVideo || !this.croppedContainer) return;
    applyVideoCrop(this.croppedVideo, ctrl.getActiveSource());
  }

  getCroppedContainer(): HTMLDivElement | null { return this.croppedContainer; }
  /** InactivePreviewPool が active container の前に挿入する基準点として使う。 */
  getStage(): HTMLElement | null { return this.croppedContainer?.parentElement ?? null; }
  /** ControlWindow が video の videoActualDimensions を更新するために使う。 */
  getCroppedVideo(): HTMLVideoElement | null { return this.croppedVideo; }

  destroy(): void {
    this.cleanups.forEach(off => { try { off(); } catch { /* ignore */ } });
    this.cleanups = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observedArea = null;
    if (this.resizeRafId !== null && this.win) {
      this.win.cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    if (this.streamSetupTimeout !== null && this.win) {
      this.win.clearTimeout(this.streamSetupTimeout);
      this.streamSetupTimeout = null;
    }
    this.croppedContainer?.remove();
    for (const h of this.handles) h.remove();
    this.handles = [];
    this.scope = null;
    this.doc = null;
    this.win = null;
    this.ctrl = null;
    this.opts = null;
    this.croppedContainer = null;
    this.croppedVideo = null;
    this.mappingVideo = null;
  }

  // ── DOM 構築・mount ────────────────────────────────────────────

  private createElements(): void {
    const doc = this.doc;
    if (!doc) return;

    const container = doc.createElement('div');
    container.id = 'cropped-container';
    const video = doc.createElement('video');
    video.id = 'cropped-video';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    container.appendChild(video);
    this.croppedContainer = container;
    this.croppedVideo = video;

    this.handles = [];
    for (const corner of CORNER_KEYS) {
      const h = doc.createElement('div');
      h.className = 'quad-handle';
      h.dataset.corner = corner;
      this.handles.push(h);
    }
  }

  /**
   * 共有 canvas-mappings に cropped-container、canvas-handles に 4 quad-handles を mount。
   * 新モデルでは出力ごとの mount-area は無く、mapping は全 output 共通の canvas に描かれる。
   */
  private mountInActiveOutput(): void {
    const opts = this.opts;
    const container = this.croppedContainer;
    if (!opts || !container) return;
    const canvasMappings = opts.getCanvasMappings();
    const canvasHandles = opts.getCanvasHandles();
    if (!canvasMappings || !canvasHandles) return;

    if (container.parentElement !== canvasMappings) {
      canvasMappings.appendChild(container);
    }
    for (const h of this.handles) {
      if (h.parentElement !== canvasHandles) canvasHandles.appendChild(h);
    }
    this.rebindResizeObserver();
  }

  // ── reset / drag ────────────────────────────────────────────────

  private wireResetButton(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    if (!scope || !ctrl) return;
    const btn = scope.querySelector('#reset-mapping-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // active mapping の所属出力の中央 25..75% に戻す（仮想キャンバス px）
      const state = ctrl.getState();
      const active = state.mappings.find(m => m.id === state.activeId);
      const out = active ? state.outputs.find(o => o.id === active.outputId) : undefined;
      ctrl.setActiveQuad(defaultQuad(out));
      this.refreshTransform();
      ctrl.commit();
    });
  }

  /**
   * cropped-container 本体（隅ハンドル以外）のドラッグで quad 全体を平行移動。
   * delta はスクリーン px → canvas px に変換して quad に加算する。
   * 変換は parentRect（canvas-window の bounding rect）と canvas 寸法から算出。
   */
  private setupQuadBodyDrag(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    const container = this.croppedContainer;
    if (!doc || !ctrl || !opts || !container) return;

    type Snap = { startX: number; startY: number; initialQuad: Quad; canvasW: number; canvasH: number; parent: HTMLElement };
    const dispose = draggable<Snap>(container, doc, {
      onStart: (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('quad-handle')) return null;
        opts.clearKeyboardSelection();
        const parent = container.parentElement;
        if (!parent) return null;
        const state = ctrl.getState();
        e.preventDefault();
        return {
          startX: e.clientX,
          startY: e.clientY,
          initialQuad: cloneQuad(ctrl.getActiveQuad()),
          canvasW: state.canvas.width,
          canvasH: state.canvas.height,
          parent,
        };
      },
      onMove: (e, snap) => {
        const parentRect = snap.parent.getBoundingClientRect();
        if (parentRect.width <= 0 || parentRect.height <= 0) return;
        // canvas-window の表示サイズと canvas 寸法の比から、スクリーン px → canvas px へ変換
        const dx = ((e.clientX - snap.startX) / parentRect.width) * snap.canvasW;
        const dy = ((e.clientY - snap.startY) / parentRect.height) * snap.canvasH;
        ctrl.setActiveQuad(translateQuad(snap.initialQuad, dx, dy));
        this.refreshTransform();
        ctrl.commit();
      },
    });
    this.cleanups.push(dispose);
  }

  /** 4 隅ハンドルそれぞれを独立に動かしてホモグラフィー変形を作る。 */
  private setupQuadHandles(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    const container = this.croppedContainer;
    if (!doc || !ctrl || !opts || !container) return;

    for (const handle of this.handles) {
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) continue;

      type Snap = { startX: number; startY: number; initialPoint: { x: number; y: number }; canvasW: number; canvasH: number };
      const dispose = draggable<Snap>(handle, doc, {
        onStart: (e) => {
          handle.classList.add('dragging');
          opts.setKeyboardQuadSelection(corner);
          const state = ctrl.getState();
          e.stopPropagation();
          e.preventDefault();
          return {
            startX: e.clientX,
            startY: e.clientY,
            initialPoint: { ...ctrl.getActiveQuad()[corner] },
            canvasW: state.canvas.width,
            canvasH: state.canvas.height,
          };
        },
        onMove: (e, snap) => {
          // parent（canvas-window）は active output が切り替わると別要素になるので毎回引く
          const parent = container.parentElement;
          if (!parent) return;
          const parentRect = parent.getBoundingClientRect();
          if (parentRect.width <= 0 || parentRect.height <= 0) return;
          const dx = ((e.clientX - snap.startX) / parentRect.width) * snap.canvasW;
          const dy = ((e.clientY - snap.startY) / parentRect.height) * snap.canvasH;
          const q = ctrl.getActiveQuad();
          ctrl.setActiveQuad({
            ...q,
            [corner]: { x: snap.initialPoint.x + dx, y: snap.initialPoint.y + dy },
          });
          this.refreshTransform();
          ctrl.commit();
        },
        onEnd: () => {
          handle.classList.remove('dragging');
        },
      });
      this.cleanups.push(dispose);
    }
  }

  /**
   * 4 隅ハンドルは canvas-handles（canvas-host 内、canvas px サイズ）直下に置かれる。
   * 位置は仮想キャンバス px そのまま。親の scale でハンドルも縮拡されるが、CSS で
   * `transform: scale(var(--canvas-counter-scale))` を当てて 14px に保つ。
   */
  private updateQuadHandlePositions(quad: Quad): void {
    for (const handle of this.handles) {
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) continue;
      const p = quad[corner];
      handle.style.left = `${p.x}px`;
      handle.style.top = `${p.y}px`;
    }
  }

  // ── resize observer ───────────────────────────────────────────

  private setupResizeObserver(): void {
    const win = this.win;
    if (!win) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeRafId !== null) return;
      this.resizeRafId = win.requestAnimationFrame(() => {
        this.resizeRafId = null;
        this.refreshTransform();
      });
    });
    this.rebindResizeObserver();
  }

  private rebindResizeObserver(): void {
    if (!this.resizeObserver || !this.croppedContainer) return;
    const newArea = this.croppedContainer.parentElement;
    if (newArea === this.observedArea) return;
    if (this.observedArea) {
      try { this.resizeObserver.unobserve(this.observedArea); } catch { /* ignore */ }
    }
    if (newArea) this.resizeObserver.observe(newArea);
    this.observedArea = newArea;
  }

  // ── stream bind ───────────────────────────────────────────────

  /** mapping-video が持つストリームを cropped-video に共有 bind し、clip-path も初期化。 */
  private setupCroppedVideoStream(): void {
    if (!this.croppedVideo) return;
    if (!this.mappingVideo) {
      this.mappingVideo = this.scope?.querySelector('#mapping-video') as HTMLVideoElement;
    }
    if (!this.mappingVideo) return;

    if (this.mappingVideo.srcObject && !this.croppedVideo.srcObject) {
      this.croppedVideo.srcObject = this.mappingVideo.srcObject;

      this.croppedVideo.addEventListener('loadedmetadata', () => {
        const v = this.croppedVideo!;
        this.opts?.onCroppedVideoMetadata?.({
          width: v.videoWidth || 1920,
          height: v.videoHeight || 1080,
        });
        this.refreshVideoCrop();
      }, { once: true });
    }

    this.refreshVideoCrop();
  }
}

