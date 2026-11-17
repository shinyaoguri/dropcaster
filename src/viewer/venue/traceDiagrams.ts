/**
 * 「なぞる」の案内に出す模式図 (#259)。今の手順で狙う角・辺を赤で強調し、確定済みの点を緑で示す。
 * 文章の案内と同じ内容なので、読み上げからは外す (aria-hidden)。
 */

type Point = readonly [number, number];
type Segment = readonly [Point, Point];
interface Step { target: Point; edge?: Segment }

const STROKE = '#8a8a8a', TARGET = '#ef4444', DONE = '#22c55e', OUTLINE = '#38bdf8';

const line = ([a, b]: Segment, color: string, width: number, dash = '') =>
  `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const dot = (p: Point, color: string, r = 4) => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${color}"/>`;
const ring = (p: Point) => `<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="none" stroke="${TARGET}" stroke-width="2.5"/>`;
const svg = (body: string) =>
  `<svg class="dc-venue-trace-diagram" viewBox="0 0 240 150" aria-hidden="true" focusable="false">${body}</svg>`;

/** 手順ごとの狙う所を、確定済みの点・強調する辺と合わせて描く。 */
function draw(frame: Segment[], steps: Step[], index: number): string {
  const current = steps[index];
  return svg([
    ...frame.map(s => line(s, STROKE, 1.5)),
    current.edge ? line(current.edge, TARGET, 4) : '',
    ...steps.slice(0, index).map(s => dot(s.target, DONE)),
    dot(current.target, TARGET, 4), ring(current.target),
  ].join(''));
}

// 部屋: 奥の壁 (正面の長方形)、左右の壁と床へ広がる辺。
const BL: Point = [70, 100], BR: Point = [170, 100], TL: Point = [70, 20], TR: Point = [170, 20];
const ROOM: Segment[] = [[TL, TR], [TL, BL], [TR, BR], [BL, BR], [TL, [10, 0]], [TR, [230, 0]], [BL, [10, 140]], [BR, [230, 140]]];
const ROOM_STEPS: Record<'first' | 'second', Step[]> = {
  first: [
    { target: BL },
    { target: [70, 55], edge: [TL, BL] },
    { target: [125, 100], edge: [BL, BR] },
    { target: [40, 120], edge: [BL, [10, 140]] },
  ],
  // 反対側の隅。奥の辺の点は 1 つ目の隅を指せば共有する。
  second: [
    { target: BR },
    { target: [170, 55], edge: [TR, BR] },
    { target: BL, edge: [BL, BR] },
    { target: [200, 120], edge: [BR, [230, 140]] },
  ],
};

// 箱: 手前右上の角から、縦の辺・上面の 2 辺。
const FL: Point = [90, 60], FR: Point = [150, 60], BKR: Point = [180, 38], BKL: Point = [120, 38];
const FLB: Point = [90, 125], FRB: Point = [150, 125], BKRB: Point = [180, 103];
const BOX: Segment[] = [[FL, FR], [FR, BKR], [BKR, BKL], [BKL, FL], [FL, FLB], [FR, FRB], [BKR, BKRB], [FLB, FRB], [FRB, BKRB], [[20, 140], [230, 140]]];
const BOX_STEPS: Step[] = [
  { target: FR },
  { target: FRB, edge: [FR, FRB] },
  { target: FL, edge: [FR, FL] },
  { target: BKR, edge: [FR, BKR] },
];

/** 合わせる: 壁に映った輪郭 (青の破線) の角を選び、実物 (灰) の同じ角へ運ぶ。 */
function anchor(index: number): string {
  const shift = (p: Point): Point => [p[0] + 14, p[1] - 10];
  const outline = ROOM.map(([a, b]) => line([shift(a), shift(b)], OUTLINE, 1.5, '5 4')).join('');
  const picked = shift(BL);
  return svg([
    ...ROOM.map(s => line(s, STROKE, 1.5)), outline,
    index === 0 ? dot(picked, TARGET) + ring(picked)
      : dot(picked, OUTLINE) + line([picked, BL], TARGET, 2.5, '4 3') + dot(BL, TARGET) + ring(BL),
  ].join(''));
}

export type DiagramTool = 'roomCorner' | 'boxCorner' | 'anchor';

/** 模式図の SVG。roomCorner の second は反対側の隅。図の無い手順は null。 */
export function traceDiagram(tool: DiagramTool, index: number, variant: 'first' | 'second' = 'first'): string | null {
  if (tool === 'anchor') return index === 0 || index === 1 ? anchor(index) : null;
  const steps = tool === 'roomCorner' ? ROOM_STEPS[variant] : BOX_STEPS;
  return index >= 0 && index < steps.length ? draw(tool === 'roomCorner' ? ROOM : BOX, steps, index) : null;
}
