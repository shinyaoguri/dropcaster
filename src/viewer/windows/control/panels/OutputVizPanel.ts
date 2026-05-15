/**
 * マッピングカラムの「ディスプレイ枠＋出力ウィンドウ枠」可視化と、
 * ソースカラムの canvas アスペクト比（CSS カスタムプロパティ）を担当する panel。
 *
 * 入力は ControlWindow が保持する outputBounds / videoDimensions / sourceVideo の
 * スナップショットで、attach 時に渡された getter 群で都度読む（mirror しない）。
 * 「window-frame のサイズが変わったので quad の matrix3d を再計算してほしい」という
 * 副次要求は onWindowFrameReflow コールバックで親に通知する。
 */

import type { OutputBoundsSnapshot, VideoDimensions } from '../ControlHost';

export interface OutputVizPanelAttachOptions {
  getOutputBounds: () => OutputBoundsSnapshot;
  getVideoDimensions: () => VideoDimensions;
  getSourceVideo: () => HTMLVideoElement | null;
  onWindowFrameReflow: () => void;
}

export class OutputVizPanel {
  private scope: HTMLElement | null = null;
  private opts: OutputVizPanelAttachOptions | null = null;

  attach(scope: HTMLElement, opts: OutputVizPanelAttachOptions): void {
    this.scope = scope;
    this.opts = opts;
    this.refresh();
  }

  /** 出力ウィンドウ枠 + アスペクト比 を両方再描画する。 */
  refresh(): void {
    this.renderOutputViz();
    this.renderAspectRatio();
  }

  /** outputBounds 変更時に出力ウィンドウ枠だけ更新したい時の入口（オプション）。 */
  refreshOutputViz(): void {
    this.renderOutputViz();
  }

  /** loadedmetadata 等で videoDimensions が変わった時にアスペクト比だけ更新したい時の入口。 */
  refreshAspectRatio(): void {
    this.renderAspectRatio();
  }

  destroy(): void {
    this.scope = null;
    this.opts = null;
  }

  /**
   * 「ディスプレイに対する出力ウィンドウの大きさ」と全画面状態を可視化する。
   * 寸法・全画面状態は WindowController から push される（ControlHost 経由）。
   */
  private renderOutputViz(): void {
    const scope = this.scope;
    const opts = this.opts;
    if (!scope || !opts) return;
    const { innerWidth: w, innerHeight: h, screenWidth: sw, screenHeight: sh, isFullscreen } = opts.getOutputBounds();

    // ステータスバッジ（ウィンドウ／フルスクリーン）はデータが無くても更新できる
    const displayMode = scope.querySelector('#display-mode');
    if (displayMode) displayMode.textContent = isFullscreen ? 'フルスクリーン' : 'ウィンドウ';
    const displayStatus = scope.querySelector('.display-status');
    if (displayStatus) {
      displayStatus.classList.remove('fullscreen', 'window');
      displayStatus.classList.add(isFullscreen ? 'fullscreen' : 'window');
    }

    // 出力ウィンドウがまだ開いていない等で寸法が無いときはプレースホルダのまま
    if (sw <= 0 || sh <= 0) return;

    const displaySize = scope.querySelector('#display-size');
    if (displaySize) displaySize.textContent = `${sw}x${sh}`;
    // ディスプレイ寸法のアスペクトを scope に注入。.display-frame の aspect-ratio と
    // width 計算（min(..., calc(100cqh * aspect))）の両方で参照される。canvas 側と同じ
    // 理由で「分数形式」と「数値形式」の 2 つを置く（aspect-ratio は分数を受けるが、
    // calc() の掛け算には数値が要る）。
    scope.style.setProperty('--display-aspect', `${sw} / ${sh}`);
    scope.style.setProperty('--display-aspect-num', `${sw / sh}`);

    const windowSize = scope.querySelector('#window-size');
    if (windowSize) windowSize.textContent = w > 0 && h > 0 ? `${w}x${h}` : '—';

    const windowFrame = scope.querySelector('#window-frame') as HTMLDivElement | null;
    if (windowFrame) {
      const wPct = w > 0 ? Math.min(100, (w / sw) * 100) : 100;
      const hPct = h > 0 ? Math.min(100, (h / sh) * 100) : 100;
      windowFrame.style.position = 'absolute';
      windowFrame.style.left = '50%';
      windowFrame.style.top = '50%';
      windowFrame.style.transform = 'translate(-50%, -50%)';
      windowFrame.style.width = `${wPct}%`;
      windowFrame.style.height = `${hPct}%`;
      windowFrame.classList.toggle('fullscreen', isFullscreen);
    }

    // #window-frame（= #mapping-area の祖先）のサイズが変わったので quad の matrix3d を再計算
    opts.onWindowFrameReflow();
  }

  /**
   * ソース canvas のアスペクト比を CSS カスタムプロパティ --canvas-aspect として scope に注入する。
   * .canvas-frame 側で `aspect-ratio: var(--canvas-aspect)` + `max-width/height: 100%` を当てて
   * いるので、レイアウトとリサイズの追従はブラウザ任せ（カラム幅をドラッグしても比率は固定）。
   */
  private renderAspectRatio(): void {
    const scope = this.scope;
    const opts = this.opts;
    if (!scope || !opts) return;
    const dims = opts.getVideoDimensions();
    const video = opts.getSourceVideo();
    const canvasWidth = dims.width || video?.videoWidth || 1920;
    const canvasHeight = dims.height || video?.videoHeight || 1080;
    if (canvasWidth <= 0 || canvasHeight <= 0) return;
    // 分数形式は CSS の aspect-ratio プロパティ用。数値形式は canvas-frame の width 計算
    // （min(..., calc(100cqh * aspect))）で掛け算に使うため別途必要。
    scope.style.setProperty('--canvas-aspect', `${canvasWidth} / ${canvasHeight}`);
    scope.style.setProperty('--canvas-aspect-num', `${canvasWidth / canvasHeight}`);
  }
}
