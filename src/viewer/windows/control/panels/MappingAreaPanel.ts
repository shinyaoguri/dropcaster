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
  quadCentroid,
  rotateQuadAround,
  scaleQuadAround,
  translateQuad,
  type CornerKey,
  type Point,
  type Quad,
} from '../../../utils/mappingTransform';
import { CleanupStack } from '../../../utils/cleanupStack';
import { RafThrottle } from '../../../utils/rafThrottle';
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
  /** 全体スケール（中心固定）と全体回転（中心固定）の追加ハンドル。重心に配置。 */
  private scaleHandle: HTMLDivElement | null = null;
  private rotateHandle: HTMLDivElement | null = null;
  private cleanups = new CleanupStack();
  private resizeObserver: ResizeObserver | null = null;
  private observedArea: HTMLElement | null = null;
  /** observedArea の resize → refreshTransform を 1 frame 1 回に間引く throttle。setupResizeObserver で初期化。 */
  private resizeThrottle: RafThrottle | null = null;
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
    this.setupScaleHandle();
    this.setupRotateHandle();
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
    this.scaleHandle?.style.setProperty('--mapping-color', activeColor);
    this.rotateHandle?.style.setProperty('--mapping-color', activeColor);

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

  destroy(): void {
    this.cleanups.runAll();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observedArea = null;
    this.resizeThrottle?.cancel();
    this.resizeThrottle = null;
    if (this.streamSetupTimeout !== null && this.win) {
      this.win.clearTimeout(this.streamSetupTimeout);
      this.streamSetupTimeout = null;
    }
    this.croppedContainer?.remove();
    for (const h of this.handles) h.remove();
    this.handles = [];
    this.scaleHandle?.remove();
    this.scaleHandle = null;
    this.rotateHandle?.remove();
    this.rotateHandle = null;
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

    // 全体スケール（重心固定の uniform scale）と全体回転（重心固定）の追加ハンドル。
    // 重心に配置する。rotate ハンドルは CSS transform で screen-px 単位の固定オフセットを
    // 載せて、重心の少し上に表示される。
    this.scaleHandle = doc.createElement('div');
    this.scaleHandle.className = 'quad-handle quad-handle-scale';
    this.scaleHandle.title = '全体を拡大縮小（形は維持）';

    this.rotateHandle = doc.createElement('div');
    this.rotateHandle.className = 'quad-handle quad-handle-rotate';
    this.rotateHandle.title = '全体を回転（形は維持）';
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
    if (this.scaleHandle && this.scaleHandle.parentElement !== canvasHandles) {
      canvasHandles.appendChild(this.scaleHandle);
    }
    if (this.rotateHandle && this.rotateHandle.parentElement !== canvasHandles) {
      canvasHandles.appendChild(this.rotateHandle);
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
      // active output（あれば）の中央 25..75% に戻す。無ければ outputs[0]、それも無ければ canvas 中央。
      const state = ctrl.getState();
      const target =
        state.outputs.find(o => o.id === state.activeOutputId)
        ?? state.outputs[0];
      ctrl.setActiveQuad(defaultQuad(target));
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
   *
   * scale ハンドルは top 辺の中点（TL と TR の中央）、rotate ハンドルは right 辺の中点
   * （TR と BR の中央）に配置。quad が回転・変形しても辺の中点なので一緒に追従する。
   * 拡大縮小・回転の中心は quad の重心（drag handler 側で固定）なので、ハンドルの
   * 視覚位置と変形の中心は別物。
   */
  private updateQuadHandlePositions(quad: Quad): void {
    for (const handle of this.handles) {
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) continue;
      const p = quad[corner];
      handle.style.left = `${p.x}px`;
      handle.style.top = `${p.y}px`;
    }
    if (this.scaleHandle) {
      const mx = (quad.topLeft.x + quad.topRight.x) / 2;
      const my = (quad.topLeft.y + quad.topRight.y) / 2;
      this.scaleHandle.style.left = `${mx}px`;
      this.scaleHandle.style.top = `${my}px`;
    }
    if (this.rotateHandle) {
      const mx = (quad.topRight.x + quad.bottomRight.x) / 2;
      const my = (quad.topRight.y + quad.bottomRight.y) / 2;
      this.rotateHandle.style.left = `${mx}px`;
      this.rotateHandle.style.top = `${my}px`;
    }
  }

  /**
   * canvas-mappings 親（canvas-host 内の canvas-px レイヤ）の bounding rect から、
   * クライアント px → canvas px の変換係数を返す。drag onMove で使う。
   */
  private clientToCanvas(e: MouseEvent, parent: HTMLElement): Point | null {
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ctrl = this.ctrl;
    if (!ctrl) return null;
    const state = ctrl.getState();
    return {
      x: ((e.clientX - rect.left) / rect.width) * state.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * state.canvas.height,
    };
  }

  /** 重心固定の uniform scale ハンドル。drag 距離の比率を quad 全体に適用する。 */
  private setupScaleHandle(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    const handle = this.scaleHandle;
    if (!doc || !ctrl || !handle) return;

    type Snap = {
      initialQuad: Quad;
      center: Point;
      initialDist: number;
    };
    const dispose = draggable<Snap>(handle, doc, {
      onStart: (e) => {
        const container = this.croppedContainer;
        const parent = container?.parentElement;
        if (!parent) return null;
        const initialQuad = cloneQuad(ctrl.getActiveQuad());
        const center = quadCentroid(initialQuad);
        const mouseCanvas = this.clientToCanvas(e, parent);
        if (!mouseCanvas) return null;
        const initialDist = Math.hypot(mouseCanvas.x - center.x, mouseCanvas.y - center.y);
        // ハンドルは重心ぴったりなので initialDist は基本的に 0 に近い → 最小値でクランプ。
        // クランプしないと最初の dx で巨大スケールが計算されて quad が爆発する。
        const safeDist = Math.max(initialDist, 1e-3);
        handle.classList.add('dragging');
        e.stopPropagation();
        e.preventDefault();
        return { initialQuad, center, initialDist: safeDist };
      },
      onMove: (e, snap) => {
        const container = this.croppedContainer;
        const parent = container?.parentElement;
        if (!parent) return;
        const mouseCanvas = this.clientToCanvas(e, parent);
        if (!mouseCanvas) return;
        const dist = Math.hypot(mouseCanvas.x - snap.center.x, mouseCanvas.y - snap.center.y);
        // 比率は ratio = dist / initialDist。極端な縮小（quad 退化）と無限大を防ぐためにクランプ。
        const ratio = Math.max(0.05, dist / snap.initialDist);
        ctrl.setActiveQuad(scaleQuadAround(snap.initialQuad, snap.center, ratio));
        this.refreshTransform();
        ctrl.commit();
      },
      onEnd: () => {
        handle.classList.remove('dragging');
      },
    });
    this.cleanups.push(dispose);
  }

  /** 重心固定の uniform rotation ハンドル。drag 中の mouse 角度差分を quad 全体に適用する。 */
  private setupRotateHandle(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    const handle = this.rotateHandle;
    if (!doc || !ctrl || !handle) return;

    type Snap = {
      initialQuad: Quad;
      center: Point;
      initialAngle: number;
    };
    const dispose = draggable<Snap>(handle, doc, {
      onStart: (e) => {
        const container = this.croppedContainer;
        const parent = container?.parentElement;
        if (!parent) return null;
        const initialQuad = cloneQuad(ctrl.getActiveQuad());
        const center = quadCentroid(initialQuad);
        const mouseCanvas = this.clientToCanvas(e, parent);
        if (!mouseCanvas) return null;
        const initialAngle = Math.atan2(mouseCanvas.y - center.y, mouseCanvas.x - center.x);
        handle.classList.add('dragging');
        e.stopPropagation();
        e.preventDefault();
        return { initialQuad, center, initialAngle };
      },
      onMove: (e, snap) => {
        const container = this.croppedContainer;
        const parent = container?.parentElement;
        if (!parent) return;
        const mouseCanvas = this.clientToCanvas(e, parent);
        if (!mouseCanvas) return;
        const angle = Math.atan2(mouseCanvas.y - snap.center.y, mouseCanvas.x - snap.center.x);
        const delta = angle - snap.initialAngle;
        ctrl.setActiveQuad(rotateQuadAround(snap.initialQuad, snap.center, delta));
        this.refreshTransform();
        ctrl.commit();
      },
      onEnd: () => {
        handle.classList.remove('dragging');
      },
    });
    this.cleanups.push(dispose);
  }

  // ── resize observer ───────────────────────────────────────────

  private setupResizeObserver(): void {
    const win = this.win;
    if (!win) return;
    this.resizeThrottle = new RafThrottle(win, () => this.refreshTransform());
    this.resizeObserver = new ResizeObserver(() => this.resizeThrottle?.schedule());
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

