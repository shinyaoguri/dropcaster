/**
 * マッピングカラムの「出力ステージ」を組み立てる panel。
 *
 * state.outputs に基づき、出力ごとに `.dc-output-frame` を生やし、その中に
 * `.dc-display-frame` →（出力ウィンドウ枠を表す）`.window-frame` →
 * `.dc-mapping-area` の階層を作る。`.dc-mapping-area` は MappingAreaPanel と
 * InactivePreviewPool が active／inactive な mapping をぶら下げる宛先になる。
 *
 * 入力は ControlWindow が保持する state / outputBounds(map) / videoDimensions /
 * sourceVideo のスナップショットで、getter 群で都度読む（mirror しない）。
 * 「window-frame のサイズが変わったので quad の matrix3d を再計算してほしい」という
 * 副次要求は onWindowFrameReflow コールバックで親に通知する。
 *
 * フレーム DOM は state.outputs が変化した時だけ作り直し、その他のタイミングでは
 * 既存要素の inline style と class だけを更新する（active mapping の移動先など）。
 */

import type { OutputBoundsMap, VideoDimensions } from '../ControlHost';
import type { MappingsController } from '../MappingsController';

export interface OutputVizPanelAttachOptions {
  getOutputBounds: () => OutputBoundsMap;
  getVideoDimensions: () => VideoDimensions;
  getSourceVideo: () => HTMLVideoElement | null;
  /** フレームを click した時に activeOutputId を切り替える（state mutation は呼び出し側）。 */
  setActiveOutput: (outputId: string) => void;
  /** window-frame のサイズが変わったときに quad の matrix3d 再計算を要求する。 */
  onWindowFrameReflow: () => void;
  /**
   * プレビューの canvas-host 上でマウスが動いた／離れた時に発火（dev mode の双方向同期用）。
   * canvas-space の座標（仮想キャンバス px）を送る。dev mode OFF 時に呼んでも無害なよう、
   * gating（dev mode 確認）は呼び出し側の責任。
   */
  onPreviewCursor?: (canvasX: number, canvasY: number, visible: boolean) => void;
}

interface FrameEntry {
  /**
   * 出力フレームは「この出力が投影する範囲」を示す半透明オーバーレイ。
   * canvas-host 内に絶対配置（canvas px サイズ）され、host の scale で viewport にフィットする。
   * mapping は別レイヤ（canvasMappings）に描かれるので、フレーム外まで延びた quad も見える。
   */
  root: HTMLElement;
  /** dev mode 時にマウス位置をミラーするクロスヘア SVG（フレーム全面に重ねる） */
  devCrosshair: SVGSVGElement;
  devCrosshairH: SVGLineElement;
  devCrosshairV: SVGLineElement;
  /** ヘッダの各 span（フレーム内に小さく表示） */
  headerName: HTMLElement;
  headerSize: HTMLElement;
  headerMode: HTMLElement;
}

export class OutputVizPanel {
  private scope: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private opts: OutputVizPanelAttachOptions | null = null;
  private ctrl: MappingsController | null = null;
  private frames = new Map<string, FrameEntry>();
  /** 直近に DOM を組み立てた outputs の id 列。順序が変わったらフレームを並べ直す。 */
  private lastOutputIds: string[] = [];
  /** 仮想キャンバス全体を canvas px サイズで持つレイヤ。中に mappings + frames が乗る。 */
  private canvasHost: HTMLElement | null = null;
  /** 仮想キャンバス全体の mapping レイヤ（mapping DOM の mount 先 = MappingAreaPanel / InactivePreviewPool）。 */
  private canvasMappings: HTMLElement | null = null;
  /** quad ハンドルを置くレイヤ（mappings の上、frame の上）。 */
  private canvasHandles: HTMLElement | null = null;
  /**
   * stage 自身のサイズ変化（カラムリサイザでマッピングカラムの幅を変えた、ウィンドウリサイズで
   * 親フレックスが再分配された、等）に追従するための observer。LayoutPanel と同じ理由で
   * 必要 — window resize イベントだけだとカラム resize に追従できないため。
   * 1 frame に 1 回だけ refresh を呼ぶよう rAF で間引く。
   */
  private resizeObserver: ResizeObserver | null = null;
  private resizeRafId: number | null = null;

