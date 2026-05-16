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

import type { MappingsState } from '../../../utils/mappingTransform';
import type { OutputBoundsMap, OutputBoundsSnapshot, VideoDimensions } from '../ControlHost';
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
   * プレビューの window-content 上でマウスが動いた／離れた時に発火（dev mode の双方向同期用）。
   * xFrac/yFrac は window-content に対する 0..1。dev mode OFF 時に呼んでも無害なよう、
   * gating（dev mode 確認）は呼び出し側の責任。
   */
  onPreviewCursor?: (outputId: string, xFrac: number, yFrac: number, visible: boolean) => void;
}

interface FrameEntry {
  /** ルート `.dc-output-frame` */
  root: HTMLElement;
  /** 出力ウィンドウのアスペクトを持つ `.dc-display-frame` */
  display: HTMLElement;
  /** 出力ウィンドウの位置/サイズを表す `.window-frame` */
  windowFrame: HTMLElement;
  /** active／inactive mapping の DOM が入る `.dc-mapping-area` */
  mappingArea: HTMLElement;
  /** dev mode 時にマウス位置をミラーするクロスヘア SVG（.window-content 直下に重ねる） */
  devCrosshair: SVGSVGElement;
  devCrosshairH: SVGLineElement;
  devCrosshairV: SVGLineElement;
  /** ヘッダの各 span（DOM の都度参照を避けて掴んでおく） */
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

  attach(scope: HTMLElement, opts: OutputVizPanelAttachOptions, ctrl: MappingsController): void {
    this.scope = scope;
    this.opts = opts;
    this.ctrl = ctrl;
    this.stageEl = scope.querySelector('#output-stage') as HTMLElement | null;
    this.rebuildFromState();
    this.refresh();
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
    const active = state.activeOutputId ?? this.resolveActiveOutputFromMapping(state);
    for (const [id, entry] of this.frames) {
      entry.root.classList.toggle('is-active', id === active);
    }
  }

  /** 指定出力の `.dc-mapping-area` を返す。MappingAreaPanel / InactivePreviewPool が宛先として参照する。 */
  getMappingArea(outputId: string): HTMLElement | null {
    return this.frames.get(outputId)?.mappingArea ?? null;
  }

  /** state の active mapping から推定する activeOutput（activeOutputId が無いときの fallback）。 */
  private resolveActiveOutputFromMapping(state: MappingsState): string | undefined {
    return state.mappings.find(m => m.id === state.activeId)?.outputId;
  }

  destroy(): void {
    this.frames.clear();
    this.scope = null;
    this.stageEl = null;
    this.opts = null;
    this.ctrl = null;
    this.lastOutputIds = [];
  }

  // ── DOM 構築 ───────────────────────────────────────────────────

  private rebuildFromState(): void {
    const stage = this.stageEl;
    const ctrl = this.ctrl;
    const doc = stage?.ownerDocument;
    if (!stage || !ctrl || !doc) return;

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

    // 必要なフレームを生成（既存は再利用、順序整列のため appendChild で末尾に動かす）
    for (const outputId of ids) {
      let entry = this.frames.get(outputId);
      if (!entry) {
        entry = this.buildFrame(doc, outputId);
        this.frames.set(outputId, entry);
      }
      stage.appendChild(entry.root); // 順序を ids に合わせて整列（既存でも末尾に再配置でズレ無し）
    }

    this.lastOutputIds = ids;
  }

  private buildFrame(doc: Document, outputId: string): FrameEntry {
    const root = doc.createElement('div');
    root.className = 'dc-output-frame';
    root.dataset.outputId = outputId;

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

    const display = doc.createElement('div');
    display.className = 'dc-display-frame';

    const windowFrame = doc.createElement('div');
    windowFrame.className = 'window-frame';

    const titlebar = doc.createElement('div');
    titlebar.className = 'window-titlebar';
    const controls = doc.createElement('div');
    controls.className = 'window-controls';
    for (const cls of ['close', 'minimize', 'maximize']) {
      const c = doc.createElement('span');
      c.className = `window-control ${cls}`;
      controls.appendChild(c);
    }
    titlebar.appendChild(controls);

    const content = doc.createElement('div');
    content.className = 'window-content';
    const mappingArea = doc.createElement('div');
    mappingArea.className = 'dc-mapping-area';
    mappingArea.dataset.outputId = outputId;
    content.appendChild(mappingArea);

    // dev mode のマウス追従クロスヘア（.window-content 全面に重ねる）。
    // 表示／非表示はクラス（.dc-control-shell.dc-dev-mode）と data-visible 属性で CSS 制御。
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
    content.appendChild(devCrosshair);

    windowFrame.append(titlebar, content);
    display.appendChild(windowFrame);
    root.appendChild(display);

    // クリックでこの出力を activeOutput に
    root.addEventListener('click', (e) => {
      // mapping area 内（=非 active mapping のクリック）は InactivePreviewPool 側で活性化されるので干渉しない
      if ((e.target as HTMLElement).closest('.preview-mapping')) return;
      if ((e.target as HTMLElement).closest('.quad-handle')) return;
      if ((e.target as HTMLElement).closest('#cropped-container')) return;
      this.opts?.setActiveOutput(outputId);
    });

    // プレビューの window-content 上でマウスを追跡し、dev mode 中のみ親に通知する
    // （onPreviewCursor が gating する）。出力ウィンドウ側のクロスヘアと相互ミラーされる。
    content.addEventListener('mousemove', (e) => {
      const cb = this.opts?.onPreviewCursor;
      if (!cb) return;
      const rect = content.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const xFrac = (e.clientX - rect.left) / rect.width;
      const yFrac = (e.clientY - rect.top) / rect.height;
      cb(outputId, xFrac, yFrac, true);
    });
    content.addEventListener('mouseleave', () => {
      this.opts?.onPreviewCursor?.(outputId, 0, 0, false);
    });

    return {
      root, display, windowFrame, mappingArea,
      devCrosshair, devCrosshairH, devCrosshairV,
      headerName, headerSize, headerMode,
    };
  }

