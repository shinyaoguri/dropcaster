import type { Sketch } from '../types/sketch.js';
import { publicAssetPath } from '../utils/paths.js';
import { SketchPool } from '../runtime/SketchPool.js';
import { WindowController } from './WindowController';
import { ControlWindow } from '../windows/control/ControlWindow';
import { InlineControlHost } from '../windows/control/InlineControlHost';

export class SlideshowView {
  private currentIndex: number = 0;
  private sketchIds: string[] = [];
  private sketches: Sketch[] = [];
  private intervalId: number | null = null;
  private progressBarResetTimeout: number | null = null;
  private isPaused: boolean = false;
  private SLIDE_INTERVAL = 30000; // 30秒
  private boundHandleKeydown = this.handleKeydown.bind(this);
  private pool: SketchPool | null = null;
  // プロジェクションマッピング（出力ウィンドウと inline コントロールパネル）
  private windowController: WindowController | null = null;
  private mappingActive = false;
  private mappingStartTimeout: number | null = null;
  private boundCloseProjectionWindows = () => this.windowController?.closeAllWindows();
  /** projection 中だけ #dc-inline-editor 内にマウントする ControlWindow（inline 経路）。 */
  private inlinePanel: ControlWindow | null = null;

  render(sketchIds: string[], sketches: Sketch[]): void {
    this.sketchIds = sketchIds;
    this.sketches = sketches;
    
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <div class="slideshow-container">
        <div class="slideshow-header">
          <div class="slideshow-left-controls">
            <div class="slideshow-interval-control">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <input type="number" id="interval-input" min="5" max="300" value="${this.SLIDE_INTERVAL / 1000}" />
              <span>秒</span>
            </div>
          </div>
          <div class="slideshow-info">
            <span id="current-sketch-number">${this.currentIndex + 1}</span> / ${sketchIds.length}
          </div>
          <div class="slideshow-controls">
            <button id="prev-btn" class="control-btn" title="前へ">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            <button id="play-pause-btn" class="control-btn" title="一時停止">
              <svg id="pause-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
              </svg>
              <svg id="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: none;">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </button>
            <button id="next-btn" class="control-btn" title="次へ">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
            <button id="fullscreen-btn" class="control-btn" title="フルスクリーン">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </button>
            <button id="mapping-btn" class="control-btn" title="プロジェクションマッピング">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
            </button>
          </div>
          <div class="progress-bar-container">
            <div id="progress-bar" class="progress-bar"></div>
          </div>
        </div>
        <div class="slideshow-frame-container">
          <div id="slideshow-stage"></div>
          <div id="sketch-info" class="sketch-info dc-info-panel">
            <div class="sketch-details">
              <h3 id="sketch-title" class="sketch-title"></h3>
              <p id="sketch-author" class="sketch-author"><span class="author-by">by</span> <span class="author-name"></span></p>
              <p id="sketch-description" class="sketch-description" hidden></p>
            </div>
          </div>
          <!-- inline マウントされた ControlPanel のシェル。投影モード中だけ表示 -->
          <aside id="dc-inline-editor" class="dc-inline-editor" hidden></aside>
        </div>
      </div>
    `;

    this.addStyles();
    this.setupEventListeners();
    // タブが閉じられたらマッピング用の出力ウィンドウも閉じる
    window.addEventListener('pagehide', this.boundCloseProjectionWindows);

    const stage = document.getElementById('slideshow-stage');
    if (stage) this.pool = new SketchPool(stage, { size: 2 });

    if (sketchIds.length > 0) {
      // URLから現在のインデックスを取得
      const urlParams = new URLSearchParams(window.location.search);
      const startIndex = parseInt(urlParams.get('index') || '0', 10);
      this.currentIndex = Number.isFinite(startIndex)
        ? Math.max(0, Math.min(startIndex, sketchIds.length - 1))
        : 0;

      void this.goToSketch(this.currentIndex);
      this.startAutoPlay();
    }
  }

  private addStyles(): void {
    const styleId = 'slideshow-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .slideshow-container {
        width: 100vw;
        height: 100vh;
        background: #000;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
      }

      .slideshow-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%);
        padding: 20px;
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        transition: opacity 0.3s ease;
      }

      .slideshow-container:not(:hover) .slideshow-header {
        opacity: 0;
      }

      .slideshow-container:hover .slideshow-header {
        opacity: 1;
      }

      .slideshow-controls {
        display: flex;
        gap: 15px;
        align-items: center;
      }

      .control-btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      .control-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.5);
        transform: scale(1.1);
      }

      .control-btn:active {
        transform: scale(0.95);
      }

      .control-btn.mapping-active {
        background: rgba(96, 165, 250, 0.35);
        border-color: rgba(96, 165, 250, 0.8);
        color: #bfdbfe;
      }


      .slideshow-left-controls {
        flex: 1;
        display: flex;
        align-items: center;
      }
      
      .slideshow-info {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        color: white;
        font-size: 18px;
        font-weight: 500;
        text-shadow: 0 2px 4px rgba(0,0,0,0.5);
      }
      
      .slideshow-interval-control {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 25px;
        padding: 6px 12px 6px 10px;
        transition: all 0.3s ease;
      }
      
      .slideshow-interval-control:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.25);
      }
      
      .slideshow-interval-control svg {
        color: rgba(255, 255, 255, 0.7);
        flex-shrink: 0;
      }
      
      .slideshow-interval-control input {
        width: 50px;
        padding: 2px 4px;
        background: transparent;
        border: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        font-size: 15px;
        font-weight: 500;
        text-align: center;
        transition: border-color 0.3s ease;
      }
      
      .slideshow-interval-control input:focus {
        outline: none;
        border-bottom-color: rgba(255, 255, 255, 0.6);
      }
      
      .slideshow-interval-control input::-webkit-inner-spin-button,
      .slideshow-interval-control input::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      
      .slideshow-interval-control input[type=number] {
        -moz-appearance: textfield;
      }
      
      .slideshow-interval-control span {
        color: rgba(255, 255, 255, 0.7);
        font-size: 13px;
        font-weight: 400;
      }

      #current-sketch-number {
        font-size: 24px;
        font-weight: bold;
      }

      .progress-bar-container {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #00ff00 0%, #00aa00 100%);
        width: 0;
        transition: width linear;
      }

      .progress-bar.active {
        transition-duration: ${this.SLIDE_INTERVAL}ms;
        width: 100%;
      }

      .slideshow-frame-container {
        flex: 1;
        position: relative;
        width: 100%;
        height: 100%;
      }

      /* スケッチ本体は SketchPool が #slideshow-stage 内に iframe を重ねて表示する（.dc-sketch-* クラス） */

      /* スケッチ情報パネル — 見た目は共通の .dc-info-panel (style.css)。
         ここではスライドショー固有の位置・フェード挙動だけ重ねる。 */
      .slideshow-container .sketch-info {
        position: absolute;
        bottom: 32px;
        right: 32px;
        /* 表示中 iframe（.dc-sketch-frame.dc-visible）が z-index:1 で
           同じ stacking context に持ち上がるため、それより前面に置く。
           マッピング中の .dc-inline-editor (z-index:1500) よりは下。 */
        z-index: 5;
        transition: opacity 0.5s ease;
        opacity: 0;
      }

      .slideshow-container .sketch-info.fade-in {
        opacity: 1;
      }

      .slideshow-container:not(:hover) .sketch-info.fade-in {
        opacity: 0.85;
      }
    `;
    document.head.appendChild(style);
  }

