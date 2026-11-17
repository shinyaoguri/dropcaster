import type { Projector, Vec3, VenueObject } from '../practice/project';
import { button, label } from '../practice/controls';
import { t, type MessageKey } from '../i18n';
import { editable } from './ProjectorAdjuster';
import type { CalibrationPattern } from './CalibrationProjection';
import { TraceController, CROSSHAIR_STEP, type ConfirmResult } from './TraceController';
import { MAX_THROW_RATIO, MIN_THROW_RATIO, PROJECTOR_PARAMETERS, TOOL_STEPS, parseTraceDocument, pointLabel, requiredAnchors, toMatchInput, toReconstructInput,
  type TraceMode, type TraceTool } from './traceModel';
import { canAdvance, canVisit, clampStep, initialStep, nextStep, OPTIONAL_STEPS, roomCorners, stepsFor, toolsFor, type StepContext, type TraceStep } from './traceSteps';
import { traceDiagram } from './traceDiagrams';
import { reconstructVenue, type PixelPoint, type ProjectorParameter, type ReconstructResult } from './venueReconstruct';
import { nearestProjectedVertex, projectToPixel } from './venueVertices';
import { reconstructionToVenue, type ReconstructionToVenueResult, type VenuePartRole } from './reconstructionToVenue';

/** なぞった点と形の保存先。会場の下書き (IndexedDB の venue-draft) とは別で、書き出す会場ファイルには含めない (ADR 0023)。 */
export const TRACE_STORAGE_KEY = 'dropcaster.venue.trace.v1';

export interface TraceEstimate { objects: VenueObject[]; projector: Projector }
/** 一時表示する推定。objects が null なら会場は確定済みのまま、プロジェクタだけを差し替える (測った会場に合わせる)。 */
export interface TracePreview { objects: VenueObject[] | null; projector: Projector }

export interface TracePanelHooks {
  /** 確定済みのプロジェクタ (id・outputId・near・far を引き継ぐ)。 */
  projector: () => Projector | null;
  /** 推定した会場とプロジェクタを一時表示する (保存しない)。null で確定済みの表示に戻す。 */
  showEstimate: (estimate: TracePreview | null) => void;
  /** 推定した会場とプロジェクタを 1 回の変更として書き込む。 */
  apply: (estimate: TraceEstimate) => void;
  /** 推定したプロジェクタだけを 1 回の変更として書き込む (測った会場に合わせる)。 */
  applyProjector: (projector: Projector) => void;
  /** 確定済みの会場の、壁に輪郭として映る頂点 (世界座標)。 */
  vertices: () => Vec3[];
  /** 頂点がプロジェクタから見えるか (会場の面に隠れていないか)。 */
  vertexVisible: (world: Vec3, projector: Projector) => boolean;
  /** いま壁に輪郭を映しているプロジェクタ (推定の一時表示中ならそれ)。 */
  displayedProjector: () => Projector | null;
  undo: () => void;
  /** 実出力の十字。null で消す。 */
  crosshair: (pixel: PixelPoint | null) => void;
  /** 像に重ねる印が変わったとき。 */
  redraw: () => void;
  /** プロジェクタ出力 (出力窓) が開いているか。 */
  outputOpen: () => boolean;
  openOutput: () => void;
  /** 実出力の調整用の像。 */
  pattern: () => CalibrationPattern;
  setPattern: (pattern: CalibrationPattern) => void;
}

type Where = 'projector' | 'wall' | 'screen';

const STEP_NAMES: Record<TraceStep, MessageKey> = {
  entry: 'calibration.trace', prepare: 'calibration.traceStepPrepare', room1: 'calibration.traceStepRoom1', room2: 'calibration.traceStepRoom2',
  boxes: 'calibration.traceStepBoxes', scale: 'calibration.traceStepScale', anchors: 'calibration.traceStepAnchors', review: 'calibration.traceStepReview',
};
/** その Step で利用者が操作・確認する場所。 */
const STEP_WHERE: Record<TraceStep, Where[]> = {
  entry: ['screen'], prepare: ['projector', 'screen'], room1: ['wall'], room2: ['wall'], boxes: ['wall'], scale: ['wall'], anchors: ['wall'], review: ['wall', 'screen'],
};
const WHERE_NAMES: Record<Where, MessageKey> = { projector: 'calibration.traceWhereProjector', wall: 'calibration.traceWhereWall', screen: 'calibration.traceWhereScreen' };
/** その Step の操作で何が決まるか。 */
const STEP_DECIDES: Partial<Record<TraceStep, MessageKey>> = {
  room1: 'calibration.traceDecidesRoom1', room2: 'calibration.traceDecidesRoom2', boxes: 'calibration.traceDecidesBoxes', scale: 'calibration.traceDecidesScale',
  anchors: 'calibration.traceDecidesAnchors', review: 'calibration.traceDecidesReview',
};
/** 道具の手順ごとの、狙い方のコツ。 */
const TIPS: Record<TraceTool, MessageKey[]> = {
  roomCorner: ['calibration.traceTipRoomCorner1', 'calibration.traceTipRoomCorner2', 'calibration.traceTipRoomCorner3', 'calibration.traceTipRoomCorner4'],
  boxCorner: ['calibration.traceTipBoxCorner1', 'calibration.traceTipBoxCorner2', 'calibration.traceTipBoxCorner3', 'calibration.traceTipBoxCorner4'],
  rectangle: ['calibration.traceTipRectangle'], length: ['calibration.traceTipLength'],
  anchor: ['calibration.traceTipAnchor1', 'calibration.traceTipAnchor2'],
};
const BOX_TOOLS: [TraceTool, MessageKey][] = [['boxCorner', 'calibration.traceBoxCorner'], ['rectangle', 'calibration.traceRectangle']];
const PATTERNS: CalibrationPattern[] = ['outline', 'grid', 'white', 'black'];
const ROLE_NAMES: Record<VenuePartRole, MessageKey> = { floor: 'practice.floor', back: 'practice.backWall', left: 'practice.leftWall', right: 'practice.rightWall', box: 'practice.box', panel: 'calibration.tracePanel' };
const CONFIRM_MESSAGES: Partial<Record<ConfirmResult, MessageKey>> = { duplicate: 'calibration.traceDuplicate', needLength: 'calibration.traceNeedLength', noVertex: 'calibration.traceNoVertex' };
const PARAMETER_NAMES: Record<ProjectorParameter, MessageKey> = {
  position: 'calibration.traceLockPosition', rotation: 'calibration.traceLockRotation', fov: 'calibration.traceLockFov',
  lensShiftY: 'calibration.traceLockShiftY', lensShiftX: 'calibration.traceLockShiftX',
};

