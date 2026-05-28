/**
 * 非 active な mapping の preview-mapping / mask preview を作成・更新・削除する pool。
 *
 * 各 preview は共有 canvas-mappings レイヤに置く（出力単位ではなく全 output 共通）。
 * 出力の境界外まで延びた quad もそのまま見える（mapping window の overflow:hidden で
 * 出力 frame に閉じ込めない）。active mapping のコンテナは MappingAreaPanel が同じ親に
 * mount する。z-order は state.mappings の配列順に z-index で割り当てる（先頭ほど前面）。
 * mask は active/inactive にかかわらず常に黒多角形をここで描画する（vertex 編集ハンドルだけ
 * canvas-handles レイヤに別途載る）。
 *
 * クリックでその item を active 化（onActivate コールバック）。
 *
 * 入力（index, quad/source/points, canvas 寸法）が前回と同じなら DOM を触らない
 * signature memoize 付き — active な quad のドラッグ中に毎フレーム全 preview を
 * 再 warp するのを防ぐ。
 */

import {
  applyQuadCanvas,
  applyVideoCrop,
  isMaskEntry,
  mappingColor,
  type MappingsState,
} from '../../../utils/mappingTransform';

interface PreviewEntry {
  div: HTMLDivElement;
  /** mapping preview のみ存在（mask preview では undefined）。 */
  video?: HTMLVideoElement;
  /**
   * mask preview のみ存在。SVG polyline を使うことで:
   *   - drafting 中（stroke のみ）→ 最終頂点 → 最初の頂点を結ばない開いた折れ線として表示。
   *   - commit 後（fill あり）→ polyline の fill は implicit closing edge を埋めるので polygon
   *     と同じ塗りつぶしになる。
   */
  polyline?: SVGPolylineElement;
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
    const N = state.mappings.length;

    // mask は active でも描画する（vertex 編集ハンドルが上に乗るだけ）。
    // mapping は active を MappingAreaPanel に任せる（cropped-container が同じ DOM 位置に乗る）。
    const renderIds = new Set<string>();
    for (const m of state.mappings) {
      if (isMaskEntry(m)) renderIds.add(m.id);
      else if (m.id !== state.activeId) renderIds.add(m.id);
    }

    // 不要になった preview を削除
    for (const [id, { div }] of this.previews) {
      if (!renderIds.has(id)) {
        div.remove();
        this.previews.delete(id);
      }
    }

    // state.mappings は先頭ほど前面 → z-index は (N - i)（先頭が最大値）。
    // active container（cropped-container）にも同じルールで z-index を割り当てる。
    const svgNs = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < N; i++) {
      const m = state.mappings[i];
      const z = N - i;

      if (m.id === state.activeId && !isMaskEntry(m)) {
        // active mapping の cropped-container にも同じ順位の z-index を当てる
        if (activeContainer && activeContainer.parentElement === stage) {
          activeContainer.style.zIndex = String(z);
        }
        continue;
      }

      let entry = this.previews.get(m.id);

      if (isMaskEntry(m)) {
        const drafting = !!m.drafting;
        if (!entry || entry.div.parentElement !== stage || !entry.polyline) {
          if (entry) entry.div.remove();
          const div = doc.createElement('div');
          div.className = 'preview-mask';
          div.dataset.mappingId = m.id;
          const svg = doc.createElementNS(svgNs, 'svg') as SVGSVGElement;
          svg.setAttribute('preserveAspectRatio', 'none');
          const polyline = doc.createElementNS(svgNs, 'polyline') as SVGPolylineElement;
          svg.appendChild(polyline);
          div.appendChild(svg);
          stage.appendChild(div);
          // クリックで activate（drafting でない場合のみ；drafting 中の click は MaskEditPanel が canvas-host で受ける）
          div.addEventListener('mousedown', (e) => {
            if (m.id !== state.activeId) {
              e.stopPropagation();
              opts.onActivate(m.id);
            }
          });
          entry = { div, polyline, sig: '' };
          this.previews.set(m.id, entry);
        }
        const isActive = m.id === state.activeId;
        const sig = `mask|${state.canvas.width}x${state.canvas.height}|${i}|${isActive ? 1 : 0}|${drafting ? 'd' : 'c'}|${m.points.map(p => `${p.x},${p.y}`).join(';')}`;
        if (sig !== entry.sig) {
          entry.sig = sig;
          entry.div.classList.toggle('active', isActive);
          entry.div.classList.toggle('drafting', drafting);
          entry.div.style.zIndex = String(z);
          entry.div.style.width = `${state.canvas.width}px`;
          entry.div.style.height = `${state.canvas.height}px`;
          // リスト上の色（mappingColor by index）を CSS 変数で渡す。dev mode 時は CSS で
          // この色を polyline の stroke に当てる（commit 済み・drafting どちらも）。
          entry.div.style.setProperty('--mask-color', mappingColor(i));
          const svg = entry.div.querySelector('svg') as SVGSVGElement | null;
          if (svg) {
            svg.setAttribute('viewBox', `0 0 ${state.canvas.width} ${state.canvas.height}`);
            svg.setAttribute('width', `${state.canvas.width}`);
            svg.setAttribute('height', `${state.canvas.height}`);
          }
          entry.polyline!.setAttribute('points', m.points.map(p => `${p.x},${p.y}`).join(' '));
        }
        // drafting 中は pointer-events を切って canvas-host への click（頂点追加）を通す
        entry.div.style.pointerEvents = drafting ? 'none' : '';
        continue;
      }

      // 非 active mapping の preview
      if (!entry || entry.div.parentElement !== stage || !entry.video) {
        if (entry) entry.div.remove();
        const div = doc.createElement('div');
        div.className = 'preview-mapping inactive';
        div.dataset.mappingId = m.id;
        const video = doc.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        div.appendChild(video);
        stage.appendChild(div);
        div.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          opts.onActivate(m.id);
        });
        this.bindStream(video);
        entry = { div, video, sig: '' };
        this.previews.set(m.id, entry);
      }
      const sig = `${state.canvas.width}x${state.canvas.height}|${i}|${m.quad.topLeft.x},${m.quad.topLeft.y},${m.quad.topRight.x},${m.quad.topRight.y},${m.quad.bottomRight.x},${m.quad.bottomRight.y},${m.quad.bottomLeft.x},${m.quad.bottomLeft.y}|${m.source.x},${m.source.y},${m.source.width},${m.source.height}`;
      if (sig !== entry.sig) {
        entry.sig = sig;
        entry.div.style.setProperty('--mapping-color', mappingColor(i));
        entry.div.style.zIndex = String(z);
        entry.div.style.width = `${state.canvas.width}px`;
        entry.div.style.height = `${state.canvas.height}px`;
        applyQuadCanvas(entry.div, m.quad, state.canvas.width, state.canvas.height);
        applyVideoCrop(entry.video!, m.source);
      }
    }
  }

  /** sourceVideo の srcObject が後から確定／差し替えになった時に、保持中の mapping preview に再 bind する。 */
  rebindStreams(): void {
    this.previews.forEach((entry) => {
      if (entry.video) this.bindStream(entry.video);
    });
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
      console.warn('InactivePreviewPool: preview の再生失敗', error);
    });
  }
}
