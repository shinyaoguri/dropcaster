import type { PixelPoint } from './venueReconstruct.ts';
import { dropUnused, emptyTrace, movePoint, placePoint, removePoint, resizeTrace, TOOL_STEPS,
  type TraceDocument, type TraceShape, type TraceTool } from './traceModel.ts';

export type ConfirmResult = 'placed' | 'shape' | 'moved' | 'duplicate' | 'needLength' | 'idle';

/** 矢印キー 1 回で十字が動く量 (出力画素)。Shift で細かくする。 */
export const CROSSHAIR_STEP = { coarse: 10, fine: 1 } as const;

/**
 * なぞる操作の状態 (#246)。DOM に触れず、出力画素で十字・点・形を扱う。
 * 十字を動かし、確定すると、選んでいる道具の次の手順の点になる (既存の点の近くなら共有する)。
 * 「置き直す」を選んだ点は、次の確定でその位置へ動く。
 */
export class TraceController {
  doc: TraceDocument;
  tool: TraceTool | null = null;
  /** なぞりかけの形の点 (確定した順)。 */
  pending: string[] = [];
  crosshair: PixelPoint;
  /** 置き直し中の点と、元の位置。 */
  moving: { id: string; from: PixelPoint } | null = null;
  /** 変更のたびに増える。表示の描き直しの判定に使う。 */
  version = 0;
  private readonly changed: (documentChanged: boolean) => void;

  constructor(doc: TraceDocument | null, width: number, height: number, changed: (documentChanged: boolean) => void) {
    this.doc = doc ? resizeTrace(doc, width, height) : emptyTrace(width, height);
    this.crosshair = [width / 2, height / 2];
    this.changed = changed;
  }

  /** 選んでいる道具の、次に確定する手順 (0 始まり)。道具が無ければ -1。 */
  get step(): number { return this.tool ? this.pending.length : -1; }
  get stepKey(): string | null { return this.tool ? TOOL_STEPS[this.tool][this.pending.length] ?? null : null; }

  setTool(tool: TraceTool | null): void {
    this.abandon();
    this.tool = tool;
    this.notify(true);
  }

  setOutput(width: number, height: number): void {
    const { width: w, height: h } = this.doc.output;
    if (w === width && h === height) return;
    this.doc = resizeTrace(this.doc, width, height);
    this.crosshair = [this.crosshair[0] * width / w, this.crosshair[1] * height / h];
    if (this.moving) this.moving.from = [this.moving.from[0] * width / w, this.moving.from[1] * height / h];
    this.notify(true);
  }

  setLensInputs(throwRatio: number | null, lensShiftY: number | null): void {
    if (this.doc.throwRatio === throwRatio && this.doc.lensShiftY === lensShiftY) return;
    this.doc = { ...this.doc, throwRatio, lensShiftY };
    this.notify(true);
  }

  moveCrosshair(pixel: PixelPoint): void {
    const { width, height } = this.doc.output;
    const next: PixelPoint = [Math.min(Math.max(pixel[0], 0), width), Math.min(Math.max(pixel[1], 0), height)];
    if (next[0] === this.crosshair[0] && next[1] === this.crosshair[1]) return;
    this.crosshair = next;
    this.notify(false);
  }

  nudge(dx: number, dy: number): void { this.moveCrosshair([this.crosshair[0] + dx, this.crosshair[1] + dy]); }

  /**
   * 十字の位置で確定する。長さの道具は 2 点目の前に meters を確かめる (無ければ点を置かない)。
   * 同じ形の中で同じ点を 2 回使うことはできない。
   */
  confirm(meters: () => number | null): ConfirmResult {
    if (this.moving) {
      this.doc = movePoint(this.doc, this.moving.id, this.crosshair);
      this.moving = null;
      this.notify(true);
      return 'moved';
    }
    const tool = this.tool;
    if (!tool) return 'idle';
    const steps = TOOL_STEPS[tool].length;
    const length = tool === 'length' && this.pending.length === steps - 1 ? meters() : null;
    if (tool === 'length' && this.pending.length === steps - 1 && !(length !== null && length > 0)) return 'needLength';
    const placed = placePoint(this.doc, this.crosshair);
    if (this.pending.includes(placed.id)) return 'duplicate';
    this.doc = placed.doc;
    this.pending = [...this.pending, placed.id];
    if (this.pending.length < steps) { this.notify(true); return 'placed'; }
    const points = this.pending;
    this.pending = [];
    this.doc = { ...this.doc, shapes: [...this.doc.shapes,
      tool === 'length' ? { kind: 'length', points: [points[0], points[1]], meters: length as number }
        : { kind: tool, points: [points[0], points[1], points[2], points[3]] } as TraceShape] };
    this.notify(true);
    return 'shape';
  }

  /** 点を置き直す: 十字をその点へ運び、次の確定でその位置へ動かす。 */
  beginMove(id: string): void {
    const point = this.doc.points.find(p => p.id === id);
    if (!point) return;
    if (this.moving) this.cancelMove();
    this.moving = { id, from: [...point.pixel] };
    this.crosshair = [...point.pixel];
    this.notify(false);
  }

  /** Esc: 置き直しをやめて十字を点へ戻す。置き直していなければ、なぞりかけの形を捨てる。処理したら true。 */
  cancel(): boolean {
    if (this.moving) { this.cancelMove(); this.notify(false); return true; }
    if (this.pending.length > 0) { this.abandon(); this.notify(true); return true; }
    return false;
  }

  remove(id: string): void {
    if (this.moving?.id === id) this.moving = null;
    this.doc = removePoint(this.doc, id);
    this.pending = this.pending.filter(p => p !== id);
    this.notify(true);
  }

  clear(): void {
    this.doc = { ...emptyTrace(this.doc.output.width, this.doc.output.height), throwRatio: this.doc.throwRatio, lensShiftY: this.doc.lensShiftY };
    this.pending = []; this.moving = null;
    this.notify(true);
  }

  private cancelMove(): void {
    if (!this.moving) return;
    this.crosshair = [...this.moving.from];
    this.moving = null;
  }

  /** なぞりかけの形の点のうち、他の形が使っていないものを捨てる。 */
  private abandon(): void {
    if (this.pending.length > 0) this.doc = dropUnused(this.doc);
    this.pending = [];
    if (this.moving) this.cancelMove();
  }

  private notify(documentChanged: boolean): void {
    this.version++;
    this.changed(documentChanged);
  }
}