  private setupEventListeners(): void {
    // コントロールボタン
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const mappingBtn = document.getElementById('mapping-btn');
    const intervalInput = document.getElementById('interval-input') as HTMLInputElement;

    prevBtn?.addEventListener('click', () => this.previousSketch());
    nextBtn?.addEventListener('click', () => this.nextSketch());
    playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
    fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    mappingBtn?.addEventListener('click', () => this.toggleMapping());
    
    // 間隔変更
    intervalInput?.addEventListener('change', (e) => {
      const newInterval = parseInt((e.target as HTMLInputElement).value) * 1000;
      if (newInterval >= 5000 && newInterval <= 300000) {
        this.SLIDE_INTERVAL = newInterval;
        // 自動再生中なら再スタート
        if (!this.isPaused) {
          this.restartAutoPlay();
        }
      }
    });

    // キーボードショートカット
    document.addEventListener('keydown', this.boundHandleKeydown);
  }

  private handleKeydown(e: KeyboardEvent): void {
    switch(e.key) {
      case 'ArrowLeft':
        this.previousSketch();
        break;
      case 'ArrowRight':
        this.nextSketch();
        break;
      case ' ':
        e.preventDefault();
        this.togglePlayPause();
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
    }
  }

  // インデックスのスケッチへ移動して表示する（初回・通常の両方に使う）。
  // SketchPool が iframe のクロスフェードと次スケッチの先読みを担当するので、
  // ここではスケッチ情報・URL・番号・プログレスバーの更新だけ行う。
  private async goToSketch(index: number): Promise<void> {
    if (index < 0 || index >= this.sketchIds.length || !this.pool) return;

    this.currentIndex = index;
    const sketchInfo = document.getElementById("sketch-info");

    // URL を更新（履歴には積まない）
    const url = new URL(window.location.href);
    url.searchParams.set("index", index.toString());
    window.history.replaceState({}, "", url.toString());

    // スケッチ番号・プログレスバーを更新
    const numberElement = document.getElementById("current-sketch-number");
    if (numberElement) numberElement.textContent = (index + 1).toString();
    this.resetProgressBar();

    // スケッチをプール経由で表示（先読み済みなら即時、未ロードなら読み込み完了後にクロスフェード）
    const sketchId = this.sketchIds[index];
    try {
      await this.pool.show(publicAssetPath(`sketches/${sketchId}/index.html`));
    } catch {
      return; // プールが破棄された（ルート遷移）— 中断
    }
    if (!this.pool) return;

    // 情報パネルのテキストを更新。fade-in は初回だけ実効（以降はクラスが付いたままなので no-op）。
    // 切替ごとに remove/add するとフェード途中に隠れて「一瞬しか見えない」状態になるので、
    // パネル自体は出しっぱなしにしてテキストだけ差し替える。
    this.updateSketchInfo(index);
    sketchInfo?.classList.add("fade-in");

    // 次のスケッチを先読みしておく（次の自動送りが即時になる）
    const nextIndex = (index + 1) % this.sketchIds.length;
    this.pool.preload(publicAssetPath(`sketches/${this.sketchIds[nextIndex]}/index.html`));

    // マッピング中なら、表示中スケッチをマッピングのソースに切り替える
    if (this.mappingActive) void this.refreshMappingSource();
  }

