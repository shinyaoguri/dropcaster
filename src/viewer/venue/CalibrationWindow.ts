import { OutputWindow } from '../windows/output/OutputWindow';
import { defaultMappingsState } from '../utils/mappingTransform';
import type { CalibrationProjection } from './CalibrationProjection';
import { t } from '../i18n';

/** Reuse the existing fullscreen output UI, with an identity image and its own lifetime. */
export class CalibrationWindow {
  private output: OutputWindow | null = null;
  private monitor?: ReturnType<typeof setInterval>;
  private readonly id = `venue-calibration-${crypto.randomUUID()}`;
  private readonly projection: CalibrationProjection;
  private readonly changed: () => void;
  constructor(projection: CalibrationProjection, changed: () => void) {
    this.projection = projection; this.changed = changed;
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
    clearInterval(this.monitor); this.monitor = undefined;
    const output = this.output; this.output = null; output?.close(); this.projection.stopCapture(); this.changed();
  };
  dispose(): void { this.close(); window.removeEventListener('message', this.message); window.removeEventListener('pagehide', this.close); }
}
