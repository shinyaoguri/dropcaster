// プロジェクションマッピングの校正用に、一時的にソース映像をテストパターンへ差し替えるための
// MediaStream ソース。
//
// 仕組み: オフスクリーンの <canvas> にパターンを描画して captureStream(fps) で取り出す。
// 動きが要らない静的パターンでも、fps を指定しているのでデコーダ側にフレームが流れ続ける
// （描画変化に依存する captureStream(0) のフォールバック動作ではない）。
// 動くパターン（motion / scroll）は requestAnimationFrame で描き直す。位置・番号は経過時間から
// 決めるので、描画が遅れても動きの速さは変わらず、遅れはコマ帯・番号の飛びとして見える。
// rAF なので操作画面のタブが背面に回ると止まる（作品の draw と同じ制約）。
// 出力は WindowController が普段の sketch canvas のストリームと同じ経路で配信するので、
// SketchPageView の overlay 群・control window のプレビュー・OutputWindow の各 mapping video が
// そのまま流用される（マッピング設定はそのまま、ソースだけが差し替わる）。

export type TestPatternKind = 'white' | 'grid' | 'smpte' | 'motion' | 'scroll';

const PATTERN_WIDTH = 1920;
const PATTERN_HEIGHT = 1080;
// 動くパターンを滑らかに流すため 60fps。fps 指定により静的パターンでも描画変化なしでフレームが出る。
// パターン切替で stream を作り直さないので、静的・動的で共通の値にしている。
const PATTERN_FPS = 60;
/** 動くパターンの時間軸。フレーム番号とコマ帯はこの刻みで進む。 */
const MOTION_FPS = 60;
const GRID_STEP = 80;

const isAnimated = (kind: TestPatternKind): boolean => kind === 'motion' || kind === 'scroll';

export class TestPatternSource {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private current: TestPatternKind = 'white';
  private rafId: number | null = null;
  private animationStart = 0;
  private lastFrame = -1;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = PATTERN_WIDTH;
    canvas.height = PATTERN_HEIGHT;
    // 一部のブラウザは DOM に居る canvas でないと captureStream が安定しないので
    // 視界外に置いておく（display:none は描画コンテキストが落ちる可能性があるので避ける）
    canvas.style.cssText = 'position:fixed; left:-99999px; top:-99999px; width:1px; height:1px; pointer-events:none; opacity:0;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('TestPatternSource: failed to acquire 2D context');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** パターンを切り替え（または初回開始）して MediaStream を返す。stop() 後に再 start すると新しい stream を返す。 */
  start(kind: TestPatternKind): MediaStream | null {
    this.stopAnimation();
    this.current = kind;
    this.animationStart = performance.now();
    this.lastFrame = -1;
    this.draw(this.animationStart);
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
    if (isAnimated(kind)) this.startAnimation();
    return this.stream;
  }

  /** stream の tracks を停止する（次回 start で新しい stream を作る）。canvas は残す。 */
  stop(): void {
    this.stopAnimation();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  /** 完全に破棄（canvas を DOM から外す）。 */
  dispose(): void {
    this.stop();
    this.canvas.remove();
  }

  private streamIsDead(): boolean {
    return !!this.stream && this.stream.getTracks().every(t => t.readyState === 'ended');
  }

  private startAnimation(): void {
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      this.draw(now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private draw(now: number): void {
    const elapsed = Math.max(0, now - this.animationStart);
    const frame = Math.floor(elapsed * MOTION_FPS / 1000);
    // 高リフレッシュレートの画面では同じフレームを描き直さない
    if (isAnimated(this.current) && frame === this.lastFrame) return;
    this.lastFrame = frame;
    switch (this.current) {
      case 'white':  return this.drawWhite();
      case 'grid':   return this.drawGrid();
      case 'smpte':  return this.drawSmpteBars();
      case 'motion': return this.drawMotion(frame);
      case 'scroll': return this.drawScroll(frame);
    }
  }

  /**
   * 滑らかさ・コマ落ち・出力間の遅延を見るパターン。
   * 往復する縦横のバー、1 秒で 1 周する針、フレーム番号と経過時間、60 マスのコマ帯を描く。
   * 位置はすべてフレーム番号 (60fps の時間軸) から決める。
   */
  private drawMotion(frame: number): void {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const seconds = frame / MOTION_FPS;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // 往復するバー: 縦バーは 4 秒、横バーは 3 秒で 1 往復（周期をずらして同じ絵の繰り返しを避ける）
    const pingPong = (period: number) => {
      const p = (seconds % period) / period;
      return p < 0.5 ? p * 2 : 2 - p * 2;
    };
    const barW = 24;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(pingPong(4) * (W - barW)), 0, barW, H);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(0, Math.round(pingPong(3) * (H - barW)), W, barW);

    // 中心円と 1 秒で 1 周する針
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.3;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
    // 目盛り: 60 本（1 フレームごと）、10 本ごとに長く
    for (let i = 0; i < MOTION_FPS; i++) {
      const a = (i / MOTION_FPS) * Math.PI * 2 - Math.PI / 2;
      const inner = r * (i % 10 === 0 ? 0.86 : 0.93);
      ctx.lineWidth = i % 10 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
    const handAngle = ((frame % MOTION_FPS) / MOTION_FPS) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(handAngle) * r * 0.82, cy + Math.sin(handAngle) * r * 0.82);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // フレーム番号と経過時間 (mm:ss.mmm)
    const ms = Math.floor(seconds * 1000);
    const pad = (n: number, w: number) => String(n).padStart(w, '0');
    const time = `${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 120px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(String(frame), cx, cy - 40);
    ctx.font = 'bold 56px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(time, cx, cy + 70);

    // コマ帯: 60 マスのうち現フレームのマスだけ点灯。飛んだマスがコマ落ち
    const cells = MOTION_FPS;
    const margin = 40;
    const cellW = (W - margin * 2) / cells;
    const cellY = H - 90;
    const cellH = 50;
    const lit = frame % cells;
    for (let i = 0; i < cells; i++) {
      ctx.fillStyle = i === lit ? '#22c55e' : (i % 10 === 0 ? '#444' : '#222');
      ctx.fillRect(margin + i * cellW + 1, cellY, cellW - 2, cellH);
    }
  }

  /**
   * 面と面のつなぎ目を見るパターン。チェッカーと格子を斜め方向へ一定速度で流す。
   * 隣り合う面の境界で模様が途切れずに流れるかを見る。
   */
  private drawScroll(frame: number): void {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const step = GRID_STEP;
    // 1 秒あたり 120px 右、60px 下へ流れる。模様は 2 マス周期なので 2*step で巻き戻す
    const seconds = frame / MOTION_FPS;
    const ox = (seconds * 120) % (step * 2);
    const oy = (seconds * 60) % (step * 2);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d4d4d4';
    for (let gy = -2; gy * step + oy < H; gy++) {
      for (let gx = -2; gx * step + ox < W; gx++) {
        if ((gx + gy) % 2 !== 0) continue;
        ctx.fillRect(Math.round(gx * step + ox), Math.round(gy * step + oy), step, step);
      }
    }
    // 格子の境目を 1 マスおきに色線で強調し、流れる方向とずれを読みやすくする
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 8; // 出力で縮小されても消えない太さ
    ctx.beginPath();
    for (let gx = -2; gx * step + ox < W; gx += 2) {
      const x = Math.round(gx * step + ox);
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let gy = -2; gy * step + oy < H; gy += 2) {
      const y = Math.round(gy * step + oy);
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();
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
    const step = GRID_STEP;
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
