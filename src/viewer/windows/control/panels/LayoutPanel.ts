/**
 * 出力レイアウト編集タブ（仮想キャンバス上で各出力の position / size を 2D 操作で設定）の panel。
 *
 * 表示:
 *   - viewport（layout-stage 内の固定領域）に仮想キャンバス全体を縮小して表示
 *   - 各 output を矩形として描画。ドラッグで position 移動、右下ハンドルで size リサイズ
 *   - active output（activeOutputId）は強調色で表示
 *
 * 配置の変更は仮想キャンバス px そのままを state に書く（mapping の quad は canvas px の
 * 絶対座標なので、出力を動かすと「窓の外」に出る — これは仕様。後で mapping 追従モードを足せる）。
 *
 * このパネルはマッピングカラム内の「出力レイアウト」タブが active なときだけ refresh される
 * （非表示時は無駄な DOM 更新を避けるため、ControlWindow からの呼び出しでガード）。
 */

import {
  applyQuadCanvas,
  applyVideoCrop,
  isMappingEnabled,
  mappingColor,
  withActiveOutputSet,
  type MappingsState,
} from '../../../utils/mappingTransform';
import { CleanupStack } from '../../../utils/cleanupStack';
import { RafThrottle } from '../../../utils/rafThrottle';
import type { MappingsController } from '../MappingsController';
import { draggable } from '../utils/draggable';

interface MappingPreviewEntry {
  div: HTMLDivElement;
  video: HTMLVideoElement;
  sig: string;
}

interface OutputEntry {
  div: HTMLDivElement;
  label: HTMLElement;
  resizeSE: HTMLDivElement;
  /** 仮想キャンバス全体を canvas px サイズで持ち、translate(-position) で「自分の担当部分」だけ見せる */
  canvasWindow: HTMLDivElement;
  /** この出力 frame に乗っている mapping preview 群（mapping.id → entry） */
  previews: Map<string, MappingPreviewEntry>;
  /** 出力削除 / panel destroy 時に呼ぶ drag 解除関数（本体 drag + resize drag）。 */
  dispose: CleanupStack;
}

export interface LayoutPanelAttachOptions {
  /** mapping preview の stream donor として参照するソース video（InactivePreviewPool と同じソース） */
  getSourceVideo: () => HTMLVideoElement | null;
  /**
   * drag/resize で出力の position/size が in-place 変化したときに呼ばれる（mousemove 毎）。
   * ツール列の「出力設定」入力欄を live 更新する用途。fireChange は走らないので
   * refreshAllFromState では追いつけないため、別経路で通知する。
   */
  onOutputLayoutMutated?: () => void;
}

export class LayoutPanel {
  private viewport: HTMLDivElement | null = null;
  private canvasEl: HTMLDivElement | null = null;
  private hintEl: HTMLElement | null = null;
  private doc: Document | null = null;
  private ctrl: MappingsController | null = null;
  private opts: LayoutPanelAttachOptions | null = null;
  private outputs = new Map<string, OutputEntry>();
  /** viewport の bounding rect から canvas を fit するスケール。refresh で計算。 */
  private fitScale = 1;
  private resizeObserver: ResizeObserver | null = null;
  /** viewport resize → refresh を 1 フレーム 1 回に間引く throttle。attach で初期化。 */
  private resizeThrottle: RafThrottle | null = null;

  attach(scope: HTMLElement, doc: Document, win: Window, ctrl: MappingsController, opts: LayoutPanelAttachOptions): void {
    this.doc = doc;
    this.ctrl = ctrl;
    this.opts = opts;

    const stage = scope.querySelector('#layout-stage') as HTMLElement | null;
    if (!stage) return;

    // 説明テキスト + viewport + canvas を組み立てる（テンプレ HTML には空の stage しか居ない）
    this.hintEl = doc.createElement('div');
    this.hintEl.className = 'dc-layout-hint';
    this.hintEl.textContent = '出力ウィンドウをドラッグで配置／右下角でリサイズ。仮想キャンバスのサイズは全出力を包含する最小矩形に自動拡張されます。';

    this.viewport = doc.createElement('div');
    this.viewport.className = 'dc-layout-viewport';

    this.canvasEl = doc.createElement('div');
    this.canvasEl.className = 'dc-layout-canvas';
    this.viewport.appendChild(this.canvasEl);

    stage.appendChild(this.hintEl);
    stage.appendChild(this.viewport);

    // viewport の resize でレイアウト全体（fitScale）を再計算（rAF で 1 frame 1 回に間引く）
    this.resizeThrottle = new RafThrottle(win, () => this.refresh());
    this.resizeObserver = new ResizeObserver(() => this.resizeThrottle?.schedule());
    this.resizeObserver.observe(this.viewport);
  }

