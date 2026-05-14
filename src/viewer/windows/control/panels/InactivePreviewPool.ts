/**
 * 非 active な mapping の preview-mapping div / video を作成・更新・削除する pool。
 *
 * cropped-container（active 用の DOM）の前に挿入することで、active プレビューが
 * 上に描画されるレイヤ順を維持する。クリックでその mapping を active 化（onActivate
 * コールバック）。state は ControlWindow が保持しているので、sync() は呼び出し側が
 * state が変わったタイミングで明示的に投げる。
 *
 * 入力（index, quad, source, stage ピクセルサイズ）が前回と同じなら DOM を触らない
 * signature memoize 付き — active な quad のドラッグ中に毎フレーム全 inactive preview を
 * 再 warp するのを防ぐ。
 */

import {
  applyQuadTransform,
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
  getActiveContainer: () => HTMLDivElement | null;
  onActivate: (mappingId: string) => void;
}

export class InactivePreviewPool {
  private stage: HTMLElement | null = null;
  private doc: Document | null = null;
  private opts: InactivePreviewPoolAttachOptions | null = null;
  private previews = new Map<string, PreviewEntry>();

  attach(stage: HTMLElement, doc: Document, opts: InactivePreviewPoolAttachOptions): void {
    this.stage = stage;
    this.doc = doc;
    this.opts = opts;
  }

  sync(state: MappingsState): void {
    const stage = this.stage;
    const doc = this.doc;
    const opts = this.opts;
    if (!stage || !doc || !opts) return;

    const activeContainer = opts.getActiveContainer();
    const stageRect = stage.getBoundingClientRect();
    const stageSig = `${Math.round(stageRect.width)}x${Math.round(stageRect.height)}`;

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
      if (!entry) {
        const div = doc.createElement('div');
        div.className = 'preview-mapping inactive';
        div.dataset.mappingId = m.id;
        const video = doc.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        div.appendChild(video);
        // active container の前 = 描画上は active より後ろ
        if (activeContainer) {
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

      // 入力（index ＝色, quad, source, ステージサイズ）が前回と同じなら DOM を触らない。
      const sig = `${stageSig}|${i}|${m.quad.topLeft.x},${m.quad.topLeft.y},${m.quad.topRight.x},${m.quad.topRight.y},${m.quad.bottomRight.x},${m.quad.bottomRight.y},${m.quad.bottomLeft.x},${m.quad.bottomLeft.y}|${m.source.x},${m.source.y},${m.source.width},${m.source.height}`;
      if (sig !== entry.sig) {
        entry.sig = sig;
        entry.div.style.setProperty('--mapping-color', mappingColor(i));
        applyQuadTransform(entry.div, m.quad);
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
    this.stage = null;
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
