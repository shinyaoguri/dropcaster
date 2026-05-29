/**
 * ソースカラムの選択ボックス (#selection-box) — ドラッグ移動と 4 隅 + 4 辺のリサイズ、
 * リセットボタン (#reset-source-btn)、初期全選択を担当する panel。
 *
 * state mutation は MappingsController 経由（mutateActiveSource for drag/resize,
 * setActiveSource for reset/init）。selectionBox の DOM 描画は state push 後に
 * refresh() が呼ばれる契約。
 *
 * source 変更は mapping 側プレビュー（#cropped-video の clip-path / 非 active
 * preview の warp signature）にも波及するので、変更通知は `onSourceChanged`
 * コールバックで親へ送り、親が他 panel へファンアウトする。
 */

import type { SourceRect } from '../../../utils/mappingTransform';
import { CleanupStack } from '../../../utils/cleanupStack';
import type { MappingsController } from '../MappingsController';
import { draggable } from '../utils/draggable';

export interface SourceCropPanelAttachOptions {
  getSourceVideo: () => HTMLVideoElement | null;
  /** ドラッグ／リサイズ／リセット完了時に呼ばれる（updateVideoCrop + syncInactivePreviews + updateToolValues 相当）。 */
  onSourceChanged: () => void;
  /** mousedown 時に「source 矩形を矢印キー nudge 対象に設定」する callback。 */
  setKeyboardSourceSelection: () => void;
}

const MIN_SIZE = 5;

export class SourceCropPanel {
  private scope: HTMLElement | null = null;
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: SourceCropPanelAttachOptions | null = null;
  private selectionBox: HTMLDivElement | null = null;
  private cleanups = new CleanupStack();

  attach(scope: HTMLElement, doc: Document, ctrl: MappingsController, opts: SourceCropPanelAttachOptions): void {
    this.scope = scope;
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;
    this.selectionBox = scope.querySelector('#selection-box') as HTMLDivElement | null;

    this.wireResetButton();

    const sourceVideo = opts.getSourceVideo();
    if (sourceVideo) {
      // metadata 発火時は selectionBox を最新 state に追随させるだけ。
      // 新規 mapping の source 初期値は withAddedMapping() が {0,0,100,100} を入れているので、
      // ここで再初期化すると保存済みクロップを上書きしてしまう。
      const onLoadedMeta = () => {
        this.refresh();
      };
      sourceVideo.addEventListener('loadedmetadata', onLoadedMeta);
      this.cleanups.push(() => sourceVideo.removeEventListener('loadedmetadata', onLoadedMeta));
    }

    this.setupDragHandlers();
    this.setupResizeHandlers();
  }

  /** ctrl の最新 source rect を読んで selectionBox の left/top/width/height を再描画。 */
  refresh(): void {
    const box = this.selectionBox;
    const ctrl = this.ctrl;
    if (!box || !ctrl) return;
    const s = ctrl.getActiveSource();
    box.style.left = `${s.x}%`;
    box.style.top = `${s.y}%`;
    box.style.width = `${s.width}%`;
    box.style.height = `${s.height}%`;
  }

  /** selectionBox 要素を外から取りたいときに使う（keyboard nudge の選択 UI 用）。 */
  getSelectionBox(): HTMLDivElement | null { return this.selectionBox; }

  destroy(): void {
    this.cleanups.runAll();
    this.scope = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
    this.selectionBox = null;
  }