  /** state やタブ切替に応じて再描画。タブ非表示時にも呼んで OK（viewport rect 0 で no-op）。 */
  refresh(): void {
    const ctrl = this.ctrl;
    const viewport = this.viewport;
    const canvasEl = this.canvasEl;
    if (!ctrl || !viewport || !canvasEl) return;

    const state = ctrl.getState();
    const vpRect = viewport.getBoundingClientRect();
    if (vpRect.width <= 0 || vpRect.height <= 0) return;
    if (state.canvas.width <= 0 || state.canvas.height <= 0) return;

    // 仮想キャンバスを viewport 内に「短辺合わせ」でフィット（aspect 保持・余白あり）
    const padding = 24;
    const availW = Math.max(1, vpRect.width - padding * 2);
    const availH = Math.max(1, vpRect.height - padding * 2);
    const sx = availW / state.canvas.width;
    const sy = availH / state.canvas.height;
    const scale = Math.min(sx, sy);
    this.fitScale = scale;

    // canvas は transform-origin: top left で scale するので、その scale 後の
    // 視覚サイズ (canvas.w * scale, canvas.h * scale) を viewport 中央に寄せる位置を直接計算。
    const scaledW = state.canvas.width * scale;
    const scaledH = state.canvas.height * scale;
    const left = (vpRect.width - scaledW) / 2;
    const top = (vpRect.height - scaledH) / 2;
    canvasEl.style.width = `${state.canvas.width}px`;
    canvasEl.style.height = `${state.canvas.height}px`;
    canvasEl.style.left = `${left}px`;
    canvasEl.style.top = `${top}px`;
    canvasEl.style.transform = `scale(${scale})`;
    // resize ハンドル等を screen-px 一定サイズで描画するための逆スケール係数。
    // OutputVizPanel と同じ命名で、CSS から calc(... * var(--canvas-counter-scale)) で参照。
    canvasEl.style.setProperty('--canvas-counter-scale', `${scale > 0 ? 1 / scale : 1}`);

    this.syncOutputs(state);
  }

  /** ソース stream が後から確定したら呼ぶ。各出力プレビューの video に bind し直す。 */
  rebindStreams(): void {
    for (const e of this.outputs.values()) {
      for (const p of e.previews.values()) this.bindStream(p.video);
    }
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.resizeThrottle?.cancel();
    this.resizeThrottle = null;
    for (const e of this.outputs.values()) {
      e.dispose.runAll();
      e.div.remove();
    }
    this.outputs.clear();
    this.hintEl?.remove();
    this.hintEl = null;
    this.viewport?.remove();
    this.viewport = null;
    this.canvasEl = null;
    this.doc = null;
    this.ctrl = null;
    this.opts = null;
  }

  // ── internals ─────────────────────────────────────────────────

  private syncOutputs(state: MappingsState): void {
    const doc = this.doc;
    const canvasEl = this.canvasEl;
    if (!doc || !canvasEl) return;

    const seen = new Set<string>();
    const activeId = state.activeOutputId;

    for (const out of state.outputs) {
      seen.add(out.id);
      let entry = this.outputs.get(out.id);
      if (!entry) {
        entry = this.buildOutput(doc, out.id);
        canvasEl.appendChild(entry.div);
        this.outputs.set(out.id, entry);
      }
      entry.div.style.left = `${out.position.x}px`;
      entry.div.style.top = `${out.position.y}px`;
      entry.div.style.width = `${out.size.width}px`;
      entry.div.style.height = `${out.size.height}px`;
      entry.div.classList.toggle('is-active', out.id === activeId);
      entry.label.textContent =
        `${out.name ?? out.id}  ${Math.round(out.size.width)}×${Math.round(out.size.height)} @ (${Math.round(out.position.x)},${Math.round(out.position.y)})`;
      // canvas-window: 仮想キャンバス全体を CSS px サイズで持ち、translate で出力位置を viewport (0,0) に持っていく。
      // 親（layout-output）が out.size の canvas-px サイズなので、scale は不要（canvas-host が全体を fitScale）。
      entry.canvasWindow.style.width = `${state.canvas.width}px`;
      entry.canvasWindow.style.height = `${state.canvas.height}px`;
      entry.canvasWindow.style.transform = `translate(${-out.position.x}px, ${-out.position.y}px)`;
      this.syncPreviewsFor(entry, state);
    }

    // 消えた出力を片付け
    for (const [id, entry] of this.outputs) {
      if (!seen.has(id)) {
        entry.dispose.runAll();
        entry.div.remove();
        this.outputs.delete(id);
      }
    }
  }