function readStored(): unknown {
  try { const raw = localStorage.getItem(TRACE_STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/**
 * 会場画面の「なぞる」パネル (#246、手順は #259)。最初に作る / 合わせるを選び、Step を一本道で進む。
 * 左のツール列 (element) には手順の一覧と今の Step の入力を、投影される像の上 (guide) には今やることと模式図を置く。
 * 十字は実出力 (壁) に、点の印・形の線は像の上 (観察専用) にだけ描き、番号・誤差は確認の Step でだけ重ねる。
 */
export class TracePanel {
  readonly element = document.createElement('div');
  /** 投影される像の上に置く、今やることの案内。 */
  readonly guide = document.createElement('div');
  readonly controller: TraceController;
  private readonly hooks: TracePanelHooks;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private result: ReconstructResult | null = null;
  private venue: ReconstructionToVenueResult | null = null;
  private elapsed = 0;
  private message: MessageKey | null = null;
  private drag: { id: number; element: HTMLElement } | null = null;
  private stage: HTMLElement | null = null;
  private image: HTMLCanvasElement | null = null;
  private stepValue: TraceStep;
  /** 一度着いた最も先の Step。手順の一覧からここまでは戻って、また進める。 */
  private reached: TraceStep;
  /** 準備のチェック。画面からは確かめられないので保存せず、開き直したら付け直す。 */
  private keystoneOff = false;
  private throwRatioUnknown = false;

  constructor(width: number, height: number, hooks: TracePanelHooks) {
    this.hooks = hooks;
    this.controller = new TraceController(parseTraceDocument(readStored()), width, height, changed => this.changed(changed));
    this.stepValue = this.reached = initialStep(this.controller.doc);
    this.element.className = 'dc-venue-trace';
    this.element.innerHTML = `
      <section class="tool-section" id="venue-trace-steps-section"><h3 id="venue-trace-steps-title">${label('calibration.traceSteps')}</h3>
        <ol id="venue-trace-steps" class="dc-venue-trace-steps" aria-labelledby="venue-trace-steps-title"></ol>
        ${button('venue-trace-change-mode', 'calibration.traceChangeMode')}</section>
      <section id="venue-trace-entry" class="dc-venue-trace-entry">
        <p class="dc-venue-trace-question">${label('calibration.traceEntry')}</p>
        <button type="button" id="venue-trace-mode-build" class="tool-button dc-venue-trace-choice">${label('calibration.traceEntryBuild')}<small>${label('calibration.traceEntryBuildHint')}</small></button>
        <button type="button" id="venue-trace-mode-match" class="tool-button dc-venue-trace-choice">${label('calibration.traceEntryMatch')}<small>${label('calibration.traceEntryMatchHint')}</small></button>
      </section>
      <section id="venue-trace-prepare">
        <ol class="dc-venue-trace-checklist">
          <li><label class="dc-venue-trace-check"><input type="checkbox" id="venue-trace-keystone">${label('calibration.traceCheckKeystone')}</label>
            <span class="dc-venue-trace-where is-projector">${label('calibration.traceWhereProjector')}</span>
            <p class="dc-practice-hint">${label('calibration.traceCheckKeystoneWhy')}</p></li>
          <li><div class="dc-venue-trace-check"><span id="venue-trace-output-state" class="dc-venue-trace-state"></span>${label('calibration.traceCheckOutput')}</div>
            <span class="dc-venue-trace-where is-screen">${label('calibration.traceWhereScreen')}</span>
            ${button('venue-trace-open-output', 'calibration.openOutput')}
            <p class="dc-practice-hint">${label('calibration.traceCheckOutputWhy')}</p></li>
          <li><label class="dc-practice-field">${label('calibration.traceThrowRatio')}<input id="venue-trace-throw" type="number" min="${MIN_THROW_RATIO}" max="${MAX_THROW_RATIO}" step="0.01"></label>
            <p class="dc-practice-hint">${label('calibration.traceThrowHint')}</p>
            <label class="dc-venue-trace-check" id="venue-trace-throw-unknown-field"><input type="checkbox" id="venue-trace-throw-unknown">${label('calibration.traceThrowUnknown')}</label></li>
          <li><label class="dc-practice-field">${label('calibration.pattern')}<select id="venue-trace-pattern">${PATTERNS.map(kind => `<option value="${kind}" data-i18n="calibration.${kind}">${t(`calibration.${kind}` as MessageKey)}</option>`).join('')}</select></label>
            <p class="dc-practice-hint">${label('calibration.tracePatternHint')}</p></li>
        </ol>
        <details class="dc-venue-trace-details" id="venue-trace-shift-details"><summary>${label('calibration.traceDetails')}</summary>
          <label class="dc-practice-field">${label('calibration.traceShift')}<input id="venue-trace-shift" type="number" min="-200" max="200" step="0.1"></label>
          <p class="dc-practice-hint">${label('calibration.traceShiftHint')}</p></details>
      </section>
      <section id="venue-trace-boxes">
        <div class="dc-venue-trace-tools" role="group" aria-labelledby="venue-trace-tools-label"><span id="venue-trace-tools-label">${label('calibration.traceTools')}</span>
          ${BOX_TOOLS.map(([tool, key]) => `<button type="button" id="venue-trace-tool-${tool}" class="tool-button" aria-pressed="false">${label(key)}</button>`).join('')}</div>
      </section>
      <section id="venue-trace-scale">
        <label class="dc-practice-field" id="venue-trace-meters-field">${label('calibration.traceMeters')}<input id="venue-trace-meters" type="number" min="0.001" max="1000" step="0.001"></label>
      </section>
      <details id="venue-trace-match" class="dc-venue-trace-locks dc-venue-trace-details"><summary>${label('calibration.traceLocks')}</summary>
        ${PROJECTOR_PARAMETERS.map(parameter => `<label><input type="checkbox" id="venue-trace-lock-${parameter}" data-trace-lock="${parameter}">${label(PARAMETER_NAMES[parameter])}</label>`).join('')}
        <p class="dc-practice-hint">${label('calibration.traceLocksHint')}</p>
      </details>
      <section id="venue-trace-review">
        <h3 id="venue-trace-points-title">${label('calibration.tracePoints')}</h3><ol id="venue-trace-points" class="dc-venue-trace-points"></ol>
        <div id="venue-trace-status" class="dc-venue-trace-status" role="status" aria-live="polite"></div>
        ${button('venue-trace-apply', 'calibration.traceApply')}${button('venue-trace-undo', 'calibration.undoProjector')}${button('venue-trace-more', 'calibration.traceMore')}
      </section>
      <div class="dc-venue-trace-nav" id="venue-trace-nav"><p id="venue-trace-blocked" class="dc-practice-hint"></p>${button('venue-trace-next', 'calibration.traceNext')}</div>
      ${button('venue-trace-clear', 'calibration.traceRestart')}`;
    this.guide.className = 'dc-venue-trace-guide';
    this.guide.id = 'venue-trace-guide'; this.guide.hidden = true;
    this.guide.innerHTML = `
      <div class="dc-venue-trace-guide-text">
        <p class="dc-venue-trace-meta"><span id="venue-trace-count"></span><span id="venue-trace-where"></span></p>
        <p id="venue-trace-step" class="dc-venue-trace-step" role="status" aria-live="polite"></p>
        <p id="venue-trace-tip" class="dc-venue-trace-tip"></p>
        <p id="venue-trace-decides" class="dc-venue-trace-decides"></p>
        <div id="venue-trace-guide-status" class="dc-venue-trace-status"></div>
        <div class="dc-venue-trace-confirm" id="venue-trace-confirm-row"><span id="venue-trace-crosshair"></span><span id="venue-trace-progress"></span>${button('venue-trace-confirm', 'calibration.traceConfirm')}</div>
        <p id="venue-trace-message" class="dc-practice-hint is-error" role="alert"></p>
        <p class="dc-practice-hint" id="venue-trace-keys">${label('calibration.traceKeys')} ${label('calibration.traceCrosshairTip')}</p>
      </div>
      <div id="venue-trace-diagram" class="dc-venue-trace-figure"></div>`;
    this.wire();
    const { throwRatio, lensShiftY } = this.controller.doc;
    this.input('venue-trace-throw').value = throwRatio === null ? '' : String(throwRatio);
    this.input('venue-trace-shift').value = lensShiftY === null ? '' : String(Number((lensShiftY * 100).toFixed(4)));
    // 今の Step の道具を選び、保存してあった点から開いたときの推定を出しておく。
    this.selectTool(this.stepValue);
    const { shapes, anchors } = this.controller.doc;
    if (!this.timer && (shapes.length > 0 || anchors.length > 0)) this.timer = setTimeout(() => this.estimate(), 0);
    this.render();
  }

  private get<T extends HTMLElement = HTMLElement>(id: string): T { return (this.element.querySelector(`#${id}`) ?? this.guide.querySelector(`#${id}`))!; }
  private input(id: string): HTMLInputElement { return this.get(id); }

  /** 今の Step (ブラウザテストで確かめる)。 */
  get step(): TraceStep { return this.stepValue; }

  private wire(): void {
    this.get('venue-trace-mode-build').addEventListener('click', () => this.choose('build'));
    this.get('venue-trace-mode-match').addEventListener('click', () => this.choose('match'));
    // 始め方を選び直す: 点は消さずに入口へ戻る (選んだモードの点から再開する)。
    this.get('venue-trace-change-mode').addEventListener('click', () => this.go('entry'));
    for (const [tool] of BOX_TOOLS) this.get(`venue-trace-tool-${tool}`).addEventListener('click', () => this.controller.setTool(tool));
    this.get('venue-trace-steps').addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLButtonElement>('[data-trace-step]');
      if (target && !target.disabled) this.go(target.dataset.traceStep as TraceStep);
    });
    this.get('venue-trace-match').addEventListener('change', event => {
      const input = event.target as HTMLInputElement, parameter = input.dataset.traceLock as ProjectorParameter | undefined;
      if (parameter) this.controller.setLocked(parameter, input.checked);
    });
    this.input('venue-trace-keystone').addEventListener('change', () => { this.keystoneOff = this.input('venue-trace-keystone').checked; this.render(); });
    this.input('venue-trace-throw-unknown').addEventListener('change', () => { this.throwRatioUnknown = this.input('venue-trace-throw-unknown').checked; this.render(); });
    this.get('venue-trace-open-output').addEventListener('click', () => this.hooks.openOutput());
    this.get<HTMLSelectElement>('venue-trace-pattern').addEventListener('change', () => this.hooks.setPattern(this.get<HTMLSelectElement>('venue-trace-pattern').value as CalibrationPattern));
    const lens = () => {
      const throwRatio = this.input('venue-trace-throw').valueAsNumber, shift = this.input('venue-trace-shift').valueAsNumber;
      this.controller.setLensInputs(
        throwRatio >= MIN_THROW_RATIO && throwRatio <= MAX_THROW_RATIO ? throwRatio : null,
        Number.isFinite(shift) && Math.abs(shift) <= 200 ? shift / 100 : null);
    };
    this.input('venue-trace-throw').addEventListener('change', lens); this.input('venue-trace-shift').addEventListener('change', lens);
    this.get('venue-trace-confirm').addEventListener('click', () => this.confirm());
    this.get('venue-trace-next').addEventListener('click', () => this.next());
    this.get('venue-trace-apply').addEventListener('click', () => this.apply());
    this.get('venue-trace-undo').addEventListener('click', () => this.hooks.undo());
    this.get('venue-trace-more').addEventListener('click', () => this.go(this.controller.mode === 'match' ? 'anchors' : 'boxes'));
    this.get('venue-trace-clear').addEventListener('click', () => { if (window.confirm(t('calibration.traceRestartConfirm'))) this.restart(); });
    this.get('venue-trace-points').addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-trace-action]');
      if (!target) return;
      const id = target.dataset.point!;
      if (target.dataset.traceAction === 'move') this.controller.beginMove(id); else this.controller.remove(id);
    });
  }

  /** 入口で作る / 合わせるを選ぶ。そのモードの点が残っていれば、そこから再開する。 */
  private choose(mode: TraceMode): void {
    this.controller.setMode(mode);
    const start = initialStep(this.controller.doc);
    this.reached = 'entry';
    this.go(start === 'entry' ? 'prepare' : start);
  }

  /** 最初からやり直す: 今のモードの点だけを消して入口へ戻る。 */
  private restart(): void {
    this.controller.clear();
    this.reached = 'entry';
    this.go('entry');
  }

  private context(): StepContext {
    return { keystoneOff: this.keystoneOff, outputOpen: this.hooks.outputOpen(), throwRatioUnknown: this.throwRatioUnknown, estimated: this.estimated() };
  }

  private estimated(): boolean { return this.controller.mode === 'match' ? !!this.matchedProjector() : this.venue?.status === 'ok'; }

  /** 次へ進めるか。推定の成否で決まる Step は、再推定を待つ間は進めない。 */
  private advanceable(): boolean {
    const step = this.stepValue;
    return canAdvance(step, this.controller.doc, this.context()) && !(this.timer && (step === 'room2' || step === 'anchors'));
  }

  private next(): void {
    if (!this.advanceable()) return;
    const next = nextStep(this.controller.mode, this.stepValue);
    if (next) this.go(next);
  }

  /** Step を移る。手順の一覧からは、着いたことのある Step にだけ移れる。 */
  private go(step: TraceStep): void {
    const mode = this.controller.mode, steps = stepsFor(mode);
    if (step !== 'entry' && this.reached !== 'entry' && !canVisit(mode, this.reached, step) && steps.indexOf(step as never) !== steps.indexOf(this.reached as never) + 1) return;
    this.stepValue = step;
    if (step === 'entry') this.reached = 'entry';
    else if (this.reached === 'entry' || steps.indexOf(step as never) > steps.indexOf(this.reached as never)) this.reached = step;
    this.message = null;
    this.selectTool(step);
    this.render(); this.hooks.redraw();
  }

  /** Step の既定の道具を選ぶ。箱の Step では、選んでいる道具がその Step のものなら保つ。 */
  private selectTool(step: TraceStep): void {
    const tools = toolsFor(step), tool = this.controller.tool;
    if (tool === null ? tools.length === 0 && this.controller.pending.length === 0 : tools.includes(tool)) return;
    this.controller.setTool(tools[0] ?? null);
  }

  /** 投影される像 (object-fit: contain で表示した出力の写し) の上で十字を動かす。 */
  attach(stage: HTMLElement, image: HTMLCanvasElement): void {
    this.stage = stage; this.image = image;
    stage.addEventListener('pointerdown', this.pointerDown); stage.addEventListener('pointermove', this.pointerMove);
    stage.addEventListener('pointerup', this.pointerUp); stage.addEventListener('pointercancel', this.pointerUp);
    stage.addEventListener('dblclick', this.doubleClick);
  }

  get isActive(): boolean { return this.active; }

  /** パネルを開いている間だけ十字を映し、推定を一時表示する。 */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.guide.hidden = !active;
    if (!active) { this.controller.cancel(); this.hooks.crosshair(null); this.hooks.showEstimate(null); }
    else { this.hooks.crosshair(this.controller.crosshair); this.showEstimate(); this.render(); }
    this.hooks.redraw();
  }

  setOutput(width: number, height: number): void { this.controller.setOutput(width, height); }

  /** 出力窓の上のマウス。動かすと十字が付いてきて、クリックで確定する。 */
  outputPointer(pixel: PixelPoint, kind: 'move' | 'click'): void {
    if (!this.active) return;
    this.controller.moveCrosshair(pixel);
    if (kind === 'click') this.confirm();
  }

  /** 処理したキーなら true。入力欄では横取りしない。 */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.active || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return false;
    const step = event.shiftKey ? CROSSHAIR_STEP.fine : CROSSHAIR_STEP.coarse;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[event.key]) { this.controller.nudge(...arrows[event.key]); return true; }
    if (event.key === 'Enter') { this.confirm(); return true; }
    if (event.key === 'Escape') return this.controller.cancel();
    return false;
  }

  private confirm(): void {
    const result = this.controller.confirm({
      meters: () => { const meters = this.input('venue-trace-meters').valueAsNumber; return meters > 0 ? meters : null; },
      pickVertex: pixel => {
        const projector = this.shownProjector();
        return projector ? nearestProjectedVertex(this.hooks.vertices(), projector, this.controller.doc.output, pixel,
          { visible: world => this.hooks.vertexVisible(world, projector) }) : null;
      },
    });
    // 1 つ目の隅をなぞり終えたら、そのまま反対側の隅へ進む。
    if (result === 'shape' && this.stepValue === 'room1') this.go('room2');
    this.message = CONFIRM_MESSAGES[result] ?? null;
    this.renderMessage();
  }

  private apply(): void {
    if (this.timer) return;
    if (this.controller.mode === 'match') {
      const projector = this.matchedProjector();
      if (projector) this.hooks.applyProjector(projector);
    } else {
      if (this.venue?.status !== 'ok') return;
      this.hooks.apply({ objects: this.venue.objects, projector: this.venue.projector });
    }
    this.render();
  }

  /** 測った会場に合わせた結果のプロジェクタ (id・outputId・near・far は確定済みから引き継ぐ)。決まっていなければ null。 */
  private matchedProjector(): Projector | null {
    const committed = this.hooks.projector(), result = this.result;
    if (!committed || this.controller.mode !== 'match' || result?.status !== 'ok') return null;
    return { ...committed, ...result.projector, aspect: committed.aspect };
  }

  /** 壁に映っている輪郭のプロジェクタ。頂点を選ぶ・残差の線を描くのに使う。 */
  private shownProjector(): Projector | null { return this.hooks.displayedProjector(); }

  /** 像の上の位置を出力画素へ。像は出力と同じ縦横比で、stage の中央に置かれる。 */
  private pixel(event: { clientX: number; clientY: number }): PixelPoint | null {
    const image = this.image; if (!image) return null;
    const rect = image.getBoundingClientRect(), { width, height } = this.controller.doc.output;
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return [(event.clientX - rect.left) / rect.width * width, (event.clientY - rect.top) / rect.height * height];
  }

  private pointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) return;
    const pixel = this.pixel(event); if (!pixel) return;
    const element = event.currentTarget as HTMLElement;
    this.drag = { id: event.pointerId, element };
    element.setPointerCapture(event.pointerId); element.focus({ preventScroll: true });
    this.controller.moveCrosshair(pixel);
    event.preventDefault();
  };
  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const pixel = this.pixel(event); if (pixel) this.controller.moveCrosshair(pixel);
  };
  private pointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    try { this.drag.element.releasePointerCapture(this.drag.id); } catch { /* already released */ }
    this.drag = null;
  };
  private doubleClick = (event: MouseEvent): void => {
    if (!this.active) return;
    const pixel = this.pixel(event); if (!pixel) return;
    this.controller.moveCrosshair(pixel); this.confirm();
  };

  private changed(documentChanged: boolean): void {
    if (this.active) this.hooks.crosshair(this.controller.crosshair);
    if (documentChanged) {
      this.message = null;
      try { localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(this.controller.doc)); } catch { /* storage unavailable: keep tracing in memory */ }
      // 点を消して必須の Step を満たさなくなったら、その Step まで戻す。
      const doc = this.controller.doc, clamped = clampStep(doc, this.stepValue);
      if (this.reached !== 'entry') this.reached = clampStep(doc, this.reached);
      if (clamped !== this.stepValue) { this.stepValue = clamped; this.selectTool(clamped); }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.estimate(), 0);
    }
    this.render(); this.hooks.redraw();
  }

  /** 形を確定・削除し、入力を変えるたびに 1 回だけ再推定する。 */
  private estimate(): void {
    this.timer = undefined;
    const doc = this.controller.doc, projector = this.hooks.projector();
    if (doc.mode === 'match') {
      this.venue = null; this.result = null;
      if (projector && requiredAnchors(doc.locked) > 0 && doc.anchors.length >= requiredAnchors(doc.locked)) {
        const started = performance.now();
        try { this.result = reconstructVenue(toMatchInput(doc, projector)); }
        catch (error) { console.warn('Trace match failed', error); }
        this.elapsed = performance.now() - started;
      }
    } else if (doc.shapes.length === 0 || !projector) {
      this.result = null; this.venue = null;
    } else {
      const started = performance.now(), input = toReconstructInput(doc);
      try {
        this.result = reconstructVenue(input);
        this.venue = reconstructionToVenue(input, this.result, { projector, name: (role, index) => this.partName(role, index) });
      } catch (error) {
        console.warn('Trace estimate failed', error); this.result = null; this.venue = { status: 'failed', reason: 'reconstructionFailed' };
      }
      this.elapsed = performance.now() - started;
    }
    if (this.active) this.showEstimate();
    this.render(); this.hooks.redraw();
  }

  private showEstimate(): void {
    if (this.controller.mode === 'match') {
      const projector = this.matchedProjector();
      this.hooks.showEstimate(projector ? { objects: null, projector } : null);
      return;
    }
    this.hooks.showEstimate(this.venue?.status === 'ok' ? { objects: this.venue.objects, projector: this.venue.projector } : null);
  }

  private partName(role: VenuePartRole, index: number): string {
    const name = t(ROLE_NAMES[role]);
    return role === 'box' || role === 'panel' ? `${name} ${index + 1}` : name;
  }

  /** 推定済みの結果 (ブラウザテストで確かめる)。 */
  get state(): { result: ReconstructResult | null; venue: ReconstructionToVenueResult | null; elapsed: number } {
    return { result: this.result, venue: this.venue, elapsed: this.elapsed };
  }

  /** data-i18n の付いた文言を差し替える (言語の切り替えでも保たれる)。 */
  private setLabel(id: string, key: MessageKey): void {
    const span = this.get(id).querySelector<HTMLElement>('[data-i18n]');
    if (span && span.dataset.i18n !== key) { span.dataset.i18n = key; span.textContent = t(key); }
  }

  private renderMessage(): void { this.get('venue-trace-message').textContent = this.message ? t(this.message) : ''; }

  /** 次へ進めない理由。進めるなら null。 */
  private blockedReason(): string | null {
    const doc = this.controller.doc, context = this.context(), step = this.stepValue;
    // 進める、または再推定を待っているだけなら理由は出さない。
    if (this.advanceable() || (this.timer && canAdvance(step, doc, context))) return null;
    switch (step) {
      case 'prepare':
        return t(!context.keystoneOff ? 'calibration.traceNeedKeystone' : !context.outputOpen ? 'calibration.traceNeedOutput' : 'calibration.traceNeedThrow');
      case 'room1': return t('calibration.traceNeedRoom1');
      case 'room2': return t(roomCorners(doc) < 2 ? 'calibration.traceNeedRoom2' : 'calibration.traceNeedEstimate');
      case 'anchors': {
        const needed = requiredAnchors(doc.locked);
        if (needed === 0) return t('calibration.traceMatchAllLocked');
        return doc.anchors.length < needed ? t('calibration.traceMatchNeed', { count: String(needed - doc.anchors.length) }) : t('calibration.traceNeedEstimate');
      }
      default: return null;
    }
  }

  /** この Step でなぞった形があるか (任意の Step の「次へ / スキップ」の切り替え)。 */
  private tracedInStep(): boolean {
    const shapes = this.controller.doc.shapes;
    if (this.stepValue === 'boxes') return shapes.some(s => s.kind === 'boxCorner' || s.kind === 'rectangle');
    if (this.stepValue === 'scale') return shapes.some(s => s.kind === 'length');
    return true;
  }

  render(): void {
    const c = this.controller, doc = c.doc, match = c.mode === 'match', step = this.stepValue, entry = step === 'entry';
    const steps = stepsFor(c.mode), index = steps.indexOf(step as never);
    // 手順の一覧。済んだ Step と今の Step は選べ、先へは飛べない。
    this.get('venue-trace-steps-section').hidden = entry;
    this.get('venue-trace-steps').replaceChildren(...steps.map((s, i) => {
      const item = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'tool-button'; b.dataset.traceStep = s;
      b.textContent = t(STEP_NAMES[s]);
      b.disabled = entry || !canVisit(c.mode, this.reached, s);
      if (s === step) b.setAttribute('aria-current', 'step');
      item.classList.toggle('is-current', s === step); item.classList.toggle('is-done', !entry && i < steps.indexOf(this.reached as never) && s !== step);
      item.append(b);
      return item;
    }));
    const show: Record<string, boolean> = {
      'venue-trace-entry': entry, 'venue-trace-prepare': step === 'prepare', 'venue-trace-boxes': step === 'boxes', 'venue-trace-scale': step === 'scale',
      'venue-trace-match': step === 'anchors', 'venue-trace-review': step === 'review', 'venue-trace-nav': !entry && step !== 'review',
      'venue-trace-clear': !entry, 'venue-trace-shift-details': !match, 'venue-trace-throw-unknown-field': !match,
    };
    for (const [id, visible] of Object.entries(show)) this.get(id).hidden = !visible;
    // 準備のチェック。
    const outputOpen = this.hooks.outputOpen();
    this.input('venue-trace-keystone').checked = this.keystoneOff;
    this.input('venue-trace-throw-unknown').checked = this.throwRatioUnknown;
    const state = this.get('venue-trace-output-state');
    state.textContent = t(outputOpen ? 'calibration.traceOutputOpen' : 'calibration.traceOutputClosed'); state.classList.toggle('is-ok', outputOpen);
    this.get<HTMLButtonElement>('venue-trace-open-output').hidden = outputOpen;
    const pattern = this.get<HTMLSelectElement>('venue-trace-pattern');
    if (document.activeElement !== pattern) pattern.value = this.hooks.pattern();
    for (const [tool] of BOX_TOOLS) this.get(`venue-trace-tool-${tool}`).setAttribute('aria-pressed', String(c.tool === tool));
    for (const parameter of PROJECTOR_PARAMETERS) this.input(`venue-trace-lock-${parameter}`).checked = doc.locked.includes(parameter);
    this.setLabel('venue-trace-points-title', match ? 'calibration.traceAnchors' : 'calibration.tracePoints');
    this.setLabel('venue-trace-apply', match ? 'calibration.traceMatchApply' : 'calibration.traceApply');
    // 次へ / スキップ。
    this.setLabel('venue-trace-next', OPTIONAL_STEPS.includes(step) && !this.tracedInStep() ? 'calibration.traceSkip' : 'calibration.traceNext');
    this.get<HTMLButtonElement>('venue-trace-next').disabled = !this.advanceable();
    this.get('venue-trace-blocked').textContent = this.blockedReason() ?? '';
    this.renderGuide(index, steps.length);
    this.renderPoints(match);
    const lines = this.statusLines();
    this.get('venue-trace-status').replaceChildren(...lines.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    // 推定の結果は、必要な点がそろってから案内にも出す (足りない間は「次へ」の理由で足りる)。
    const ready = match ? doc.anchors.length >= requiredAnchors(doc.locked) : roomCorners(doc) >= 2;
    const guideLines = ready && step !== 'review' && step !== 'prepare' && !entry ? lines : [];
    this.get('venue-trace-guide-status').replaceChildren(...guideLines.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    this.get<HTMLButtonElement>('venue-trace-apply').disabled = !!this.timer || (match ? !this.matchedProjector() : this.venue?.status !== 'ok');
  }

  /** 投影される像の上の案内: どこで・何を狙うか・模式図・何が決まるか。 */
  private renderGuide(index: number, total: number): void {
    const c = this.controller, step = this.stepValue, tool = c.tool;
    this.get('venue-trace-count').textContent = step === 'entry' ? '' : t('calibration.traceStepCount', { n: String(index + 1), total: String(total) });
    this.get('venue-trace-where').replaceChildren(...STEP_WHERE[step].map(where => {
      const tag = document.createElement('span'); tag.className = `dc-venue-trace-where is-${where}`; tag.textContent = t(WHERE_NAMES[where]); return tag;
    }));
    let title: string, tip = '', diagram: string | null = null;
    const toolIndex = c.step, tips = tool ? TIPS[tool] : [];
    if (c.moving) title = t('calibration.traceMoving', { point: pointLabel(c.moving.id) });
    else if (step === 'entry') title = t('calibration.traceGuideEntry');
    else if (step === 'prepare') { title = t('calibration.traceGuidePrepare'); tip = t('calibration.traceGuidePrepareBody'); }
    else if (step === 'review') { title = t('calibration.traceGuideReview'); tip = t('calibration.traceGuideReviewBody'); }
    else if (step === 'room2' && roomCorners(c.doc) >= 2 && c.pending.length === 0) title = t('calibration.traceGuideRoomDone');
    else {
      title = c.stepKey ? t(`calibration.${c.stepKey}` as MessageKey) : '';
      tip = step === 'room2' && toolIndex === 2 ? t('calibration.traceTipRoomShared') : tips.length ? t(tips[Math.min(toolIndex, tips.length - 1)]) : '';
      if (OPTIONAL_STEPS.includes(step) && c.pending.length === 0 && this.tracedInStep()) tip = `${t('calibration.traceGuideNext')} ${tip}`;
      if (tool === 'roomCorner' || tool === 'boxCorner' || tool === 'anchor') diagram = traceDiagram(tool, toolIndex, step === 'room2' ? 'second' : 'first');
    }
    this.get('venue-trace-step').textContent = title;
    this.get('venue-trace-tip').textContent = tip;
    const decides = STEP_DECIDES[step];
    this.get('venue-trace-decides').textContent = decides ? t(decides) : '';
    const figure = this.get('venue-trace-diagram');
    figure.hidden = !diagram;
    if (figure.dataset.diagram !== (diagram ?? '')) { figure.innerHTML = diagram ?? ''; figure.dataset.diagram = diagram ?? ''; }
    // 十字の操作は点を確定する Step (と置き直し) でだけ出す。
    const confirming = !!c.moving || (tool !== null && step !== 'entry' && step !== 'prepare' && step !== 'review');
    this.get('venue-trace-confirm-row').hidden = !confirming; this.get('venue-trace-keys').hidden = !confirming;
    this.get('venue-trace-crosshair').textContent = t('calibration.traceCrosshair', { x: String(Math.round(c.crosshair[0])), y: String(Math.round(c.crosshair[1])) });
    const progress = tool === 'anchor' ? { done: c.doc.anchors.length, total: requiredAnchors(c.doc.locked) }
      : tool ? { done: c.pending.length, total: TOOL_STEPS[tool].length } : null;
    this.get('venue-trace-progress').textContent = progress && !c.moving ? t('calibration.traceProgress', { done: String(progress.done), total: String(progress.total) }) : '';
    this.renderMessage();
  }

  private renderPoints(match: boolean): void {
    const c = this.controller;
    const residuals = this.result?.residualPixels ?? {}, outliers = new Set(this.result?.outliers ?? []);
    this.get('venue-trace-points').replaceChildren(...(match ? c.doc.anchors : c.doc.points).map(point => {
      const item = document.createElement('li'), residual = residuals[point.id];
      item.dataset.point = point.id; item.classList.toggle('is-outlier', outliers.has(point.id));
      item.classList.toggle('is-pending', c.pending.includes(point.id)); item.classList.toggle('is-moving', c.moving?.id === point.id);
      const name = document.createElement('span'); name.textContent = pointLabel(point.id);
      const error = document.createElement('span'); error.className = 'dc-venue-trace-residual';
      error.textContent = residual === undefined ? '' : `${residual.toFixed(1)} px${outliers.has(point.id) ? ` · ${t('calibration.traceOutlier')}` : ''}`;
      const actions = (['move', 'remove'] as const).map(action => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tool-button';
        b.dataset.traceAction = action; b.dataset.point = point.id;
        b.textContent = t(action === 'move' ? 'calibration.traceMove' : 'calibration.traceRemove');
        b.setAttribute('aria-label', `${b.textContent} ${pointLabel(point.id)}`);
        return b;
      });
      item.append(name, error, ...actions);
      return item;
    }));
  }

  private matchStatusLines(): string[] {
    const doc = this.controller.doc, result = this.result, needed = requiredAnchors(doc.locked);
    if (needed === 0) return [t('calibration.traceMatchAllLocked')];
    if (doc.anchors.length < needed) return [t('calibration.traceMatchNeed', { count: String(needed - doc.anchors.length) })];
    if (!result || result.status === 'failed') return [t('calibration.traceFailed')];
    const lines = [t('calibration.traceMatchSolved', { count: String(Object.keys(result.residualPixels).length), ms: String(Math.round(this.elapsed)), rms: result.rmsPixels.toFixed(1) })];
    const unknown = result.underdetermined.filter((u): u is ProjectorParameter => PROJECTOR_PARAMETERS.includes(u as ProjectorParameter));
    if (unknown.length > 0) lines.push(t('calibration.traceMatchUnknown', { parameters: unknown.map(u => t(PARAMETER_NAMES[u])).join(', ') }));
    if (result.outliers.length > 0) lines.push(t('calibration.traceOutliers', { points: result.outliers.map(pointLabel).join(', ') }));
    return lines;
  }

  private statusLines(): string[] {
    if (this.controller.mode === 'match') return this.matchStatusLines();
    const venue = this.venue, result = this.result;
    if (!venue) return [];
    if (venue.status === 'failed') {
      const lines = [t(venue.reason === 'nothingDetermined' ? 'calibration.traceNothing' : 'calibration.traceFailed')];
      if (result?.underdetermined.includes('fov')) lines.push(t('calibration.traceFov'));
      return lines;
    }
    const lines = [t('calibration.traceSolved', { count: String(venue.objects.length), ms: String(Math.round(this.elapsed)), rms: (result?.rmsPixels ?? 0).toFixed(1) })];
    if (result?.underdetermined.includes('fov')) lines.push(t('calibration.traceFov'));
    if (result?.underdetermined.includes('lensShiftY')) lines.push(t('calibration.traceShiftUnknown'));
    if (venue.skipped.length > 0) lines.push(t('calibration.traceSkipped', { points: venue.skipped.flatMap(s => s.vertices).map(pointLabel).join(', ') }));
    if (result && result.outliers.length > 0) lines.push(t('calibration.traceOutliers', { points: result.outliers.map(pointLabel).join(', ') }));
    if (!venue.scaleKnown) lines.push(t('calibration.traceUnscaled'));
    return lines;
  }

  /**
   * 像の写しに、点の印・形の線を重ねる (観察専用。実出力には入らない)。点の番号と誤差の色・線は確認の Step でだけ描く。
   * scale は出力画素 → 写しの画素。
   */
  drawOverlay(context: CanvasRenderingContext2D, scale: number, ratio: number): void {
    if (!this.active) return;
    const c = this.controller, pixels = new Map(c.doc.points.map(p => [p.id, p.pixel]));
    const at = (id: string) => { const p = pixels.get(id); return p ? [p[0] * scale, p[1] * scale] as const : null; };
    const review = this.stepValue === 'review';
    const outliers = new Set(review ? this.result?.outliers ?? [] : []);
    context.save();
    context.lineWidth = 1.5 * ratio;
    const path = (ids: string[], close: boolean, color: string) => {
      const points = ids.map(at).filter((p): p is readonly [number, number] => !!p);
      if (points.length < 2) return;
      context.strokeStyle = color; context.beginPath(); context.moveTo(points[0][0], points[0][1]);
      for (const p of points.slice(1)) context.lineTo(p[0], p[1]);
      if (close) context.closePath();
      context.stroke();
    };
    if (c.mode === 'match') { this.drawAnchors(context, scale, ratio, outliers, review); context.restore(); return; }
    for (const shape of c.doc.shapes) {
      if (shape.kind === 'rectangle') path(shape.points, true, '#38bdf8');
      else if (shape.kind === 'length') path(shape.points, false, '#a3e635');
      else for (const edge of shape.points.slice(1)) path([shape.points[0], edge], false, shape.kind === 'roomCorner' ? '#38bdf8' : '#f59e0b');
    }
    context.setLineDash([4 * ratio, 3 * ratio]); path(c.pending, false, '#fde047'); context.setLineDash([]);
    context.font = `${11 * ratio}px system-ui, sans-serif`; context.textBaseline = 'bottom';
    for (const point of c.doc.points) {
      const p = at(point.id); if (!p) continue;
      const color = outliers.has(point.id) ? '#ef4444' : c.pending.includes(point.id) ? '#fde047' : '#38bdf8';
      context.fillStyle = color; context.strokeStyle = '#000';
      context.beginPath(); context.arc(p[0], p[1], 3.5 * ratio, 0, Math.PI * 2); context.fill(); context.stroke();
      if (c.moving?.id === point.id) { context.strokeStyle = '#fff'; context.beginPath(); context.arc(p[0], p[1], 7 * ratio, 0, Math.PI * 2); context.stroke(); }
      if (review) { context.fillStyle = color; context.fillText(pointLabel(point.id), p[0] + 5 * ratio, p[1] - 3 * ratio); }
    }
    context.restore();
  }

  /** 対応点の印と、確認の Step では推定 (無ければ確定済み) のプロジェクタで頂点が映る位置 → 確定した点の線・番号を描く。 */
  private drawAnchors(context: CanvasRenderingContext2D, scale: number, ratio: number, outliers: Set<string>, review: boolean): void {
    const c = this.controller, projector = this.shownProjector(), output = c.doc.output;
    const dot = (p: PixelPoint, color: string, radius: number) => {
      context.fillStyle = color; context.strokeStyle = '#000';
      context.beginPath(); context.arc(p[0] * scale, p[1] * scale, radius * ratio, 0, Math.PI * 2); context.fill(); context.stroke();
    };
    context.font = `${11 * ratio}px system-ui, sans-serif`; context.textBaseline = 'bottom';
    for (const anchor of c.doc.anchors) {
      const color = outliers.has(anchor.id) ? '#ef4444' : '#38bdf8';
      const virtual = review && projector ? projectToPixel(projector, output, anchor.world) : null;
      if (virtual) {
        context.strokeStyle = color; context.setLineDash([4 * ratio, 3 * ratio]);
        context.beginPath(); context.moveTo(virtual[0] * scale, virtual[1] * scale); context.lineTo(anchor.pixel[0] * scale, anchor.pixel[1] * scale); context.stroke();
        context.setLineDash([]); dot(virtual, '#a3e635', 2.5);
      }
      dot(anchor.pixel, color, 3.5);
      if (c.moving?.id === anchor.id) { context.strokeStyle = '#fff'; context.beginPath(); context.arc(anchor.pixel[0] * scale, anchor.pixel[1] * scale, 7 * ratio, 0, Math.PI * 2); context.stroke(); }
      if (review) { context.fillStyle = color; context.fillText(pointLabel(anchor.id), anchor.pixel[0] * scale + 5 * ratio, anchor.pixel[1] * scale - 3 * ratio); }
    }
    if (c.pendingVertex) {
      const p = c.pendingVertex.pixel;
      context.strokeStyle = '#fde047'; context.lineWidth = 2 * ratio;
      context.beginPath(); context.arc(p[0] * scale, p[1] * scale, 7 * ratio, 0, Math.PI * 2); context.stroke();
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    const stage = this.stage; if (!stage) return;
    stage.removeEventListener('pointerdown', this.pointerDown); stage.removeEventListener('pointermove', this.pointerMove);
    stage.removeEventListener('pointerup', this.pointerUp); stage.removeEventListener('pointercancel', this.pointerUp);
    stage.removeEventListener('dblclick', this.doubleClick);
  }
}
