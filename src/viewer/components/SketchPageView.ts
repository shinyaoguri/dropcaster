import type { Sketch } from '../types/sketch.js';
import { UIElementController } from '../ui/services/UIElementController';
import { escapeHtml } from '../utils/html.js';
import {
  isMappingEnabled,
  mappingColor,
  type MappingEntry,
} from '../utils/mappingTransform.js';

export class SketchPageView {
  private openWindowsToggleCallback: (() => void) | null = null;
  private uiController: UIElementController;
  // 投影中、各マッピングのソース切り抜き範囲を示すワイヤーフレーム枠（.dc-source-crop-box）はここに生成される
  private projectionStage: HTMLDivElement | null = null;
  // 直近の mapping-overlay-update の payload を保持（resize / 投影開始時の再描画に使う）
  private lastMappings: MappingEntry[] = [];
  private lastActiveId: string | null = null;
  private isProjecting = false;
  private cropRefreshInterval: ReturnType<typeof setInterval> | null = null;
  /** 直近に描画したクロップ枠の入力シグネチャ（canvas 矩形＋有効マッピング）。変化が無ければ再描画をスキップ。 */
  private lastCropSignature: string | null = null;
  private boundMappingOverlayUpdate = this.handleMappingOverlayUpdate.bind(this);
  private boundResize = this.handleResize.bind(this);
  private boundProjectionModeChange = this.handleProjectionModeChange.bind(this);

  constructor() {
    this.uiController = new UIElementController();
  }

  render(sketch: Sketch): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;

    // userDataの存在チェックとデフォルト値の設定
    const userName = sketch.userData?.userName || 'Unknown User';
    const title = escapeHtml(sketch.title);
    const escapedUserName = escapeHtml(userName);
    // 説明文: 空 or sketch-analyzer のデフォルト ("<id> スケッチ") の場合は非表示扱い
    const rawDescription = (sketch.description ?? '').trim();
    const defaultDescription = `${sketch.id} スケッチ`;
    const hasDescription = !!rawDescription && rawDescription !== defaultDescription;
    const descriptionAttrs = hasDescription ? '' : ' hidden';
    const descriptionText = hasDescription ? escapeHtml(rawDescription) : '';

    app.innerHTML = `
      <div class="fullscreen-sketch-container">
        <!-- スケッチ iframe は SketchPageController が SketchFrame を使ってここに差し込む -->
        <div id="sketch-stage" class="fullscreen-iframe"></div>

        <div class="sketch-info dc-info-panel ui-element">
          <div class="sketch-details">
            <h3 class="sketch-title">${title}</h3>
            <p class="sketch-author"><span class="author-by">by</span> <span class="author-name">${escapedUserName}</span></p>
            <p class="sketch-description"${descriptionAttrs}>${descriptionText}</p>
          </div>
        </div>

        <!-- フルスクリーンボタン -->
        <button
          id="fullscreen-btn"
          class="fullscreen-button top-right-button ui-element"
          title="フルスクリーン"
          aria-label="フルスクリーン"
        >
          <i class="fas fa-expand fullscreen-icon button-icon"></i>
        </button>

        <!-- ウィンドウ開くボタン -->
        <button
          id="open-windows-btn"
          class="open-windows-button top-right-button ui-element"
          title="ウィンドウを開く"
          aria-label="ウィンドウを開く"
        >
          <i class="fas fa-external-link-alt button-icon"></i>
        </button>

        <!-- 投影中のソース可視化レイヤ（前面化して、各マッピングのソース矩形を枠で描く。子は動的生成） -->
        <div id="iframe-content-overlay" class="iframe-content-overlay"></div>

        <!-- inline マウントされた ControlPanel のシェル。投影モードでだけ表示される -->
        <aside id="dc-inline-editor" class="dc-inline-editor" hidden></aside>
      </div>
    `;

    this.setupEventListeners();