  private buildOutput(doc: Document, outputId: string): OutputEntry {
    const div = doc.createElement('div');
    div.className = 'dc-layout-output';
    div.dataset.outputId = outputId;

    // canvas-window: マッピングプレビューの mount 先。translate で「自分の bounds」だけが見えるようになる。
    // overflow: hidden の layout-output が外側に出る部分を clip。
    const canvasWindow = doc.createElement('div');
    canvasWindow.className = 'dc-canvas-window';
    canvasWindow.dataset.outputId = outputId;
    canvasWindow.style.pointerEvents = 'none'; // クリック・ドラッグは layout-output に通す
    div.appendChild(canvasWindow);

    const label = doc.createElement('div');
    label.className = 'dc-layout-output-label';
    div.appendChild(label);

    const resizeSE = doc.createElement('div');
    resizeSE.className = 'dc-layout-resize se';
    div.appendChild(resizeSE);

    const dispose = new CleanupStack();

    // クリックで activeOutputId 切替（dragstart 直後にも発火するので、実 drag が無かった時のみ active 化）
    div.addEventListener('click', () => {
      this.setActiveOutput(outputId);
    });

    // 本体ドラッグ → position 更新
    dispose.push(this.attachBodyDrag(div, resizeSE, outputId));
    // 右下ハンドル → size リサイズ
    dispose.push(this.attachResizeDrag(resizeSE, outputId));

    return { div, label, resizeSE, canvasWindow, previews: new Map(), dispose };
  }

  /**
   * この出力に乗っている mapping preview を state と同期する。各 preview は canvas-window の
   * 子で、canvas px サイズ・matrix3d で quad に warp される（InactivePreviewPool と同じ式）。
   * すべての enabled mapping を出すので、出力の bounds から外れた部分は overflow: hidden で
   * 自然に clip される。
   */
  private syncPreviewsFor(entry: OutputEntry, state: MappingsState): void {
    const doc = this.doc;
    if (!doc) return;

    const enabled = state.mappings.filter(m => isMappingEnabled(m));
    const enabledIds = new Set(enabled.map(m => m.id));

    // 消えた／無効化された mapping の preview を削除
    for (const [id, p] of entry.previews) {
      if (!enabledIds.has(id)) {
        p.div.remove();
        entry.previews.delete(id);
      }
    }

    for (let i = 0; i < state.mappings.length; i++) {
      const m = state.mappings[i];
      if (!isMappingEnabled(m)) continue;

      let p = entry.previews.get(m.id);
      if (!p) {
        const pDiv = doc.createElement('div');
        pDiv.className = 'dc-layout-preview';
        const video = doc.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        pDiv.appendChild(video);
        entry.canvasWindow.appendChild(pDiv);
        this.bindStream(video);
        p = { div: pDiv, video, sig: '' };
        entry.previews.set(m.id, p);
      }
      const sig = `${state.canvas.width}x${state.canvas.height}|${i}|${m.quad.topLeft.x},${m.quad.topLeft.y},${m.quad.topRight.x},${m.quad.topRight.y},${m.quad.bottomRight.x},${m.quad.bottomRight.y},${m.quad.bottomLeft.x},${m.quad.bottomLeft.y}|${m.source.x},${m.source.y},${m.source.width},${m.source.height}`;
      if (sig !== p.sig) {
        p.sig = sig;
        p.div.style.setProperty('--mapping-color', mappingColor(i));
        p.div.style.width = `${state.canvas.width}px`;
        p.div.style.height = `${state.canvas.height}px`;
        applyQuadCanvas(p.div, m.quad, state.canvas.width, state.canvas.height);
        applyVideoCrop(p.video, m.source);
      }
    }
  }

  private bindStream(video: HTMLVideoElement): void {
    const src = this.opts?.getSourceVideo();
    if (!src || !src.srcObject) return;
    if (video.srcObject === src.srcObject) return;
    video.srcObject = src.srcObject;
    video.play().catch(() => { /* 自動再生失敗は致命的でない */ });
  }

  private attachBodyDrag(div: HTMLDivElement, resizeSE: HTMLDivElement, outputId: string): () => void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    if (!doc || !ctrl) return () => {};