  private updateSketchInfo(index: number): void {
    const sketch = this.sketches[index];
    if (!sketch) return;

    const titleElement = document.getElementById('sketch-title') as HTMLHeadingElement;
    const authorNameElement = document.querySelector('.author-name') as HTMLSpanElement;
    const descriptionElement = document.getElementById('sketch-description') as HTMLParagraphElement;

    if (titleElement) {
      titleElement.textContent = sketch.title || `Sketch ${sketch.id}`;
    }

    if (authorNameElement) {
      // userDataが存在する場合はユーザ名を使用
      authorNameElement.textContent = sketch.userData?.userName || 'Anonymous';
    }

    if (descriptionElement) {
      // sketch-analyzer のデフォルト（"<dirName> スケッチ"）は実質的に説明が無いケースなので非表示扱い。
      const desc = sketch.description?.trim() ?? '';
      const isDefault = desc === `${sketch.id} スケッチ`;
      if (desc && !isDefault) {
        descriptionElement.textContent = desc;
        descriptionElement.removeAttribute('hidden');
      } else {
        descriptionElement.textContent = '';
        descriptionElement.setAttribute('hidden', '');
      }
    }
  }

  private nextSketch(): void {
    const nextIndex = (this.currentIndex + 1) % this.sketchIds.length;
    void this.goToSketch(nextIndex);
    this.restartAutoPlay();
  }

  private previousSketch(): void {
    const prevIndex = this.currentIndex === 0 ? this.sketchIds.length - 1 : this.currentIndex - 1;
    void this.goToSketch(prevIndex);
    this.restartAutoPlay();
  }

  private startAutoPlay(): void {
    if (this.intervalId) return;

    // プログレスバーアニメーション開始
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
      progressBar.classList.add('active');
    }

