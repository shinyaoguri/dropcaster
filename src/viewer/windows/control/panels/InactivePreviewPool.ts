/**
 * 非 active な mapping の preview-mapping div / video を作成・更新・削除する pool。
 *
 * 各 preview は共有 canvas-mappings レイヤに置く（出力単位ではなく全 output 共通）。
 * 出力の境界外まで延びた quad もそのまま見える（mapping window の overflow:hidden で
 * 出力 frame に閉じ込めない）。active mapping のコンテナは MappingAreaPanel が同じ親に
 * mount する想定で、その手前に挿入することで「active が上、inactive が下」のレイヤ順を維持する。
 *
 * クリックでその mapping を active 化（onActivate コールバック）。
 *
 * 入力（index, quad, source, canvas 寸法）が前回と同じなら DOM を触らない
 * signature memoize 付き — active な quad のドラッグ中に毎フレーム全 inactive preview を
 * 再 warp するのを防ぐ。
 */

import {
  applyQuadCanvas,
  applyVideoCrop,
  mappingColor,
  type MappingsState,
} from '../../../utils/mappingTransform';

interface PreviewEntry {
  div: HTMLDivElement;
  video: HTMLVideoElement;
  sig: string;
}

export interface InactivePreviewPoolAttachOptions {
  getSourceVideo: () => HTMLVideoElement | null;
  /** active mapping を覆っているコンテナ。同じ親に居れば直前に挿入してレイヤ順を保つ。 */
  getActiveContainer: () => HTMLDivElement | null;
  /** 共有 canvas-mappings レイヤ（全 inactive preview の mount 先）。 */
  getMappingsLayer: () => HTMLElement | null;
  onActivate: (mappingId: string) => void;
}

export class InactivePreviewPool {
  private doc: Document | null = null;
  private opts: InactivePreviewPoolAttachOptions | null = null;
  private previews = new Map<string, PreviewEntry>();

  attach(doc: Document, opts: InactivePreviewPoolAttachOptions): void {
    this.doc = doc;
    this.opts = opts;
  }

  sync(state: MappingsState): void {
    const doc = this.doc;
    const opts = this.opts;
    if (!doc || !opts) return;

    const stage = opts.getMappingsLayer();
    if (!stage) return; // canvas-mappings レイヤがまだ無い（OutputVizPanel 組み立て前）

    const activeContainer = opts.getActiveContainer();

    const inactiveIds = new Set(
      state.mappings.filter(m => m.id !== state.activeId).map(m => m.id),
    );

    // 不要になった preview を削除（消滅・active 化）
    for (const [id, { div }] of this.previews) {
      if (!inactiveIds.has(id)) {
        div.remove();
        this.previews.delete(id);
      }
    }

    // 各非 active mapping を反映
    for (let i = 0; i < state.mappings.length; i++) {
      const m = state.mappings[i];
      if (m.id === state.activeId) continue;

      let entry = this.previews.get(m.id);
      if (!entry || entry.div.parentElement !== stage) {
        if (entry) entry.div.remove();
        const div = doc.createElement('div');
        div.className = 'preview-mapping inactive';
        div.dataset.mappingId = m.id;
        const video = doc.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        div.appendChild(video);
        // active container と同じ親（canvas-mappings）なら、その手前に挿入してレイヤ順を保つ
        if (activeContainer && activeContainer.parentElement === stage) {
          stage.insertBefore(div, activeContainer);
        } else {
          stage.appendChild(div);
        }
        // クリックで active 化（drag は不可）
        div.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          opts.onActivate(m.id);
        });
        this.bindStream(video);
        entry = { div, video, sig: '' };
        this.previews.set(m.id, entry);
      }

      // 入力（index ＝色, quad, source, canvas 寸法）が前回と同じなら DOM を触らない。
      const sig = `${state.canvas.width}x${state.canvas.height}|${i}|${m.quad.topLeft.x},${m.quad.topLeft.y},${m.quad.topRight.x},${m.quad.topRight.y},${m.quad.bottomRight.x},${m.quad.bottomRight.y},${m.quad.bottomLeft.x},${m.quad.bottomLeft.y}|${m.source.x},${m.source.y},${m.source.width},${m.source.height}`;
      if (sig !== entry.sig) {
        entry.sig = sig;
        entry.div.style.setProperty('--mapping-color', mappingColor(i));
        entry.div.style.width = `${state.canvas.width}px`;
        entry.div.style.height = `${state.canvas.height}px`;
        applyQuadCanvas(entry.div, m.quad, state.canvas.width, state.canvas.height);
        applyVideoCrop(entry.video, m.source);
      }
    }
  }

  /** sourceVideo の srcObject が後から確定／差し替えになった時に、保持中の preview に再 bind する。 */
  rebindStreams(): void {
    this.previews.forEach(({ video }) => this.bindStream(video));
  }

  destroy(): void {
    this.previews.forEach(({ div }) => div.remove());
    this.previews.clear();
    this.doc = null;
    this.opts = null;
  }

  private bindStream(video: HTMLVideoElement): void {
    const src = this.opts?.getSourceVideo();
    if (!src || !src.srcObject) return;
    if (video.srcObject === src.srcObject) return;
    video.srcObject = src.srcObject;
    video.play().catch(error => {
      console.warn('InactivePreviewPool: inactive preview の再生失敗', error);
    });
  }
}
