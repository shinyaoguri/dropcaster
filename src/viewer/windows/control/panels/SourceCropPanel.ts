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
 *
 * 非 active な mapping の source 矩形も、一覧と同じ識別色の点線枠と表示名で #selection-box の
 * 背面に描く（どこを切り出しているかを同時に見るため）。クリックでその mapping を active にする
 * （マッピングカラムの非 active プレビューと同じ操作）。枠は id キーで使い回す。
 */

import type { SourceRect } from '../../../utils/mappingTransform';
import {
  getActiveMapping,
  isMappingEnabled,
  isMaskEntry,
  mappingColor,
  mappingDisplayNames,
} from '../../../utils/mappingTransform';
import { CleanupStack } from '../../../utils/cleanupStack';
import type { MappingsController } from '../MappingsController';
import { draggable } from '../utils/draggable';
import type { ViewGeometry, ViewZoom } from '../../../utils/viewZoom';
import { attachZoomPan, type ZoomPanHandle } from '../utils/zoomPan';

export interface SourceCropPanelAttachOptions {
  getSourceVideo: () => HTMLVideoElement | null;
  /** ドラッグ／リサイズ／リセット完了時に呼ばれる（updateVideoCrop + syncInactivePreviews + updateToolValues 相当）。 */
  onSourceChanged: () => void;
  /** mousedown 時に「source 矩形を矢印キー nudge 対象に設定」する callback。 */
  setKeyboardSourceSelection: () => void;
  /** 非 active な mapping の枠がクリックされたときに呼ばれる（その mapping を active にする）。 */
  onActivate: (id: string) => void;
}

interface InactiveBox {
  box: HTMLDivElement;
  label: HTMLSpanElement;
}

const MIN_SIZE = 5;