    this.intervalId = window.setInterval(() => {
      if (!this.isPaused) {
        this.nextSketch();
      }
    }, this.SLIDE_INTERVAL);
  }

  private stopAutoPlay(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.progressBarResetTimeout) {
      clearTimeout(this.progressBarResetTimeout);
      this.progressBarResetTimeout = null;
    }

    // プログレスバーアニメーション停止
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
      progressBar.classList.remove('active');
      const computedStyle = window.getComputedStyle(progressBar);
      progressBar.style.width = computedStyle.width;
    }
  }

  private restartAutoPlay(): void {
    if (!this.isPaused) {
      this.stopAutoPlay();
      this.startAutoPlay();
    }
  }

  private resetProgressBar(): void {
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
      progressBar.classList.remove('active');
      progressBar.style.width = '0';
      // 少し遅延してからアニメーション開始（連打時に古いタイマーが残らないよう毎回張り直す）
      if (this.progressBarResetTimeout) clearTimeout(this.progressBarResetTimeout);
      this.progressBarResetTimeout = window.setTimeout(() => {
        this.progressBarResetTimeout = null;
        if (!this.isPaused) {
          progressBar.classList.add('active');
        }
      }, 50);
    }
  }

  private togglePlayPause(): void {
    this.isPaused = !this.isPaused;
    
    const pauseIcon = document.getElementById('pause-icon');
    const playIcon = document.getElementById('play-icon');
    
    if (this.isPaused) {
      this.stopAutoPlay();
      if (pauseIcon) pauseIcon.style.display = 'none';
      if (playIcon) playIcon.style.display = 'block';
    } else {
      this.startAutoPlay();
      if (pauseIcon) pauseIcon.style.display = 'block';
      if (playIcon) playIcon.style.display = 'none';
    }
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // --- プロジェクションマッピング（ポップアウトのコントロール／出力ウィンドウ） ---

  private toggleMapping(): void {
    if (this.mappingActive) {
      this.stopMapping();
    } else {
      this.startMapping();
    }
  }

  private startMapping(): void {
    if (!this.windowController) this.windowController = new WindowController();
    // クリックの user gesture 内で出力ウィンドウを開く。
    // 編集 UI は inline ペインとしてスライドショーの右側にマウントする。
    this.windowController.openOutputWindow();
    this.mappingActive = true;
    this.updateMappingButton();
    this.mountInlineEditor();
    // 出力ウィンドウが開いてから（SketchPageController と同じく）少し待ってストリーミング開始
    this.mappingStartTimeout = window.setTimeout(() => {
      this.mappingStartTimeout = null;
      void this.refreshMappingSource({ start: true });
    }, 2000);
  }

  private stopMapping(): void {
    if (this.mappingStartTimeout) {
      clearTimeout(this.mappingStartTimeout);
      this.mappingStartTimeout = null;
    }
    this.unmountInlineEditor();
    // closeAllWindows() が stopCanvasStreaming() ＋ コントロール／出力ウィンドウのクローズを行う
    this.windowController?.closeAllWindows();
    this.mappingActive = false;
    this.updateMappingButton();
  }

  private mountInlineEditor(): void {
    if (this.inlinePanel || !this.windowController) return;
    const aside = document.getElementById('dc-inline-editor');
    if (!aside) return;
    aside.removeAttribute('hidden');
    const wc = this.windowController;
    this.inlinePanel = new ControlWindow();
    this.inlinePanel.mountInline(aside, (shell) =>
      new InlineControlHost(window, shell, wc),
    );
    // 既にストリームが流れていれば bind し直す（mount が broadcastStream より後に来た場合の保険）
    wc.rebindStreamToInlinePanel();
  }

  private unmountInlineEditor(): void {
    if (!this.inlinePanel) return;
    this.inlinePanel.destroy();
    this.inlinePanel = null;
    const aside = document.getElementById('dc-inline-editor');
    if (aside) {
      aside.setAttribute('hidden', '');
      aside.innerHTML = '';
    }
  }

  /** いま表示中のスケッチをマッピングのソースにする。canvas が出来るのを待ってから差し替える。 */
  private async refreshMappingSource(opts: { start?: boolean } = {}): Promise<void> {
    const frame = this.pool?.current;
    if (!frame || !this.windowController || !this.mappingActive) return;
    await frame.whenCanvasReady();
    if (!this.windowController || !this.mappingActive) return;
    if (opts.start) {
      this.windowController.startCanvasStreaming(frame.iframe);
    } else {
      this.windowController.setSource(frame.iframe);
    }
  }

  private updateMappingButton(): void {
    document.getElementById('mapping-btn')?.classList.toggle('mapping-active', this.mappingActive);
  }


  public destroy(): void {
    this.stopAutoPlay();
    document.removeEventListener('keydown', this.boundHandleKeydown);
    window.removeEventListener('pagehide', this.boundCloseProjectionWindows);
    if (this.mappingStartTimeout) {
      clearTimeout(this.mappingStartTimeout);
      this.mappingStartTimeout = null;
    }
    this.unmountInlineEditor();
    this.windowController?.stopCanvasStreaming();
    this.windowController?.destroy();
    this.windowController = null;
    this.mappingActive = false;
    this.pool?.destroy();
    this.pool = null;
  }
}