  /**
   * 出力ウィンドウから push されたカーソル位置を、対応する出力プレビューの crosshair に反映。
   * xFrac/yFrac は 0..1。SVG は viewBox 0..100 を preserveAspectRatio=none で window-content
   * 全面にストレッチしているので、`x * 100` をそのまま使えば縦横比に関係なく正しい位置に描ける。
   */
  updateDevCursor(outputId: string, xFrac: number, yFrac: number, visible: boolean): void {
    const entry = this.frames.get(outputId);
    if (!entry) return;
    entry.devCrosshair.dataset.visible = visible ? 'true' : 'false';
    if (!visible) return;
    const xv = String(Math.max(0, Math.min(100, xFrac * 100)));
    const yv = String(Math.max(0, Math.min(100, yFrac * 100)));
    entry.devCrosshairH.setAttribute('x1', '0');
    entry.devCrosshairH.setAttribute('x2', '100');
    entry.devCrosshairH.setAttribute('y1', yv);
    entry.devCrosshairH.setAttribute('y2', yv);
    entry.devCrosshairV.setAttribute('x1', xv);
    entry.devCrosshairV.setAttribute('x2', xv);
    entry.devCrosshairV.setAttribute('y1', '0');
    entry.devCrosshairV.setAttribute('y2', '100');
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
    if (!ctrl) return;
    const state = ctrl.getState();
    const boundsMap = this.opts?.getOutputBounds() ?? {};
    const activeOutput = state.activeOutputId ?? this.resolveActiveOutputFromMapping(state);

    for (const out of state.outputs) {
      const entry = this.frames.get(out.id);
      if (!entry) continue;

      const bounds = boundsMap[out.id];
      const isOpen = !!bounds;
      const isFullscreen = !!bounds?.isFullscreen;

      // アスペクト比: 開いていればディスプレイ解像度、未開ならピクセルサイズ／layout から
      const fallback = out.pixelSize ?? { width: out.layout.width, height: out.layout.height };
      const aspectW = bounds?.screenWidth ?? fallback.width;
      const aspectH = bounds?.screenHeight ?? fallback.height;
      if (aspectW > 0 && aspectH > 0) {
        entry.display.style.setProperty('--output-aspect', `${aspectW} / ${aspectH}`);
        entry.display.style.setProperty('--output-aspect-num', `${aspectW / aspectH}`);
      }

      // ヘッダ
      entry.headerName.textContent = out.name ?? out.id;
      // 「どのディスプレイか」をラベル付きで表示。Window Management API のラベルが取れていれば
      // 物理ディスプレイ名（"Built-in Retina Display" / "DELL U2718Q" 等）+ 内蔵フラグ + サイズ、
      // 取れない（未対応・権限拒否・未起動）場合はサイズだけ表示。
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
        entry.headerSize.textContent = `${fallback.width}×${fallback.height}`;
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

      // window-frame: 出力ウィンドウのスクリーン内位置／サイズを% で表現
      this.applyWindowFrame(entry.windowFrame, bounds);

      // active 強調
      entry.root.classList.toggle('is-active', out.id === activeOutput);
    }

    this.opts?.onWindowFrameReflow();
  }

  private applyWindowFrame(windowFrame: HTMLElement, bounds: OutputBoundsSnapshot | undefined): void {
    if (!bounds || bounds.screenWidth <= 0 || bounds.screenHeight <= 0) {
      // 未起動: フレーム全体を専有
      windowFrame.style.left = '0';
      windowFrame.style.top = '0';
      windowFrame.style.transform = 'none';
      windowFrame.style.width = '100%';
      windowFrame.style.height = '100%';
      windowFrame.classList.remove('fullscreen');
      windowFrame.classList.add('not-open');
      return;
    }
    const wPct = bounds.innerWidth > 0
      ? Math.min(100, (bounds.innerWidth / bounds.screenWidth) * 100)
      : 100;
    const hPct = bounds.innerHeight > 0
      ? Math.min(100, (bounds.innerHeight / bounds.screenHeight) * 100)
      : 100;
    windowFrame.style.position = 'absolute';
    windowFrame.style.left = '50%';
    windowFrame.style.top = '50%';
    windowFrame.style.transform = 'translate(-50%, -50%)';
    windowFrame.style.width = `${wPct}%`;
    windowFrame.style.height = `${hPct}%`;
    windowFrame.classList.toggle('fullscreen', !!bounds.isFullscreen);
    windowFrame.classList.remove('not-open');
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
