/**
 * マッピングカラム（warp 後プレビュー）の panel。
 *
 * 担当:
 *   - active mapping の quad 4 隅 (.quad-handle) を独立に動かしてホモグラフィー変形
 *   - cropped-container 本体のドラッグで quad 全体を平行移動
 *   - #reset-mapping-btn でデフォルト quad に戻す
 *   - #mapping-area の寸法変化（カラムリサイザ追従）に応じた matrix3d 再計算
 *   - クロップ済み <video> へのストリーム bind と source rect クロップの適用
 *
 * state mutation は MappingsController 経由。drag は utils/draggable で document
 * listener のリーク対策が組み込まれている。
 *
 * 「quad が変わった」副次効果（非 active プレビューの同期・ツール値の再描画）は
 * onQuadChanged コールバックで親に通知する。
 */

import {
  CORNER_KEYS,
  applyQuadTransform,
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
  private cleanups: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private resizeRafId: number | null = null;
  private streamSetupTimeout: number | null = null;

  attach(scope: HTMLElement, doc: Document, win: Window, ctrl: MappingsController, opts: MappingAreaPanelAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.win = win;
    this.ctrl = ctrl;
    this.opts = opts;
    this.croppedContainer = scope.querySelector('#cropped-container') as HTMLDivElement | null;
    this.croppedVideo = scope.querySelector('#cropped-video') as HTMLVideoElement | null;
    this.mappingVideo = scope.querySelector('#mapping-video') as HTMLVideoElement | null;

    if (!this.croppedContainer || !this.croppedVideo) return;

    this.wireResetButton();
    this.setupQuadBodyDrag();
    this.setupQuadHandles();
    this.refreshTransform();
    this.observeAreaResize();

    // ストリームが MappingStream 経由で届くのを待ってから bind
    this.streamSetupTimeout = win.setTimeout(() => {
      this.streamSetupTimeout = null;
      this.setupCroppedVideoStream();
    }, 1000);
  }

  /** quad の matrix3d / mapping color / 4 隅ハンドル位置 / video clip-path を全部最新化。 */
  refreshTransform(): void {
    const ctrl = this.ctrl;
    const scope = this.scope;
    if (!ctrl || !scope || !this.croppedContainer) return;

    const quad = ctrl.getActiveQuad();
    applyQuadTransform(this.croppedContainer, quad);

    // active な mapping の色を CSS 変数として伝播
    const state = ctrl.getState();
    const activeIdx = state.mappings.findIndex(m => m.id === state.activeId);
    const activeColor = mappingColor(activeIdx >= 0 ? activeIdx : 0);
    this.croppedContainer.style.setProperty('--mapping-color', activeColor);
    scope
      .querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle')
      .forEach(h => h.style.setProperty('--mapping-color', activeColor));

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
  /** InactivePreviewPool の stage 用（cropped-container の親 = #mapping-area）。 */
  getStage(): HTMLElement | null { return this.croppedContainer?.parentElement ?? null; }
  /** ControlWindow が video の videoActualDimensions を更新するために使う。 */
  getCroppedVideo(): HTMLVideoElement | null { return this.croppedVideo; }

  destroy(): void {
    this.cleanups.forEach(off => { try { off(); } catch { /* ignore */ } });
    this.cleanups = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeRafId !== null && this.win) {
      this.win.cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    if (this.streamSetupTimeout !== null && this.win) {
      this.win.clearTimeout(this.streamSetupTimeout);
      this.streamSetupTimeout = null;
    }
    this.scope = null;
    this.doc = null;
    this.win = null;
    this.ctrl = null;
    this.opts = null;
    this.croppedContainer = null;
    this.croppedVideo = null;
    this.mappingVideo = null;
  }

  private wireResetButton(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    if (!scope || !ctrl) return;
    const btn = scope.querySelector('#reset-mapping-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      ctrl.setActiveQuad(defaultQuad());
      this.refreshTransform();
      ctrl.commit();
    });
  }

  /** cropped-container 本体（隅ハンドル以外）のドラッグで quad 全体を平行移動。 */
  private setupQuadBodyDrag(): void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    const container = this.croppedContainer;
    if (!doc || !ctrl || !opts || !container) return;

    type Snap = { startX: number; startY: number; initialQuad: Quad; parent: HTMLElement };
    const dispose = draggable<Snap>(container, doc, {
      onStart: (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('quad-handle')) return null;
        // 隅ハンドルではなく quad 本体のドラッグ — 隅の矢印キー選択は解除
        opts.clearKeyboardSelection();
        const parent = container.parentElement;
        if (!parent) return null;
        e.preventDefault();
        return {
          startX: e.clientX,
          startY: e.clientY,
          initialQuad: cloneQuad(ctrl.getActiveQuad()),
          parent,
        };
      },
      onMove: (e, snap) => {
        const parentRect = snap.parent.getBoundingClientRect();
        if (parentRect.width <= 0 || parentRect.height <= 0) return;
        const dx = ((e.clientX - snap.startX) / parentRect.width) * 100;
        const dy = ((e.clientY - snap.startY) / parentRect.height) * 100;
        ctrl.setActiveQuad(translateQuad(snap.initialQuad, dx, dy));
        this.refreshTransform();
        ctrl.commit();
      },
    });
    this.cleanups.push(dispose);
  }

  /** 4 隅ハンドルそれぞれを独立に動かしてホモグラフィー変形を作る。 */
  private setupQuadHandles(): void {
    const scope = this.scope;
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    const container = this.croppedContainer;
    if (!scope || !doc || !ctrl || !opts || !container) return;
    const parent = container.parentElement;
    if (!parent) return;

    const handles = scope.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle');
    handles.forEach(handle => {
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) return;

      type Snap = { startX: number; startY: number; initialPoint: { x: number; y: number } };
      const dispose = draggable<Snap>(handle, doc, {
        onStart: (e) => {
          handle.classList.add('dragging');
          opts.setKeyboardQuadSelection(corner);
          e.stopPropagation();
          e.preventDefault();
          return {
            startX: e.clientX,
            startY: e.clientY,
            initialPoint: { ...ctrl.getActiveQuad()[corner] },
          };
        },
        onMove: (e, snap) => {
          const parentRect = parent.getBoundingClientRect();
          if (parentRect.width <= 0 || parentRect.height <= 0) return;
          const dx = ((e.clientX - snap.startX) / parentRect.width) * 100;
          const dy = ((e.clientY - snap.startY) / parentRect.height) * 100;
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
    });
  }

  private updateQuadHandlePositions(quad: Quad): void {
    const scope = this.scope;
    if (!scope) return;
    scope.querySelectorAll<HTMLDivElement>('.mapping-column .quad-handle').forEach(handle => {
      const corner = handle.dataset.corner as CornerKey | undefined;
      if (!corner || !CORNER_KEYS.includes(corner)) return;
      const p = quad[corner];
      handle.style.left = `${p.x}%`;
      handle.style.top = `${p.y}%`;
    });
  }

  /**
   * #mapping-area の寸法変化を監視して matrix3d を再計算する。カラムリサイザの
   * 幅変更に追従させるため。matrix3d は親の getBoundingClientRect ベースで毎回
   * 計算するので、ピクセル寸法が変わったらやり直さないと warp が静止したまま
   * %ベースのハンドル位置だけずれて見える。
   */
  private observeAreaResize(): void {
    const target = this.scope?.querySelector('#mapping-area') as HTMLElement | null;
    const win = this.win;
    if (!target || !win) return;

    this.resizeObserver = new ResizeObserver(() => {
      // 1 frame に 1 回へコアレス（ドラッグ中の連続発火対策）
      if (this.resizeRafId !== null) return;
      this.resizeRafId = win.requestAnimationFrame(() => {
        this.resizeRafId = null;
        this.refreshTransform();
      });
    });
    this.resizeObserver.observe(target);
  }

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
