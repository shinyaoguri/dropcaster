import type { Projector } from '../practice/project';
import { dragRoll, dragRotate, dragTranslate, nudge, NUDGE_STEPS, type NudgeAction, type NudgeStep } from './ProjectorNudge';

export interface ProjectorAdjusterOptions {
  /** 確定済みのプロジェクタ (操作の起点)。 */
  current: () => Projector | null;
  /** 操作中の表示だけを更新する。保存はしない。 */
  preview: (projector: Projector) => void;
  /** 1 操作の結果を 1 回だけ確定する。 */
  commit: (projector: Projector) => void;
  /** 平行移動ドラッグの基準面までの、光軸方向の深さ (m)。 */
  depth: (projector: Projector) => number;
  /** 刻みが変わったとき。 */
  stepChanged: (step: NudgeStep) => void;
}

/** キーやホイールが止まってから確定するまでの時間。 */
export const SETTLE_MS = 500;

const KEYS: Record<string, [NudgeAction, number, NudgeAction?]> = {
  // [修飾なし, 符号, Shift 時]
  ArrowLeft: ['pan', -1, 'right'], ArrowRight: ['pan', 1, 'right'],
  ArrowUp: ['tilt', 1, 'up'], ArrowDown: ['tilt', -1, 'up'],
};

export function editable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * 壁を見ながらの微調整。キー・ドラッグ・ホイールを、ADR 0014 と同じく「1 操作 = 1 確定」にまとめる。
 * 操作中は表示だけを動かし、pointerup またはキー・ホイールが SETTLE_MS 止まったときに 1 回だけ確定する。
 */
export class ProjectorAdjuster {
  private readonly options: ProjectorAdjusterOptions;
  private start: Projector | null = null;
  private value: Projector | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drag: { id: number; origin: Projector; from: [number, number]; mode: 'rotate' | 'translate' | 'roll'; element: HTMLElement } | null = null;
  private element: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  step: NudgeStep = 'coarse';
  /** なぞる間 (#246) は像のポインタ・ホイール・キーを取らない。 */
  suspended = false;

  constructor(options: ProjectorAdjusterOptions) { this.options = options; }

  /** 操作中の (未確定の) プロジェクタ。操作していなければ null。 */
  get pending(): Projector | null { return this.value; }

  setStep(step: NudgeStep): void { this.step = step; this.options.stepChanged(step); }

  /** element 上の canvas (object-fit: contain で表示した出力画像) を直接ドラッグできるようにする。 */
  attach(element: HTMLElement, canvas: HTMLCanvasElement): void {
    this.element = element; this.canvas = canvas;
    element.addEventListener('pointerdown', this.pointerDown);
    element.addEventListener('pointermove', this.pointerMove);
    element.addEventListener('pointerup', this.pointerUp);
    element.addEventListener('pointercancel', this.pointerCancel);
    element.addEventListener('lostpointercapture', this.pointerCancel);
    element.addEventListener('wheel', this.wheel, { passive: false });
  }

  /** 処理したキーなら true。呼び出し側で preventDefault する。 */
  handleKey(event: KeyboardEvent): boolean {
    if (this.suspended || event.defaultPrevented || event.metaKey || event.ctrlKey || editable(event.target)) return false;
    if (event.key === 'Escape') { if (!this.start) return false; this.cancel(); return true; }
    if (event.key === 'g' || event.key === 'G') { this.setStep(this.step === 'coarse' ? 'fine' : 'coarse'); return true; }
    const { degrees, meters } = NUDGE_STEPS[this.step];
    const arrow = KEYS[event.key];
    let action: NudgeAction | undefined, amount = 0;
    if (arrow && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { action = 'forward'; amount = arrow[1] * meters; }
    else if (arrow && event.shiftKey) { action = arrow[2]; amount = arrow[1] * meters; }
    else if (arrow && !event.altKey) { action = arrow[0]; amount = arrow[1] * degrees; }
    else if (event.key === '[' || event.key === ']') { action = 'roll'; amount = (event.key === '[' ? 1 : -1) * degrees; }
    else if (event.key === '-' || event.key === '_') { action = 'zoom'; amount = -degrees; }
    else if (event.key === '=' || event.key === '+') { action = 'zoom'; amount = degrees; }
    if (!action) return false;
    this.change(projector => nudge(projector, action, amount));
    this.settle();
    return true;
  }

  /** 未確定の操作を確定する。他の変更を確定する前に必ず呼ぶ。 */
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    const start = this.start, value = this.value;
    this.start = this.value = null;
    if (this.drag) { try { this.drag.element.releasePointerCapture(this.drag.id); } catch { /* already released */ } this.drag = null; }
    if (start && value && JSON.stringify(start) !== JSON.stringify(value)) this.options.commit(value);
  }

