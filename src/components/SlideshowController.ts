import type { Sketch } from '../types/sketch.js';
import { SlideshowView } from './SlideshowView';

export class SlideshowController {
  private view: SlideshowView;

  constructor() {
    this.view = new SlideshowView();
  }

  /**
   * スライドショーを開始
   */
  public start(sketches: Sketch[]): void {
    console.log('SlideshowController: スライドショー開始', {
      sketchCount: sketches.length
    });

    
    if (sketches.length === 0) {
      console.warn('SlideshowController: スケッチがありません');
      this.showEmptyState();
      return;
    }

    // スケッチIDの配列を作成
    const sketchIds = sketches.map(sketch => sketch.id);
    
    // ビューをレンダリング（スケッチ情報も渡す）
    this.view.render(sketchIds, sketches);
  }

  /**
   * スケッチがない場合の表示
   */
  private showEmptyState(): void {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <div style="
        width: 100vw;
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #000;
        color: #fff;
      ">
        <h2 style="margin-bottom: 20px;">スケッチがありません</h2>
        <p style="margin-bottom: 30px; color: #888;">表示できるスケッチが見つかりませんでした</p>
        <button onclick="window.location.href='/'" style="
          padding: 12px 24px;
          background: #333;
          border: 1px solid #555;
          color: #fff;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        ">
          ギャラリーに戻る
        </button>
      </div>
    `;
  }

  /**
   * クリーンアップ
   */
  public destroy(): void {
    console.log('SlideshowController: クリーンアップ');
    this.view.destroy();
  }
}