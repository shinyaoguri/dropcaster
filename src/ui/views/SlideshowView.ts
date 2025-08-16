import type { Sketch } from '../../types/sketch.js';

export class SlideshowView {
  private currentIndex: number = 0;
  private sketchIds: string[] = [];
  private sketches: Sketch[] = [];
  private intervalId: number | null = null;
  private isPaused: boolean = false;
  private SLIDE_INTERVAL = 30000; // 30秒

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
          </div>
          <div class="progress-bar-container">
            <div id="progress-bar" class="progress-bar"></div>
          </div>
        </div>
        <div class="slideshow-frame-container">
          <iframe id="slideshow-frame" class="slideshow-frame" frameborder="0"></iframe>
          <div id="sketch-info" class="sketch-info">
            <img id="sketch-avatar" class="sketch-avatar" src="" alt="">
            <div class="sketch-details">
              <h3 id="sketch-title" class="sketch-title"></h3>
              <p id="sketch-author" class="sketch-author"><span class="author-by">by</span> <span class="author-name"></span></p>
            </div>
          </div>
        </div>
      </div>
    `;

    this.addStyles();
    this.setupEventListeners();
    
    if (sketchIds.length > 0) {
      // URLから現在のインデックスを取得
      const urlParams = new URLSearchParams(window.location.search);
      const startIndex = parseInt(urlParams.get('index') || '0', 10);
      this.currentIndex = Math.min(startIndex, sketchIds.length - 1);
      
      // 初回表示時は特別な処理
      this.showInitialSketch(this.currentIndex);
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

      .slideshow-frame {
        width: 100%;
        height: 100%;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.5s ease-in-out;
      }
      
      .slideshow-frame.fade-in {
        opacity: 1;
      }
      
      /* iframe内のcanvasを中央配置 */
      .slideshow-frame-container {
        position: relative;
      }
      
      /* スケッチ情報 */
      .sketch-info {
        position: absolute;
        bottom: 30px;
        right: 30px;
        display: flex;
        align-items: center;
        gap: 15px;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        padding: 15px 20px;
        border-radius: 12px;
        color: white;
        transition: opacity 0.5s ease;
        max-width: 400px;
        opacity: 0;
      }
      
      .sketch-info.fade-in {
        opacity: 1;
      }
      
      .slideshow-container:not(:hover) .sketch-info.fade-in {
        opacity: 0.7;
      }
      
      .sketch-avatar {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid rgba(255, 255, 255, 0.3);
      }
      
      .sketch-details {
        flex: 1;
        min-width: 0;
      }
      
      .sketch-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .sketch-author {
        margin: 4px 0 0 0;
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: baseline;
      }
      
      .author-by {
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
        margin-right: 4px;
      }
      
      .author-name {
        color: rgba(255, 255, 255, 0.9);
      }

      /* キーボードショートカットのヒント */
      .keyboard-hint {
        position: absolute;
        bottom: 20px;
        right: 20px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
        background: rgba(0, 0, 0, 0.5);
        padding: 10px;
        border-radius: 5px;
        backdrop-filter: blur(10px);
        transition: opacity 0.3s ease;
      }

      .slideshow-container:not(:hover) .keyboard-hint {
        opacity: 0;
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
    const intervalInput = document.getElementById('interval-input') as HTMLInputElement;

    prevBtn?.addEventListener('click', () => this.previousSketch());
    nextBtn?.addEventListener('click', () => this.nextSketch());
    playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
    fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    
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
    document.addEventListener('keydown', this.handleKeydown.bind(this));

    // フルスクリーン切り替え
    document.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') {
        this.toggleFullscreen();
      }
    });
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
    }
  }

  private showInitialSketch(index: number): void {
    if (index < 0 || index >= this.sketchIds.length) return;

    this.currentIndex = index;
    const sketchId = this.sketchIds[index];
    const frame = document.getElementById('slideshow-frame') as HTMLIFrameElement;
    const sketchInfo = document.getElementById('sketch-info');
    
    // スケッチ情報を更新
    this.updateSketchInfo(index);

    // URLを更新（ブラウザの履歴に追加しない）
    const url = new URL(window.location.href);
    url.searchParams.set('index', index.toString());
    window.history.replaceState({}, '', url.toString());

    // スケッチ番号を更新
    const numberElement = document.getElementById('current-sketch-number');
    if (numberElement) {
      numberElement.textContent = (index + 1).toString();
    }

    // プログレスバーをリセット
    this.resetProgressBar();
    
    if (frame) {
      // スケッチのHTMLファイルを直接表示（UIなし）
      frame.src = `/sketches/${sketchId}/index.html`;
      
      // iframeが読み込まれたら、canvasを中央配置
      frame.addEventListener('load', () => {
        try {
          const iframeDoc = frame.contentDocument || frame.contentWindow?.document;
          if (iframeDoc) {
            // bodyにスタイルを適用してcanvasを中央配置
            const style = iframeDoc.createElement('style');
            style.textContent = `
              body {
                margin: 0;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #000;
              }
              canvas {
                display: block;
                max-width: 100%;
                max-height: 100vh;
              }
            `;
            iframeDoc.head.appendChild(style);
          }
        } catch (e) {
          // クロスオリジンの場合はアクセスできないので無視
        }
        
        // フェードイン
        setTimeout(() => {
          frame.classList.add('fade-in');
          sketchInfo?.classList.add('fade-in');
        }, 500);
      }, { once: true });
    }
  }

  private showSketch(index: number): void {
    if (index < 0 || index >= this.sketchIds.length) return;

    this.currentIndex = index;
    const sketchId = this.sketchIds[index];
    const frame = document.getElementById('slideshow-frame') as HTMLIFrameElement;
    const sketchInfo = document.getElementById('sketch-info');
    
    // フェードアウト
    frame?.classList.remove('fade-in');
    sketchInfo?.classList.remove('fade-in');
    
    // 完全に暗転させる時間を確保
    setTimeout(() => {
      // スケッチ情報を更新
      this.updateSketchInfo(index);

      // URLを更新（ブラウザの履歴に追加しない）
      const url = new URL(window.location.href);
      url.searchParams.set('index', index.toString());
      window.history.replaceState({}, '', url.toString());

      // スケッチ番号を更新
      const numberElement = document.getElementById('current-sketch-number');
      if (numberElement) {
        numberElement.textContent = (index + 1).toString();
      }

      // プログレスバーをリセット
      this.resetProgressBar();
      
      // さらに少し待ってから新しいコンテンツをロード
      setTimeout(() => {
        if (frame) {
          // スケッチのHTMLファイルを直接表示（UIなし）
          frame.src = `/sketches/${sketchId}/index.html`;
          
          // iframeが読み込まれたら、canvasを中央配置
          frame.addEventListener('load', () => {
            try {
              const iframeDoc = frame.contentDocument || frame.contentWindow?.document;
              if (iframeDoc) {
                // bodyにスタイルを適用してcanvasを中央配置
                const style = iframeDoc.createElement('style');
                style.textContent = `
                  body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    background: #000;
                  }
                  canvas {
                    display: block;
                    max-width: 100%;
                    max-height: 100vh;
                  }
                `;
                iframeDoc.head.appendChild(style);
              }
            } catch (e) {
              // クロスオリジンの場合はアクセスできないので無視
            }
            
            // フェードイン
            setTimeout(() => {
              frame.classList.add('fade-in');
              sketchInfo?.classList.add('fade-in');
            }, 500);
          }, { once: true });
        }
      }, 100); // 完全な暗転を確保
    }, 500); // フェードアウトの時間
  }
  
  private updateSketchInfo(index: number): void {
    const sketch = this.sketches[index];
    if (!sketch) return;
    
    const titleElement = document.getElementById('sketch-title') as HTMLHeadingElement;
    const authorNameElement = document.querySelector('.author-name') as HTMLSpanElement;
    const avatarElement = document.getElementById('sketch-avatar') as HTMLImageElement;
    
    if (titleElement) {
      titleElement.textContent = sketch.title || `Sketch ${sketch.id}`;
    }
    
    if (authorNameElement) {
      // userDataが存在する場合はユーザ名を使用
      authorNameElement.textContent = sketch.userData?.userName || 'Anonymous';
    }
    
    if (avatarElement) {
      // アバター画像があれば設定、なければデフォルトアバター
      const avatarUrl = sketch.userData?.avatarUrl || sketch.userData?.avatarFile;
      if (avatarUrl) {
        avatarElement.src = avatarUrl;
        avatarElement.style.display = 'block';
        // 既存のデフォルトアバターを削除
        const existingDefault = avatarElement.parentElement?.querySelector('.default-avatar');
        if (existingDefault) {
          existingDefault.remove();
        }
      } else {
        // デフォルトアバターを生成（名前の頭文字）
        const userName = sketch.userData?.userName || 'Anonymous';
        const initial = userName[0].toUpperCase();
        avatarElement.style.display = 'none';
        const avatarContainer = avatarElement.parentElement;
        if (avatarContainer) {
          const defaultAvatar = document.createElement('div');
          defaultAvatar.className = 'default-avatar';
          defaultAvatar.textContent = initial;
          defaultAvatar.style.cssText = `
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: bold;
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.3);
          `;
          const existingDefault = avatarContainer.querySelector('.default-avatar');
          if (existingDefault) {
            existingDefault.remove();
          }
          avatarContainer.insertBefore(defaultAvatar, avatarContainer.firstChild);
        }
      }
    }
  }

  private nextSketch(): void {
    const nextIndex = (this.currentIndex + 1) % this.sketchIds.length;
    this.showSketch(nextIndex);
    this.restartAutoPlay();
  }

  private previousSketch(): void {
    const prevIndex = this.currentIndex === 0 ? this.sketchIds.length - 1 : this.currentIndex - 1;
    this.showSketch(prevIndex);
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
      // 少し遅延してからアニメーション開始
      setTimeout(() => {
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


  public destroy(): void {
    this.stopAutoPlay();
    document.removeEventListener('keydown', this.handleKeydown);
  }
}