  attach(scope: HTMLElement, opts: OutputVizPanelAttachOptions, ctrl: MappingsController): void {
    this.scope = scope;
    this.opts = opts;
    this.ctrl = ctrl;
    const stage = scope.querySelector('#output-stage') as HTMLElement | null;
    if (!stage) return;
    this.stageEl = stage;
    // canvas-host: 仮想キャンバス全体（canvas.w × canvas.h px）。renderEachFrame で scale+offset を書く。
    const doc = stage.ownerDocument;
    this.canvasHost = doc.createElement('div');
    this.canvasHost.className = 'dc-canvas-host';
    // 下から: mappings レイヤ → 出力 frame 群（オーバーレイ）→ handles レイヤ
    this.canvasMappings = doc.createElement('div');
    this.canvasMappings.className = 'dc-canvas-mappings';
    this.canvasHandles = doc.createElement('div');
    this.canvasHandles.className = 'dc-canvas-handles';
    this.canvasHost.append(this.canvasMappings, this.canvasHandles);
    stage.appendChild(this.canvasHost);

    // dev mode のマウス追跡は canvas-host レベルで行う（フレームは pointer-events: none）。
    // カーソル位置の canvas px 座標から、含まれる出力を hit-test して onPreviewCursor に通知する。
    this.canvasHost.addEventListener('mousemove', (e) => this.handleHostMouseMove(e));
    this.canvasHost.addEventListener('mouseleave', () => this.handleHostMouseLeave());

    // stage 自身の resize（カラムリサイザ・ウィンドウリサイズ etc.）でフィット scale を再計算する。
    // window の resize イベントだけだとカラム幅変更には反応できないので必須。
    this.resizeObserver = new ResizeObserver(() => this.scheduleResizeRefresh());
    this.resizeObserver.observe(stage);

    this.rebuildFromState();
    this.refresh();
  }

  /**
   * resize 起因の再フィット。renderAll（scale/offset の再計算 + 各 frame の position 更新）のみで
   * 十分なので rebuildFromState は省略。1 フレームに 1 回まで間引く。
   */
  private scheduleResizeRefresh(): void {
    const win = this.stageEl?.ownerDocument?.defaultView;
    if (!win || this.resizeRafId !== null) return;
    this.resizeRafId = win.requestAnimationFrame(() => {
      this.resizeRafId = null;
      this.renderAll();
    });
  }

