import { requiredAnchors, type ShapeTool, type TraceDocument, type TraceMode, type TraceTool } from './traceModel.ts';

/**
 * 「なぞる」パネルの手順 (#259)。最初に作る / 合わせるを選び、あとは Step を一本道で進む。
 * 今いる Step は保存済みの点と形から導くので、保存形式 (dropcaster.venue.trace.v1) は変えない。DOM に触れない。
 */

export type TraceStep = 'entry' | 'prepare' | 'room1' | 'room2' | 'boxes' | 'scale' | 'anchors' | 'review';

/** 作る: 部屋の隅 2 つで会場ができる (隅 1 つでは投射比があっても縦のレンズシフトが決まらない、#259)。箱と実寸は任意。 */
export const BUILD_STEPS = ['prepare', 'room1', 'room2', 'boxes', 'scale', 'review'] as const satisfies readonly TraceStep[];
export const MATCH_STEPS = ['prepare', 'anchors', 'review'] as const satisfies readonly TraceStep[];
/** 次へ進む条件の無い (スキップできる) Step。 */
export const OPTIONAL_STEPS: readonly TraceStep[] = ['boxes', 'scale'];

export function stepsFor(mode: TraceMode): readonly TraceStep[] { return mode === 'match' ? MATCH_STEPS : BUILD_STEPS; }

/** Step で使う道具。最初のものを既定で選ぶ。 */
export function toolsFor(step: TraceStep): readonly TraceTool[] {
  switch (step) {
    case 'room1': case 'room2': return ['roomCorner'];
    case 'boxes': return ['boxCorner', 'rectangle'] satisfies ShapeTool[];
    case 'scale': return ['length'];
    case 'anchors': return ['anchor'];
    default: return [];
  }
}

export function roomCorners(doc: TraceDocument): number { return doc.shapes.filter(s => s.kind === 'roomCorner').length; }

/** 何もなぞっていなければ入口。そうでなければ、点と形から決まる Step から再開する (準備は済んでいるとみなす)。 */
export function initialStep(doc: TraceDocument): TraceStep {
  if (doc.shapes.length === 0 && doc.anchors.length === 0) return 'entry';
  if (doc.mode === 'match') return doc.anchors.length === 0 ? 'prepare' : limitStep(doc);
  return roomCorners(doc) === 0 ? 'prepare' : limitStep(doc);
}

/** 点と形で行ける最も先の Step。必須の Step (部屋の隅 2 つ・合わせる点) を満たすまでは、その Step で止まる。 */
export function limitStep(doc: TraceDocument): TraceStep {
  if (doc.mode === 'match') {
    const needed = requiredAnchors(doc.locked);
    return needed > 0 && doc.anchors.length >= needed ? 'review' : 'anchors';
  }
  const rooms = roomCorners(doc);
  return rooms >= 2 ? 'review' : rooms === 1 ? 'room2' : 'room1';
}

/** 画面の状態と推定の結果。 */
export interface StepContext {
  /** プロジェクタ本体の台形補正とデジタルズームを切ったと確かめた (画面からは見えないので、利用者のチェック)。 */
  keystoneOff: boolean;
  /** 出力窓が開いている (十字が壁に映る)。 */
  outputOpen: boolean;
  /** 投射比が分からないと明示した。 */
  throwRatioUnknown: boolean;
  /** 推定が成功している (作る: 会場ができた / 合わせる: プロジェクタが決まった)。 */
  estimated: boolean;
}

/** 今の Step から次へ進めるか。 */
export function canAdvance(step: TraceStep, doc: TraceDocument, context: StepContext): boolean {
  switch (step) {
    case 'prepare': return context.keystoneOff && context.outputOpen && (doc.mode === 'match' || doc.throwRatio !== null || context.throwRatioUnknown);
    case 'room1': return roomCorners(doc) >= 1;
    case 'room2': return roomCorners(doc) >= 2 && context.estimated;
    case 'anchors': return requiredAnchors(doc.locked) > 0 && doc.anchors.length >= requiredAnchors(doc.locked) && context.estimated;
    case 'boxes': case 'scale': return true;
    default: return false;
  }
}

export function nextStep(mode: TraceMode, step: TraceStep): TraceStep | null {
  const steps = stepsFor(mode), index = steps.indexOf(step as never);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

/** 点を消して必須の Step の条件を満たさなくなったら、行ける所まで戻す。 */
export function clampStep(doc: TraceDocument, step: TraceStep): TraceStep {
  if (step === 'entry') return step;
  const steps = stepsFor(doc.mode), limit = limitStep(doc), index = steps.indexOf(step as never);
  return index < 0 || index > steps.indexOf(limit as never) ? limit : step;
}

/** 手順の一覧から選べるか。着いたことのある Step までは戻れ、先へは飛べない。 */
export function canVisit(mode: TraceMode, reached: TraceStep, target: TraceStep): boolean {
  const steps = stepsFor(mode), index = steps.indexOf(target as never);
  return index >= 0 && index <= steps.indexOf(reached as never);
}
