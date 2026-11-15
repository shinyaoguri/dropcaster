import { randomId } from '../utils/randomId';
import { OutputWindow } from '../windows/output/OutputWindow';
import { defaultMappingsState } from '../utils/mappingTransform';
import type { CalibrationProjection } from './CalibrationProjection';
import { t } from '../i18n';

export interface CalibrationWindowHooks {
  /** 出力窓で押されたキー。プロジェクタ側の画面を見たまま微調整できるようにする。 */
  key?: (event: KeyboardEvent) => void;
  /** 出力窓が全画面のときの、その画面の実ピクセル数。 */
  screen?: (width: number, height: number) => void;
}

/** Reuse the existing fullscreen output UI, with an identity image and its own lifetime. */
export class CalibrationWindow {
  private output: OutputWindow | null = null;
  private monitor?: ReturnType<typeof setInterval>;
  private readonly id = `venue-calibration-${randomId()}`;
  private readonly projection: CalibrationProjection;
  private readonly changed: () => void;
  private readonly hooks: CalibrationWindowHooks;
  private detach: (() => void) | null = null;
  constructor(projection: CalibrationProjection, changed: () => void, hooks: CalibrationWindowHooks = {}) {
    this.projection = projection; this.changed = changed; this.hooks = hooks;
    window.addEventListener('message', this.message); window.addEventListener('pagehide', this.close);
  }
  get isOpen(): boolean { return !!this.output?.isOpen(); }
  open(): boolean {
    if (this.isOpen) { this.output!.focus(); return true; }
    const child = window.open('', this.id, 'popup,width=960,height=600,resizable=yes');
    if (!child) return false;
    try {
      child.document.title = t('calibration.outputTitle');
      this.output = new OutputWindow(this.id); this.output.setParentWindow(window); this.output.setWindow(child);
      child.addEventListener('beforeunload', () => {
        if (this.output?.getWindow() !== child) return;
        this.close();
      });
      this.watch(child);
      clearInterval(this.monitor);
      this.monitor = setInterval(() => { if (this.output && !this.output.isOpen()) this.close(); }, 500);
      this.update(); this.changed(); return true;
    } catch { this.close(); child.close(); return false; }
  }
  update(): void {
    if (!this.isOpen) return;
    const { width, height } = this.projection.canvas, state = defaultMappingsState();
    state.canvas = { width, height }; state.outputs[0].id = this.id;
    state.outputs[0].size = { width, height }; state.activeOutputId = this.id;
    state.mappings = [{ id: 'calibration-image', name: 'Calibration', source: { x: 0, y: 0, width: 100, height: 100 },
      quad: { topLeft: {x:0,y:0}, topRight:{x:width,y:0}, bottomLeft:{x:0,y:height}, bottomRight:{x:width,y:height} } }];
    state.activeId = state.mappings[0].id;
    this.output!.setMappings(state); this.bind();
  }
  /**
   * 全画面の出入りと大きさの変化を見て、全画面のときだけ画面の実ピクセル数を知らせる。
   * 窓のままの大きさは出力解像度に使わない (ADR 0002: 画質は canvas のバッキングストアで決める)。
   */
  private watch(child: Window): void {
    this.detach?.();
    const measure = (): void => {
      if (!child.document.fullscreenElement) return;
      const ratio = child.devicePixelRatio || 1;
      const width = Math.round(child.innerWidth * ratio), height = Math.round(child.innerHeight * ratio);
      if (width > 0 && height > 0) this.hooks.screen?.(width, height);
    };
    const key = (event: KeyboardEvent): void => this.hooks.key?.(event);
    child.addEventListener('resize', measure); child.document.addEventListener('fullscreenchange', measure);
    child.addEventListener('keydown', key);
    this.detach = () => {
      try {
        child.removeEventListener('resize', measure); child.document.removeEventListener('fullscreenchange', measure);
        child.removeEventListener('keydown', key);
      } catch { /* closed window */ }
      this.detach = null;
    };
  }
  private bind(): void {
    if (!this.isOpen) return;
    const stream = this.projection.capture();
    this.output!.getWindow()!.document.querySelectorAll('video').forEach(video => {
      if (video.srcObject !== stream) { video.srcObject = stream; video.muted = true; void video.play().catch(() => {}); }
    });
  }
  private message = (event: MessageEvent): void => {
    if (event.source === this.output?.getWindow() && event.data?.type === 'output-needs-stream' && event.data.outputId === this.id) this.bind();
  };
  close = (): void => {
    clearInterval(this.monitor); this.monitor = undefined; this.detach?.();
    const output = this.output; this.output = null; output?.close(); this.projection.stopCapture(); this.changed();
  };
  dispose(): void { this.close(); window.removeEventListener('message', this.message); window.removeEventListener('pagehide', this.close); }
}