  /**
   * dev mode 用: canvas-host 上のマウス位置を canvas px に変換して通知する。
   * hit-test は不要（cursor 位置は全出力に同じ canvas-space で放送されるので、
   * どの出力に「属する」かを決める必要が無い）。
   */
  private handleHostMouseMove(e: MouseEvent): void {
    const cb = this.opts?.onPreviewCursor;
    const host = this.canvasHost;
    if (!cb || !host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scale = parseFloat(host.style.getPropertyValue('--canvas-scale')) || 1;
    const cx = (e.clientX - rect.left) / scale;
    const cy = (e.clientY - rect.top) / scale;
    cb(cx, cy, true);
  }
  private handleHostMouseLeave(): void {
    this.opts?.onPreviewCursor?.(0, 0, false);
  }

  /** 出力ウィンドウ枠 + アスペクト比 を再描画（フレーム DOM の同期も行う）。 */
  refresh(): void {
    this.rebuildFromState();
    this.renderAll();
  }

  /** outputBounds 変更時に各フレームの window-frame だけ更新する入口。 */
  refreshOutputViz(): void {
    this.renderAll();
  }

  /** loadedmetadata 等で videoDimensions が変わった時にソース canvas のアスペクトだけ更新する。 */
  refreshAspectRatio(): void {
    this.renderSourceAspect();
  }

  /** active outputId 変更時にハイライトだけ更新したい時の入口。 */
  refreshActiveOutput(): void {
    const state = this.ctrl?.getState();
    if (!state) return;
    const active = state.activeOutputId;
    for (const [id, entry] of this.frames) {
      entry.root.classList.toggle('is-active', id === active);
    }
  }

  /**
   * 仮想キャンバスの mapping レイヤ（全 mapping の共通 mount 先）を返す。
   * cropped-container（active mapping）と inactive preview はすべてここに乗る。
   * 出力 frame は別レイヤで「投影範囲」を示すオーバーレイなので、mapping は
   * 出力境界を超えても見える（ウィンドウ外でもプレビューしたいというユーザ要求に対応）。
   */
  getCanvasMappings(): HTMLElement | null {
    return this.canvasMappings;
  }
  /** quad ハンドル群の mount 先（mappings レイヤの上）。 */
  getCanvasHandles(): HTMLElement | null {
    return this.canvasHandles;
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeRafId !== null) {
      const win = this.stageEl?.ownerDocument?.defaultView;
      win?.cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    this.canvasHost?.remove();
    this.canvasHost = null;
    this.canvasMappings = null;
    this.canvasHandles = null;
    this.frames.clear();
    this.scope = null;
    this.stageEl = null;
    this.opts = null;
    this.ctrl = null;
    this.lastOutputIds = [];
  }

  // ── DOM 構築 ───────────────────────────────────────────────────

  private rebuildFromState(): void {
    const ctrl = this.ctrl;
    const canvasHost = this.canvasHost;
    const canvasMappings = this.canvasMappings;
    const doc = this.stageEl?.ownerDocument;
    if (!ctrl || !canvasHost || !canvasMappings || !doc) return;

    const state = ctrl.getState();
    const ids = state.outputs.map(o => o.id);

    // 既存フレーム数・順番が一致していれば DOM を触らない（in-place 更新は renderAll が担当）
    const same = ids.length === this.lastOutputIds.length &&
      ids.every((id, i) => id === this.lastOutputIds[i]);
    if (same) return;

    // 不要になったフレームを削除
    for (const [id, entry] of this.frames) {
      if (!ids.includes(id)) {
        entry.root.remove();
        this.frames.delete(id);
      }
    }

    // 出力フレーム（オーバーレイ）は canvas-mappings の「上」に来るよう、canvasMappings の
    // 次の兄弟として canvasHandles の前に挿入する（DOM 順: mappings < frames < handles）。
    const handlesEl = this.canvasHandles;
    for (const outputId of ids) {
      let entry = this.frames.get(outputId);
      if (!entry) {
        entry = this.buildFrame(doc, outputId);
        this.frames.set(outputId, entry);
      }
      // 順序整列。handlesEl の直前に並べることで mappings の上・handles の下が保証される。
      if (handlesEl) canvasHost.insertBefore(entry.root, handlesEl);
      else canvasHost.appendChild(entry.root);
    }

    this.lastOutputIds = ids;
  }

  private buildFrame(doc: Document, outputId: string): FrameEntry {
    const root = doc.createElement('div');
    root.className = 'dc-output-frame';
    root.dataset.outputId = outputId;

    // ヘッダはフレーム左上にオーバーレイ表示（位置はランタイムで設定）
    const header = doc.createElement('div');
    header.className = 'dc-output-header';
    const headerName = doc.createElement('span');
    headerName.className = 'dc-output-name';
    const headerSize = doc.createElement('span');
    headerSize.className = 'dc-output-size';
    const headerMode = doc.createElement('span');
    headerMode.className = 'dc-output-mode';
    header.append(headerName, headerSize, headerMode);
    root.appendChild(header);

    // dev mode のマウス追従クロスヘア（フレーム全面に重ねる）
    const svgNs = 'http://www.w3.org/2000/svg';
    const devCrosshair = doc.createElementNS(svgNs, 'svg') as SVGSVGElement;
    devCrosshair.classList.add('dc-dev-crosshair');
    devCrosshair.setAttribute('preserveAspectRatio', 'none');
    devCrosshair.setAttribute('viewBox', '0 0 100 100');
    devCrosshair.setAttribute('aria-hidden', 'true');
    devCrosshair.dataset.visible = 'false';
    const devCrosshairH = doc.createElementNS(svgNs, 'line') as SVGLineElement;
    const devCrosshairV = doc.createElementNS(svgNs, 'line') as SVGLineElement;
    devCrosshair.append(devCrosshairH, devCrosshairV);
    root.appendChild(devCrosshair);

    // フレームは pointer-events: none なのでクリックはヘッダに置く。ヘッダクリックで active 化。
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      this.opts?.setActiveOutput(outputId);
    });