  /** 未確定の操作を捨て、表示を起点へ戻す。 */
  cancel(): void {
    clearTimeout(this.timer); this.timer = undefined;
    const start = this.start;
    this.start = this.value = null;
    if (this.drag) { const drag = this.drag; this.drag = null; try { drag.element.releasePointerCapture(drag.id); } catch { /* already released */ } }
    if (start) this.options.preview(start);
  }

  dispose(): void {
    this.cancel();
    const element = this.element; if (!element) return;
    element.removeEventListener('pointerdown', this.pointerDown);
    element.removeEventListener('pointermove', this.pointerMove);
    element.removeEventListener('pointerup', this.pointerUp);
    element.removeEventListener('pointercancel', this.pointerCancel);
    element.removeEventListener('lostpointercapture', this.pointerCancel);
    element.removeEventListener('wheel', this.wheel);
  }

  private change(update: (projector: Projector) => Projector): void {
    if (!this.start) { this.start = this.options.current(); this.value = this.start; }
    if (!this.value) return;
    this.value = update(this.value);
    this.options.preview(this.value);
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SETTLE_MS);
  }

  /** 表示中の出力画像の上での位置を NDC (上が +y) にする。canvas は object-fit: contain。 */
  private ndc(event: { clientX: number; clientY: number }): [number, number] | null {
    const canvas = this.canvas; if (!canvas || !canvas.width || !canvas.height) return null;
    const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    if (!scale) return null;
    const width = canvas.width * scale, height = canvas.height * scale;
    const left = rect.left + (rect.width - width) / 2, top = rect.top + (rect.height - height) / 2;
    return [(event.clientX - left) / width * 2 - 1, 1 - (event.clientY - top) / height * 2];
  }

  private pointerDown = (event: PointerEvent): void => {
    if (this.suspended || event.button !== 0 || this.drag) return;
    const from = this.ndc(event); if (!from) return;
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.start) { this.start = this.options.current(); this.value = this.start; }
    if (!this.value) return;
    const element = event.currentTarget as HTMLElement;
    this.drag = { id: event.pointerId, origin: this.value, from, element,
      mode: event.shiftKey ? 'translate' : event.altKey ? 'roll' : 'rotate' };
    element.setPointerCapture(event.pointerId);
    element.focus({ preventScroll: true });
    event.preventDefault();
  };

  private pointerMove = (event: PointerEvent): void => {
    const drag = this.drag; if (!drag || event.pointerId !== drag.id) return;
    const to = this.ndc(event); if (!to) return;
    const { origin, from, mode } = drag;
    this.value = mode === 'translate' ? dragTranslate(origin, from, to, this.options.depth(origin))
      : mode === 'roll' ? dragRoll(origin, from, to) : dragRotate(origin, from, to);
    this.options.preview(this.value);
  };

  private pointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.flush();
  };

  /**
   * 押したままキャプチャを失ったら、そのドラッグの分だけを取り消す (VenueEditor と同じ)。
   * 直前までのキー操作は残し、通常どおり確定する。
   */
  private pointerCancel = (event: PointerEvent): void => {
    const drag = this.drag; if (!drag || event.pointerId !== drag.id) return;
    this.drag = null; this.value = drag.origin; this.options.preview(drag.origin);
    this.settle();
  };

  private wheel = (event: WheelEvent): void => {
    if (this.suspended || this.drag || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY, fine = this.step === 'fine' ? .1 : 1;
    if (event.altKey) {
      this.change(projector => nudge(projector, 'forward', -delta * .001 * fine * Math.max(1, this.options.depth(projector))));
    } else {
      this.change(projector => nudge(projector, 'zoom', -delta * .02 * fine));
    }
    this.settle();
  };
}
