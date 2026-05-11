// プロジェクションマッピングの校正用に、一時的にソース映像をテストパターンへ差し替えるための
// MediaStream ソース。
//
// 仕組み: オフスクリーンの <canvas> にパターンを描画して captureStream(fps) で取り出す。
// 動きが要らない静的パターンでも、fps を指定しているのでデコーダ側にフレームが流れ続ける
// （描画変化に依存する captureStream(0) のフォールバック動作ではない）。
// 出力は WindowController が普段の sketch canvas のストリームと同じ経路で配信するので、
// SketchPageView の overlay 群・control window のプレビュー・OutputWindow の各 mapping video が
// そのまま流用される（マッピング設定はそのまま、ソースだけが差し替わる）。

export type TestPatternKind = 'white' | 'grid' | 'smpte';

const PATTERN_WIDTH = 1920;
const PATTERN_HEIGHT = 1080;
const PATTERN_FPS = 10; // 静的パターンなので低 fps で十分。fps 指定により描画変化なしでもフレームが出る

export class TestPatternSource {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private current: TestPatternKind = 'white';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = PATTERN_WIDTH;
    canvas.height = PATTERN_HEIGHT;
    // 一部のブラウザは DOM に居る canvas でないと captureStream が安定しないので
    // 視界外に置いておく（display:none は描画コンテキストが落ちる可能性があるので避ける）
    canvas.style.cssText = 'position:fixed; left:-99999px; top:-99999px; width:1px; height:1px; pointer-events:none; opacity:0;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('TestPatternSource: 2D context が取れません');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** パターンを切り替え（または初回開始）して MediaStream を返す。stop() 後に再 start すると新しい stream を返す。 */
  start(kind: TestPatternKind): MediaStream | null {
    this.current = kind;
    this.draw();
    if (!this.stream || this.streamIsDead()) {
      const c = this.canvas as HTMLCanvasElement & { captureStream?(fps?: number): MediaStream };
      if (!c.captureStream) return null;
      try {
        this.stream = c.captureStream(PATTERN_FPS);
      } catch (error) {
        console.error('TestPatternSource: captureStream に失敗', error);
        return null;
      }
    }
    return this.stream;
  }

  /** stream の tracks を停止する（次回 start で新しい stream を作る）。canvas は残す。 */
  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  /** 完全に破棄（canvas を DOM から外す）。 */
  dispose(): void {
    this.stop();
    this.canvas.remove();
  }

  private streamIsDead(): boolean {
    return !!this.stream && this.stream.getTracks().every(t => t.readyState === 'ended');
  }

  private draw(): void {
    switch (this.current) {
      case 'white': return this.drawWhite();
      case 'grid':  return this.drawGrid();
      case 'smpte': return this.drawSmpteBars();
    }
  }

  private drawWhite(): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawGrid(): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 通常グリッド（80px ピッチ）
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const step = 80;
    ctx.beginPath();
    for (let x = step; x < canvas.width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
    }
    for (let y = step; y < canvas.height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
    }
    ctx.stroke();

    // 中心十字（太め）— アライメントの基準
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // 四隅マーカー
    const m = 60;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, m, m);
    ctx.strokeRect(canvas.width - m - 2, 2, m, m);
    ctx.strokeRect(2, canvas.height - m - 2, m, m);
    ctx.strokeRect(canvas.width - m - 2, canvas.height - m - 2, m, m);

    // 中心の円（外周の歪みを目視で確認）
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** SMPTE/EBU 75% カラーバーズ風（厳密な放送規格ではなく、見た目を踏襲した簡易版） */
  private drawSmpteBars(): void {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;

    // 上段 2/3: 7 色バー（白・黄・シアン・緑・マゼンタ・赤・青、75% 輝度）
    const upperColors = ['#bfbfbf', '#bfbf00', '#00bfbf', '#00bf00', '#bf00bf', '#bf0000', '#0000bf'];
    const upperH = H * 2 / 3;
    const barW = W / upperColors.length;
    upperColors.forEach((c, i) => {
      ctx.fillStyle = c;
      // 1px 余分に伸ばして縦縞の隙間を防ぐ
      ctx.fillRect(Math.floor(i * barW), 0, Math.ceil(barW) + 1, upperH);
    });

    // 中段 1/12: リバース色バー（青・黒・マゼンタ・黒・シアン・黒・白）
    const middleColors = ['#0000bf', '#191919', '#bf00bf', '#191919', '#00bfbf', '#191919', '#bfbfbf'];
    const middleH = H / 12;
    middleColors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(i * barW), upperH, Math.ceil(barW) + 1, middleH);
    });

    // 下段 1/4: PLUGE（黒レベル校正）と I/Q 色信号サンプル
    const lowerY = upperH + middleH;
    const lowerH = H - upperH - middleH;

    // 左 5/7: I 信号 (-I)・白・Q 信号 (+Q)・黒（基準）
    const slot = W / 7; // 同じ slot 幅で 4 つ並べる
    ctx.fillStyle = '#001940'; ctx.fillRect(0, lowerY, slot * 1.25, lowerH);            // -I（青寄り）
    ctx.fillStyle = '#fff';    ctx.fillRect(slot * 1.25, lowerY, slot * 1.5, lowerH);   // 100% 白
    ctx.fillStyle = '#2c1959'; ctx.fillRect(slot * 1.25 + slot * 1.5, lowerY, slot * 1.25, lowerH); // +Q（紫寄り）
    ctx.fillStyle = '#191919'; ctx.fillRect(slot * 4, lowerY, slot * 0.75, lowerH);     // 黒

    // 右側に PLUGE: super-black / black / sub-white を細い 3 ブロックで
    const plugeX0 = slot * 4.75;
    const plugeW = (W - plugeX0) / 3;
    ctx.fillStyle = '#0e0e0e'; ctx.fillRect(plugeX0,              lowerY, plugeW, lowerH); // -4% (super-black)
    ctx.fillStyle = '#191919'; ctx.fillRect(plugeX0 + plugeW,     lowerY, plugeW, lowerH); //  0% (black)
    ctx.fillStyle = '#262626'; ctx.fillRect(plugeX0 + plugeW * 2, lowerY, plugeW, lowerH); // +4% (above-black)
  }
}