    return {
      root,
      devCrosshair, devCrosshairH, devCrosshairV,
      headerName, headerSize, headerMode,
    };
  }

  /**
   * canvas-space cursor を受けて全出力フレームの crosshair を更新する。各フレームは
   * 自分の bounds に対する fraction を計算し、SVG（viewBox 0..100、preserveAspectRatio=none）
   * の対応位置に線を引く。bounds 外（fraction < 0 or > 1 → viewBox 値 < 0 or > 100）に
   * 来た線は SVG の overflow:hidden で自然にクリップされる。
   */
  updateDevCursor(canvasX: number, canvasY: number, visible: boolean): void {
    const state = this.ctrl?.getState();
    if (!state) return;
    for (const out of state.outputs) {
      const entry = this.frames.get(out.id);
      if (!entry) continue;
      entry.devCrosshair.dataset.visible = visible ? 'true' : 'false';
      if (!visible) continue;
      if (out.size.width <= 0 || out.size.height <= 0) continue;
      const xv = String(((canvasX - out.position.x) / out.size.width) * 100);
      const yv = String(((canvasY - out.position.y) / out.size.height) * 100);
      entry.devCrosshairH.setAttribute('x1', '0');
      entry.devCrosshairH.setAttribute('x2', '100');
      entry.devCrosshairH.setAttribute('y1', yv);
      entry.devCrosshairH.setAttribute('y2', yv);
      entry.devCrosshairV.setAttribute('x1', xv);
      entry.devCrosshairV.setAttribute('x2', xv);
      entry.devCrosshairV.setAttribute('y1', '0');
      entry.devCrosshairV.setAttribute('y2', '100');
    }
  }

  /** dev mode OFF 時など、全プレビューの crosshair を一括で非表示にする。 */
  hideAllDevCursors(): void {
    for (const entry of this.frames.values()) {
      entry.devCrosshair.dataset.visible = 'false';
    }
  }

  // ── 描画（DOM 既存・属性のみ更新） ──────────────────────────

  private renderAll(): void {
    this.renderEachFrame();
    this.renderSourceAspect();
  }

  private renderEachFrame(): void {
    const ctrl = this.ctrl;
    const stage = this.stageEl;
    const canvasHost = this.canvasHost;
    const canvasMappings = this.canvasMappings;
    const canvasHandles = this.canvasHandles;
    if (!ctrl || !stage || !canvasHost || !canvasMappings || !canvasHandles) return;
    const state = ctrl.getState();
    const boundsMap = this.opts?.getOutputBounds() ?? {};
    const activeOutput = state.activeOutputId;

    // 仮想キャンバスを #output-stage の viewport にフィットさせる scale + 中央寄せオフセット
    const stageRect = stage.getBoundingClientRect();
    const padding = 16;
    const availW = Math.max(1, stageRect.width - padding * 2);
    const availH = Math.max(1, stageRect.height - padding * 2);
    const scale = state.canvas.width > 0 && state.canvas.height > 0
      ? Math.min(availW / state.canvas.width, availH / state.canvas.height)
      : 1;
    const totalW = state.canvas.width * scale;
    const totalH = state.canvas.height * scale;
    const offsetX = (stageRect.width - totalW) / 2;
    const offsetY = (stageRect.height - totalH) / 2;

    // canvas-host を canvas 寸法 × scale で中央寄せ。内側の要素は canvas px のまま座標指定する。
    canvasHost.style.width = `${state.canvas.width}px`;
    canvasHost.style.height = `${state.canvas.height}px`;
    canvasHost.style.left = `${offsetX}px`;
    canvasHost.style.top = `${offsetY}px`;
    canvasHost.style.transformOrigin = 'top left';
    canvasHost.style.transform = `scale(${scale})`;
    // 子要素（quad handle 等）が parent scale を打ち消すための CSS 変数
    canvasHost.style.setProperty('--canvas-scale', `${scale}`);
    canvasHost.style.setProperty('--canvas-counter-scale', `${scale > 0 ? 1 / scale : 1}`);

    // mappings / handles レイヤを canvas-host 内のフルサイズに
    canvasMappings.style.width = `${state.canvas.width}px`;
    canvasMappings.style.height = `${state.canvas.height}px`;
    canvasHandles.style.width = `${state.canvas.width}px`;
    canvasHandles.style.height = `${state.canvas.height}px`;

    for (const out of state.outputs) {
      const entry = this.frames.get(out.id);
      if (!entry) continue;

      const bounds = boundsMap[out.id];
      const isOpen = !!bounds;
      const isFullscreen = !!bounds?.isFullscreen;

      // ヘッダ（フレーム左上にオーバーレイ）
      entry.headerName.textContent = out.name ?? out.id;
      if (bounds && bounds.screenWidth > 0 && bounds.screenHeight > 0) {
        const size = `${bounds.screenWidth}×${bounds.screenHeight}`;
        if (bounds.screenLabel) {
          const internalMark = bounds.screenIsInternal ? '（内蔵）' : '';
          entry.headerSize.textContent = `${bounds.screenLabel}${internalMark} ${size}`;
        } else {
          entry.headerSize.textContent = size;
        }
        entry.headerSize.title = bounds.screenLabel
          ? `${bounds.screenLabel}${bounds.screenIsInternal ? '（内蔵ディスプレイ）' : '（外部ディスプレイ）'} / ${size}`
          : `ディスプレイサイズ ${size}`;
      } else {
        entry.headerSize.textContent = `${Math.round(out.size.width)}×${Math.round(out.size.height)}`;
        entry.headerSize.title = '想定解像度（出力ウィンドウ未起動）';
      }
      entry.headerMode.classList.remove('open', 'fullscreen', 'closed');
      if (!isOpen) {
        entry.headerMode.classList.add('closed');
        entry.headerMode.textContent = '未起動';
      } else if (isFullscreen) {
        entry.headerMode.classList.add('fullscreen');
        entry.headerMode.textContent = 'フルスクリーン';
      } else {
        entry.headerMode.classList.add('open');
        entry.headerMode.textContent = 'ウィンドウ';
      }

      // フレーム（オーバーレイ）を canvas-host 内の (position, size) に絶対配置（canvas px のまま）
      entry.root.style.left = `${out.position.x}px`;
      entry.root.style.top = `${out.position.y}px`;
      entry.root.style.width = `${out.size.width}px`;
      entry.root.style.height = `${out.size.height}px`;

      // active 強調
      entry.root.classList.toggle('is-active', out.id === activeOutput);
    }

    this.opts?.onWindowFrameReflow();
  }

  /**
   * ソース canvas のアスペクト比を --canvas-aspect として scope に注入する。
   * source-column の .canvas-frame がこれを参照する（多出力の影響は受けない）。
   */
  private renderSourceAspect(): void {
    const scope = this.scope;
    const opts = this.opts;
    if (!scope || !opts) return;
    const dims = opts.getVideoDimensions();
    const video = opts.getSourceVideo();
    const canvasWidth = dims.width || video?.videoWidth || 1920;
    const canvasHeight = dims.height || video?.videoHeight || 1080;
    if (canvasWidth <= 0 || canvasHeight <= 0) return;
    scope.style.setProperty('--canvas-aspect', `${canvasWidth} / ${canvasHeight}`);
    scope.style.setProperty('--canvas-aspect-num', `${canvasWidth / canvasHeight}`);
  }
}
