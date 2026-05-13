/**
 * 無音オーディオを再生して、タブのバックグラウンド絞り込み（タイマー throttling、
 * Memory Saver による discard、5 分でのタブ freeze など）を抑止するための keepalive。
 *
 * 仕組み: WebAudio の OscillatorNode を gain=0 で destination に接続するだけ。
 * AudioContext が running になっている間、Chrome はそのタブを「オーディオ再生中」と
 * 見なすので discard/freeze の対象外になる（タイマー throttling も緩む）。
 *
 * 注意:
 *  - これでもメインウィンドウが完全に不可視（最小化等）になると requestAnimationFrame
 *    自体は止まる。rAF が止まる ＝ プロジェクションがフリーズする条件は残るので、
 *    可視性警告（B）と併用する想定。
 *  - AudioContext.resume() はユーザジェスチャ内で呼ぶ必要があるため、start() は
 *    クリック等のハンドラから呼び出すこと。
 */
export class SilentKeepAlive {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private started = false;

  /** 無音再生を開始する。ユーザジェスチャ内で呼ぶこと。冪等。失敗しても投げない。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0; // 完全無音
      this.osc = this.ctx.createOscillator();
      this.osc.frequency.value = 440;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
      // 自動再生ポリシーで suspended になっていれば起こす（ジェスチャ内なので通常通る）
      void this.ctx.resume().catch(() => { /* ignore */ });
    } catch {
      this.started = false;
      this.cleanup();
    }
  }

  /** 無音再生を止めてリソースを解放。冪等。 */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.cleanup();
  }

  private cleanup(): void {
    try { this.osc?.stop(); } catch { /* ignore: 未 start なら投げる */ }
    try { this.osc?.disconnect(); } catch { /* ignore */ }
    try { this.gain?.disconnect(); } catch { /* ignore */ }
    this.osc = null;
    this.gain = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => { /* ignore */ });
  }
}