  private wireResetButton(): void {
    const scope = this.scope;
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!scope || !ctrl || !opts) return;
    const btn = scope.querySelector('#reset-source-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      ctrl.setActiveSource({ x: 0, y: 0, width: 100, height: 100 });
      this.refresh();
      opts.onSourceChanged();
      ctrl.commit();
    });
  }

  /** ボックス本体（ハンドル除く）のドラッグで平行移動。 */
  private setupDragHandlers(): void {
    const box = this.selectionBox;
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!box || !doc || !ctrl || !opts) return;

    type Snap = { startX: number; startY: number; initialX: number; initialY: number };
    const dispose = draggable<Snap>(box, doc, {
      onStart: (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('handle') || target.classList.contains('edge')) return null;
        opts.setKeyboardSourceSelection();
        const s = ctrl.getActiveSource();
        e.preventDefault();
        return { startX: e.clientX, startY: e.clientY, initialX: s.x, initialY: s.y };
      },
      onMove: (e, snap) => {
        const video = opts.getSourceVideo();
        if (!video) return;
        const rect = video.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const dx = ((e.clientX - snap.startX) / rect.width) * 100;
        const dy = ((e.clientY - snap.startY) / rect.height) * 100;
        ctrl.mutateActiveSource((s) => {
          s.x = Math.max(0, Math.min(100 - s.width,  snap.initialX + dx));
          s.y = Math.max(0, Math.min(100 - s.height, snap.initialY + dy));
        });
        this.refresh();
        opts.onSourceChanged();
        ctrl.commit();
      },
    });
    this.cleanups.push(dispose);
  }

  /** 4 隅・4 辺ハンドルでのリサイズ。data-handle / data-edge で方向を判別。 */
  private setupResizeHandlers(): void {
    const box = this.selectionBox;
    const doc = this.doc;
    const ctrl = this.ctrl;
    const opts = this.opts;
    if (!box || !doc || !ctrl || !opts) return;

    const handles = box.querySelectorAll<HTMLElement>('.handle, .edge');
    handles.forEach(handle => {
      const handleType = handle.dataset.handle || handle.dataset.edge;
      if (!handleType) return;

      type Snap = { startX: number; startY: number; initial: SourceRect };
      const dispose = draggable<Snap>(handle, doc, {
        onStart: (e) => {
          opts.setKeyboardSourceSelection();
          e.stopPropagation();
          e.preventDefault();
          const s = ctrl.getActiveSource();
          return {
            startX: e.clientX,
            startY: e.clientY,
            initial: { x: s.x, y: s.y, width: s.width, height: s.height },
          };
        },
        onMove: (e, snap) => {
          const video = opts.getSourceVideo();
          if (!video) return;
          const rect = video.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const dx = ((e.clientX - snap.startX) / rect.width) * 100;
          const dy = ((e.clientY - snap.startY) / rect.height) * 100;
          const initial = snap.initial;
          ctrl.mutateActiveSource((s) => {
            switch (handleType) {
              case 'nw':
                s.x = Math.max(0, Math.min(initial.x + initial.width - MIN_SIZE, initial.x + dx));
                s.y = Math.max(0, Math.min(initial.y + initial.height - MIN_SIZE, initial.y + dy));
                s.width = initial.width - (s.x - initial.x);
                s.height = initial.height - (s.y - initial.y);
                break;
              case 'ne':
                s.y = Math.max(0, Math.min(initial.y + initial.height - MIN_SIZE, initial.y + dy));
                s.width = Math.max(MIN_SIZE, Math.min(100 - initial.x, initial.width + dx));
                s.height = initial.height - (s.y - initial.y);
                break;
              case 'sw':
                s.x = Math.max(0, Math.min(initial.x + initial.width - MIN_SIZE, initial.x + dx));
                s.width = initial.width - (s.x - initial.x);
                s.height = Math.max(MIN_SIZE, Math.min(100 - initial.y, initial.height + dy));
                break;
              case 'se':
                s.width = Math.max(MIN_SIZE, Math.min(100 - initial.x, initial.width + dx));
                s.height = Math.max(MIN_SIZE, Math.min(100 - initial.y, initial.height + dy));
                break;
              case 'n':
                s.y = Math.max(0, Math.min(initial.y + initial.height - MIN_SIZE, initial.y + dy));
                s.height = initial.height - (s.y - initial.y);
                break;
              case 'e':
                s.width = Math.max(MIN_SIZE, Math.min(100 - initial.x, initial.width + dx));
                break;
              case 's':
                s.height = Math.max(MIN_SIZE, Math.min(100 - initial.y, initial.height + dy));
                break;
              case 'w':
                s.x = Math.max(0, Math.min(initial.x + initial.width - MIN_SIZE, initial.x + dx));
                s.width = initial.width - (s.x - initial.x);
                break;
            }
          });
          this.refresh();
          opts.onSourceChanged();
          ctrl.commit();
        },
      });
      this.cleanups.push(dispose);
    });
  }
}