    type Snap = { startX: number; startY: number; initialPos: { x: number; y: number } };
    return draggable<Snap>(div, doc, {
      onStart: (e) => {
        // リサイズハンドル上の mousedown は本体ドラッグから除外
        if (e.target === resizeSE || (e.target as HTMLElement).closest('.dc-layout-resize')) return null;
        const state = ctrl.getState();
        const out = state.outputs.find(o => o.id === outputId);
        if (!out) return null;
        this.setActiveOutput(outputId);
        div.classList.add('dragging');
        e.preventDefault();
        return {
          startX: e.clientX,
          startY: e.clientY,
          initialPos: { ...out.position },
        };
      },
      onMove: (e, snap) => {
        if (this.fitScale <= 0) return;
        // スクリーン px → canvas px は fitScale の逆数
        const dx = (e.clientX - snap.startX) / this.fitScale;
        const dy = (e.clientY - snap.startY) / this.fitScale;
        const next = { x: snap.initialPos.x + dx, y: snap.initialPos.y + dy };
        // drag 中は in-place mutation + commit のみ。fireChange を発火させて他パネルを
        // 丸ごと再描画すると tool 列の mappings/outputs list が DOM rebuild されて
        // ツール窓がフラッシュするため。canvas dim は recompute しない（mutateOutputLayout の
        // 仕様）— drag 終了時に commitOutputLayoutBounds() でまとめて確定する。
        ctrl.mutateOutputLayout(outputId, { position: next });
        ctrl.commit();
        // fitScale も canvas dim も変わらないので、dragged 出力の style だけ更新すれば足りる。
        this.updateDraggedOutputStyle(outputId);
        this.opts?.onOutputLayoutMutated?.();
      },
      onEnd: () => {
        div.classList.remove('dragging');
        // drag 終了時に canvas dim を確定 + 他パネル（mapping タブ・ツール列）を追従させる。
        // replaceState() の fireChange → refreshAllFromState → layoutPanel.refresh() が
        // 走るので、ここで直接 refresh() は呼ばない（二重実行回避）。
        ctrl.commitOutputLayoutBounds();
        ctrl.replaceState(ctrl.getState());
      },
    });
  }

  private attachResizeDrag(handle: HTMLDivElement, outputId: string): () => void {
    const doc = this.doc;
    const ctrl = this.ctrl;
    if (!doc || !ctrl) return () => {};

    type Snap = { startX: number; startY: number; initialSize: { width: number; height: number } };
    return draggable<Snap>(handle, doc, {
      onStart: (e) => {
        const state = ctrl.getState();
        const out = state.outputs.find(o => o.id === outputId);
        if (!out) return null;
        this.setActiveOutput(outputId);
        e.preventDefault();
        e.stopPropagation();
        return {
          startX: e.clientX,
          startY: e.clientY,
          initialSize: { ...out.size },
        };
      },
      onMove: (e, snap) => {
        if (this.fitScale <= 0) return;
        const dw = (e.clientX - snap.startX) / this.fitScale;
        const dh = (e.clientY - snap.startY) / this.fitScale;
        const size = {
          width: Math.max(16, snap.initialSize.width + dw),
          height: Math.max(16, snap.initialSize.height + dh),
        };
        ctrl.mutateOutputLayout(outputId, { size });
        ctrl.commit();
        // 位置 drag と同じ理由で fitScale / canvas dim は更新しない。resize 中の出力の style だけ直接更新。
        this.updateDraggedOutputStyle(outputId);
        this.opts?.onOutputLayoutMutated?.();
      },
      onEnd: () => {
        ctrl.commitOutputLayoutBounds();
        ctrl.replaceState(ctrl.getState());
      },
    });
  }

  /**
   * drag/resize 中の出力 1 件だけ、style.left/top/width/height + label + canvasWindow.transform を
   * 現 state に追従させる。fitScale や他の出力、canvas dim（canvasWindow.width/height や preview の
   * matrix3d 分母）には一切触らない。preview の matrix3d / div サイズと canvasWindow サイズの
   * 整合性を保ったまま、dragged 出力の位置・サイズだけが滑らかに動く。canvas dim の確定は
   * drag 終了時に commitOutputLayoutBounds() + refresh() で 1 回だけ行う。
   */
  private updateDraggedOutputStyle(outputId: string): void {
    const ctrl = this.ctrl;
    if (!ctrl) return;
    const entry = this.outputs.get(outputId);
    if (!entry) return;
    const out = ctrl.getState().outputs.find(o => o.id === outputId);
    if (!out) return;
    entry.div.style.left = `${out.position.x}px`;
    entry.div.style.top = `${out.position.y}px`;
    entry.div.style.width = `${out.size.width}px`;
    entry.div.style.height = `${out.size.height}px`;
    entry.label.textContent =
      `${out.name ?? out.id}  ${Math.round(out.size.width)}×${Math.round(out.size.height)} @ (${Math.round(out.position.x)},${Math.round(out.position.y)})`;
    entry.canvasWindow.style.transform = `translate(${-out.position.x}px, ${-out.position.y}px)`;
  }

  private setActiveOutput(outputId: string): void {
    const ctrl = this.ctrl;
    if (!ctrl) return;
    const cur = ctrl.getState();
    if (cur.activeOutputId === outputId) return;
    ctrl.replaceState(withActiveOutputSet(cur, outputId));
  }
}