export class SourceCropPanel {
  private scope: HTMLElement | null = null;
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: SourceCropPanelAttachOptions | null = null;
  private selectionBox: HTMLDivElement | null = null;
  /** 非 active な mapping の source 枠（mapping id → DOM）。 */
  private inactiveBoxes = new Map<string, InactiveBox>();
  private cleanups = new CleanupStack();
  /** ソースの表示の拡大・パン（表示だけ。source 矩形は % なので換算は不要）。 */
  private zoomPan: ZoomPanHandle | null = null;

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
    this.setupZoomPan();
  }

  /** 現在の拡大・パン（テスト・デバッグ用）。 */
  getView(): ViewZoom | null {
    return this.zoomPan?.getView() ?? null;
  }

  /**
   * ソース列の拡大・パン。.canvas-frame に translate + scale を当てる（中心基準）。
   * ドラッグの換算は video.getBoundingClientRect()（変換後の大きさ）で行っているので、
   * 拡大中も画面上の移動量どおりに source 矩形が動く。枠線・ハンドルの画面上の大きさは
   * --source-counter-scale で倍率を打ち消して一定に保つ。
   */
  private setupZoomPan(): void {
    const scope = this.scope;
    const doc = this.doc;
    if (!scope || !doc) return;
    const viewport = scope.querySelector<HTMLElement>('.source-column .video-container');
    const frame = scope.querySelector<HTMLElement>('.source-column .canvas-frame');
    if (!viewport || !frame) return;
    const getGeometry = (view: ViewZoom): ViewGeometry | null => {
      const vp = viewport.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      if (vp.width <= 0 || vp.height <= 0 || fr.width <= 0 || fr.height <= 0) return null;
      // 変換後の矩形から、全体表示のときの中心と寸法へ戻す（中心基準の scale なので中心は pan だけずれる）
      return {
        viewW: vp.width,
        viewH: vp.height,
        originX: fr.left + fr.width / 2 - vp.left - view.panX,
        originY: fr.top + fr.height / 2 - vp.top - view.panY,
        contentW: fr.width / view.zoom,
        contentH: fr.height / view.zoom,
      };
    };
    this.zoomPan = attachZoomPan(viewport, doc, {
      limits: { min: 1, max: 32 },
      getGeometry,
      onChange: (view) => {
        frame.style.transform = view.zoom === 1 && view.panX === 0 && view.panY === 0
          ? ''
          : `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
        frame.style.setProperty('--source-counter-scale', `${1 / view.zoom}`);
      },
    });
    const handle = this.zoomPan;
    this.cleanups.push(() => {
      handle.dispose();
      frame.style.transform = '';
      frame.style.removeProperty('--source-counter-scale');
    });
  }

  /** ctrl の最新 source rect を読んで selectionBox の left/top/width/height を再描画。 */
  refresh(): void {
    const box = this.selectionBox;
    const ctrl = this.ctrl;
    if (!box || !ctrl) return;
    // mask が active のときは選択中の source が無い。フォールバックの全面枠を出すと「何かが選択中」に
    // 見え、他の mapping の枠も覆ってクリックできなくなるので隠す。
    box.hidden = !getActiveMapping(ctrl.getState());
    const s = ctrl.getActiveSource();
    box.style.left = `${s.x}%`;
    box.style.top = `${s.y}%`;
    box.style.width = `${s.width}%`;
    box.style.height = `${s.height}%`;
    this.syncInactiveBoxes();
  }

  /** selectionBox 要素を外から取りたいときに使う（keyboard nudge の選択 UI 用）。 */
  getSelectionBox(): HTMLDivElement | null { return this.selectionBox; }

  destroy(): void {
    this.cleanups.runAll();
    for (const { box } of this.inactiveBoxes.values()) box.remove();
    this.inactiveBoxes.clear();
    this.scope = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
    this.selectionBox = null;
    this.zoomPan = null;
  }

  /**
   * 非 active な mapping の source 枠を state に合わせる。mask は source を持たないので描かない。
   * 枠は #selection-box の直前に置き、重なった部分では active の枠（ドラッグ・リサイズ）を優先する。
   * 非 active 同士は面積の大きい順に並べ、大きな枠の内側にある小さな枠もクリックできるようにする。
   */
  private syncInactiveBoxes(): void {
    const selectionBox = this.selectionBox;
    const overlay = selectionBox?.parentElement;
    const doc = this.doc;
    const ctrl = this.ctrl;
    if (!selectionBox || !overlay || !doc || !ctrl) return;
    const state = ctrl.getState();
    const names = mappingDisplayNames(state.mappings);
    const seen = new Set<string>();
    const ordered: { box: HTMLDivElement; label: HTMLSpanElement; area: number; corner: string }[] = [];
    state.mappings.forEach((m, idx) => {
      if (isMaskEntry(m) || m.id === state.activeId) return;
      seen.add(m.id);
      let entry = this.inactiveBoxes.get(m.id);
      if (!entry) entry = this.createInactiveBox(doc, m.id);
      const { box, label } = entry;
      ordered.push({
        box,
        label,
        area: m.source.width * m.source.height,
        corner: `${Math.round(m.source.x)},${Math.round(m.source.y)}`,
      });
      box.style.left = `${m.source.x}%`;
      box.style.top = `${m.source.y}%`;
      box.style.width = `${m.source.width}%`;
      box.style.height = `${m.source.height}%`;
      box.style.setProperty('--mapping-color', mappingColor(idx));
      box.classList.toggle('disabled', !isMappingEnabled(m));
      label.textContent = names[idx];
      box.title = names[idx];
    });
    // 同じ面積なら一覧の並び（配列の先頭ほど前面）に合わせる（sort は安定なので配列順を保つ）
    ordered.reverse().sort((a, b) => b.area - a.area);
    // 左上の角がほぼ同じ枠どうしはラベルが重なって背面の名前が読めないので、前面から順に 1 行ずつ下げる
    const stacked = new Map<string, number>();
    for (let i = ordered.length - 1; i >= 0; i--) {
      const { label, corner } = ordered[i];
      const n = stacked.get(corner) ?? 0;
      stacked.set(corner, n + 1);
      label.style.top = n === 0 ? '' : `${n * 1.3}em`;
    }
    const current = Array.from(overlay.querySelectorAll(':scope > .source-inactive-box'));
    const inOrder = current.length === ordered.length && ordered.every(({ box }, i) => current[i] === box);
    // ドラッグ中は毎フレーム呼ばれるので、順序が変わったときだけ DOM を動かす
    if (!inOrder) for (const { box } of ordered) overlay.insertBefore(box, selectionBox);
    for (const [id, { box }] of this.inactiveBoxes) {
      if (seen.has(id)) continue;
      box.remove();
      this.inactiveBoxes.delete(id);
    }
  }

  private createInactiveBox(doc: Document, id: string): InactiveBox {
    const box = doc.createElement('div');
    box.className = 'source-inactive-box';
    box.dataset.mappingId = id;
    const label = doc.createElement('span');
    label.className = 'source-inactive-label';
    box.appendChild(label);
    box.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.isPenDrafting()) return;
      e.preventDefault();
      e.stopPropagation();
      this.opts?.onActivate(id);
    });
    const entry = { box, label };
    this.inactiveBoxes.set(id, entry);
    return entry;
  }

  /** ペン描画中は他項目への切替をロックする（一覧・マッピングカラムと同じ）。 */
  private isPenDrafting(): boolean {
    const state = this.ctrl?.getState();
    if (!state) return false;
    const active = state.mappings.find(m => m.id === state.activeId);
    return !!active && isMaskEntry(active) && !!active.drafting;
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
    }, ctrl);
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
      }, ctrl);
      this.cleanups.push(dispose);
    });
  }
}