    // 投影モード／マッピング更新／リサイズの購読（innerHTML は同期なので #iframe-content-overlay は既に存在）
    window.addEventListener('projection-mode-change', this.boundProjectionModeChange);
    this.projectionStage = document.getElementById('iframe-content-overlay') as HTMLDivElement;
    this.setupMappingOverlayListener();
  }

  private setupEventListeners(): void {
    const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
    const openWindowsBtn = document.getElementById('open-windows-btn') as HTMLButtonElement;

    // フルスクリーンボタン（fullscreenchange は SketchPageController の FullscreenManager が拾い、
    // updateFullscreenState() を呼んでくる ＝ この View 自身は fullscreenchange を購読しない）
    fullscreenBtn.addEventListener('click', () => {
      const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen().catch(err => {
          console.error('フルスクリーン化に失敗しました:', err);
        });
      }
    });

    // ウィンドウ開くボタンのイベント
    openWindowsBtn.addEventListener('click', () => {
      this.openWindowsToggleCallback?.();
    });
  }

  private updateFullscreenUI(isFullscreen: boolean): void {
    this.uiController.setFullscreenActiveState(isFullscreen);
    this.uiController.updateFullscreenButtonIcon(isFullscreen);
    this.uiController.toggleElements(!isFullscreen); // フルスクリーン中は UI ボタン等を隠す
  }

  updateFullscreenState(isFullscreen: boolean): void {
    const container = document.querySelector('.fullscreen-sketch-container') as HTMLDivElement;

    if (isFullscreen) {
      container.classList.add('fullscreen');
    } else {
      container.classList.remove('fullscreen');
    }

    // UI要素の更新も統一的に処理
    this.updateFullscreenUI(isFullscreen);
  }

  private setupMappingOverlayListener(): void {
    window.addEventListener('mapping-overlay-update', this.boundMappingOverlayUpdate);
    // ウィンドウリサイズ時の再計算（matrix3d は親の pixel size 依存）
    window.addEventListener('resize', this.boundResize);
  }

  private handleMappingOverlayUpdate(event: Event): void {
    const detail = (event as CustomEvent).detail;
    this.lastMappings = (detail?.mappings as MappingEntry[]) ?? [];
    this.lastActiveId = (detail?.activeId as string | undefined) ?? null;
    this.renderSourceCropBoxes();
  }

  private handleResize(): void {
    this.renderSourceCropBoxes();
  }

  private handleProjectionModeChange(event: Event): void {
    const detail = (event as CustomEvent).detail;
    const active = !!detail?.active;
    this.isProjecting = active;
    document.querySelector('.fullscreen-sketch-container')?.classList.toggle('projecting', active);

    if (active) {
      this.renderSourceCropBoxes();
      // canvas のリサイズや投影開始直後のレイアウト確定に追従するため、ゆるく再計算する
      if (this.cropRefreshInterval === null) {
        this.cropRefreshInterval = setInterval(() => this.renderSourceCropBoxes(), 250);
      }
    } else {
      if (this.cropRefreshInterval !== null) {
        clearInterval(this.cropRefreshInterval);
        this.cropRefreshInterval = null;
      }
      this.clearSourceCropBoxes();
    }
  }

  /**
   * 投影中のメインウィンドウに、各（有効な）マッピングのソース切り抜き範囲を
   * マッピング色のラベル付きワイヤーフレーム枠として、走っているスケッチ canvas の上に重ねる。
   * ワープ後の映像は出力ウィンドウ（プロジェクタ）と操作ウィンドウのプレビューに任せる。
   */
  private renderSourceCropBoxes(): void {
    const stage = this.projectionStage;
    if (!stage) return;
    if (!this.isProjecting) { this.clearSourceCropBoxes(); return; }

    const canvasRect = this.getCanvasRectInStage(stage);

    // 入力が前回と同じ（canvas が動いていない・マッピングも変わっていない）なら DOM を触らない。
    // 250ms 間隔のリフレッシュが、変化が無いときに毎回スタイルを書き直してリレイアウトを誘発するのを防ぐ。
    const r = (n: number) => Math.round(n * 100) / 100;
    const parts: string[] = [];
    this.lastMappings.forEach((m, idx) => {
      if (!isMappingEnabled(m)) return; // 色は配列内 index に依存するので idx も含める
      parts.push(`${idx}:${m.id}:${r(m.source.x)},${r(m.source.y)},${r(m.source.width)},${r(m.source.height)}:${m.name ?? ''}`);
    });
    const signature = `${r(canvasRect.left)},${r(canvasRect.top)},${r(canvasRect.width)},${r(canvasRect.height)}|${this.lastActiveId ?? ''}|${parts.join(';')}`;
    if (signature === this.lastCropSignature) return;
    this.lastCropSignature = signature;

    const existing = new Map<string, HTMLDivElement>();
    stage.querySelectorAll<HTMLDivElement>(':scope > .dc-source-crop-box').forEach(el => {
      const id = el.dataset.mappingId;
      if (id) existing.set(id, el);
    });

    const seen = new Set<string>();
    this.lastMappings.forEach((mapping, idx) => {
      if (!isMappingEnabled(mapping)) return;
      seen.add(mapping.id);
      const color = mappingColor(idx);

      let box = existing.get(mapping.id);
      if (!box) {
        box = stage.ownerDocument.createElement('div');
        box.className = 'dc-source-crop-box';
        box.dataset.mappingId = mapping.id;
        const label = stage.ownerDocument.createElement('span');
        label.className = 'dc-source-crop-label';
        box.appendChild(label);
        stage.appendChild(box);
      }

      const label = box.querySelector('.dc-source-crop-label') as HTMLSpanElement;
      label.textContent = mapping.name ?? `Mapping ${idx + 1}`;
      box.style.color = color;
      box.style.borderColor = color;
      box.classList.toggle('dc-active', mapping.id === this.lastActiveId);

      const src = mapping.source;
      box.style.left = `${canvasRect.left + (src.x / 100) * canvasRect.width}px`;
      box.style.top = `${canvasRect.top + (src.y / 100) * canvasRect.height}px`;
      box.style.width = `${(src.width / 100) * canvasRect.width}px`;
      box.style.height = `${(src.height / 100) * canvasRect.height}px`;
    });

    existing.forEach((el, id) => {
      if (!seen.has(id)) el.remove();
    });
  }

  private clearSourceCropBoxes(): void {
    this.projectionStage?.querySelectorAll(':scope > .dc-source-crop-box').forEach(el => el.remove());
    this.lastCropSignature = null;
  }

  /**
   * iframe 内の <canvas> が「実際に描画されている矩形」を projectionStage 相対の px で返す。
   * canvas 要素のボックスと描画バッファ（canvas.width × canvas.height）のアスペクト比が違うと
   * object-fit:contain でレターボックスが入るので、その分を差し引いた内側の矩形を返す。
   * canvas が取れない（読み込み前・cross-origin 等）場合は stage 全体を返す。
   */
  private getCanvasRectInStage(stage: HTMLElement): { left: number; top: number; width: number; height: number } {
    const stageRect = stage.getBoundingClientRect();
    const fallback = { left: 0, top: 0, width: stageRect.width, height: stageRect.height };
    const iframe = document.getElementById('sketch-iframe') as HTMLIFrameElement | null;
    if (!iframe) return fallback;
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = (iframe.contentDocument ?? iframe.contentWindow?.document)?.querySelector('canvas') ?? null;
    } catch {
      return fallback;
    }
    if (!canvas) return fallback;

    const iframeRect = iframe.getBoundingClientRect();
    const cRect = canvas.getBoundingClientRect(); // canvas 要素ボックス（iframe ビューポート相対）
    if (cRect.width < 1 || cRect.height < 1) return fallback;

    // object-fit:contain の内側矩形（描画バッファのアスペクト比に合わせてレターボックス）
    const bufW = canvas.width || cRect.width;
    const bufH = canvas.height || cRect.height;
    const scale = Math.min(cRect.width / bufW, cRect.height / bufH);
    const drawW = bufW * scale;
    const drawH = bufH * scale;
    const drawX = cRect.left + (cRect.width - drawW) / 2;
    const drawY = cRect.top + (cRect.height - drawH) / 2;

    return {
      left: iframeRect.left + drawX - stageRect.left,
      top: iframeRect.top + drawY - stageRect.top,
      width: drawW,
      height: drawH,
    };
  }


  onOpenWindowsToggle(callback: () => void): void {
    this.openWindowsToggleCallback = callback;
  }

  destroy(): void {
    if (this.cropRefreshInterval !== null) {
      clearInterval(this.cropRefreshInterval);
      this.cropRefreshInterval = null;
    }
    window.removeEventListener('mapping-overlay-update', this.boundMappingOverlayUpdate);
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('projection-mode-change', this.boundProjectionModeChange);
    this.openWindowsToggleCallback = null;
  }
}
