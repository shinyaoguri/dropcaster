import { randomId } from '../utils/randomId';
import * as THREE from 'three';
import { ProjectionPreview } from '../practice/ProjectionPreview';
import { VenueBuilder } from '../practice/VenueBuilder';
import { VenueEditor } from '../practice/VenueEditor';
import { prepareVenue, prepareObjects, type PreparedVenue } from '../practice/loadVenue';
import { TracePanel, type TraceEstimate, type TracePreview } from './TracePanel';
import { collectVertices, isVertexVisible } from './venueVertices';
import { createProject, defaultProjector, defaultScene, encodeAsset, importVenue, parseProject, portableVenue, ProjectFormatError,
  MAX_GLB_BYTES, MAX_PACKAGE_BYTES, type Project, type Projector, type VenueScene, type Vec3 } from '../practice/project';
import { readProject } from '../practice/projectStore';
import { button, field, label, quaternion, rotation, vectorFields } from '../practice/controls';
import { activityButtonHtml, activityIcon, applyControlTranslations } from '../windows/control/ControlWindow.template';
import { ActivityBar } from '../windows/control/panels/ActivityBar';
import { ColumnResizers } from '../windows/control/panels/ColumnResizers';
import { getLang, onLangChange, t, type MessageKey } from '../i18n';
import { langSwitcherHtml, wireLangSwitcher } from '../i18n/LanguageSwitcher';
import { routeHref } from '../utils/paths';
import { buildInfoHtml } from '../utils/buildInfo';
import { installPracticeStyles } from '../practice/style';
import { installVenueStyles } from './style';
import { VenueSession } from './VenueSession';
import { CalibrationProjection, type CalibrationPattern } from './CalibrationProjection';
import { CalibrationWindow } from './CalibrationWindow';
import { ProjectorAdjuster } from './ProjectorAdjuster';
import type { NudgeStep } from './ProjectorNudge';

const PRESETS: [number, number][] = [[1920, 1080], [1280, 800], [1024, 768]];
const MIN_ASPECT = .2, MAX_ASPECT = 5;
type SizeSource = 'preset' | 'fullscreen' | 'venue';
/** 左端のアクティビティバーで切り替えるツール列の中身。 */
type VenuePanel = 'objects' | 'trace' | 'projector' | 'output' | 'files';
const PANEL_TITLES = { objects: 'calibration.objects', trace: 'calibration.trace', projector: 'calibration.projector', output: 'calibration.output', files: 'calibration.menu' } as const satisfies Record<VenuePanel, MessageKey>;

/**
 * Standalone calibration (ADR 0015 / 0019). No sketch, WindowController or mapping-storage writer is created here.
 * Layout mirrors the mapping editor (ADR 0021): the activity bar and tool panels on the left, then the projected image (2D)
 * and the venue (3D) side by side.
 */
export class VenueCalibrationPage {
  private root = document.createElement('section');
  // 離脱の直前に、確定待ちの微調整を確定してから保存待ちを確かめる。
  private session = new VenueSession(() => this.adjuster?.flush());
  private preview?: ProjectionPreview;
  private projection?: CalibrationProjection;
  private output?: CalibrationWindow;
  private builder?: VenueBuilder;
  private editor?: VenueEditor;
  private adjuster?: ProjectorAdjuster;
  private trace?: TracePanel;
  /** なぞる間に一時表示している推定 (保存していない)。 */
  private traceShown: TracePreview | null = null;
  /** 頂点の候補のキャッシュ (部材と姿勢が変わらない限り使い回す)。 */
  private vertexCache: { key: string; meshes: THREE.Mesh[]; vertices: Vec3[] } | null = null;
  private traceRestore = 0;
  private resizers = new ColumnResizers('dropcaster.venue.columnWidths.v1');
  private activityBar = new ActivityBar<VenuePanel>('objects', panel => PANEL_TITLES[panel]);
  private canvas = document.createElement('canvas');
  /** 投影される像の縮小表示。出力 canvas をそのまま CSS で縮めると 1px の輪郭が途切れるので、高品質に縮小して写す。 */
  private mirror = document.createElement('canvas');
  private mirrored = '';
  private resize?: ResizeObserver;
  private off: (() => void)[] = [];
  private frame = 0;
  private action = 0;
  private disposed = false;
  private failed = false;
  private selected = '';
  private previous: Project | null = null;
  private statusKey: MessageKey = 'practice.loading';
  private errorStatus = false;
  private outputSize: [number, number] = [1920, 1080];
  private sizeSource: SizeSource = 'preset';

  async initialize(): Promise<void> {
    installPracticeStyles(); installVenueStyles();
    this.root.className = 'dc-control-shell dc-venue-page';
    // マッピング画面と同じ骨格 (ADR 0021): 左端のアクティビティバーでツール列のパネルを切り替え、選択中の再押下で畳む。
    this.root.innerHTML = `<div class="control-container">
      <div class="dc-activity-bar">
        <div class="dc-activity-tabs" role="tablist" aria-orientation="vertical" data-i18n-aria-label="control.activity.label" aria-label="${t('control.activity.label')}">
          ${activityButtonHtml('objects', 'calibration.objects', 'cube', true)}
          ${activityButtonHtml('trace', 'calibration.trace', 'crosshair')}
          ${activityButtonHtml('projector', 'calibration.projector', 'projector')}
          ${activityButtonHtml('output', 'calibration.output', 'monitor')}
          ${activityButtonHtml('files', 'calibration.menu', 'save')}
        </div>
        <div class="dc-activity-bar-footer"><div class="dc-workspace-actions">
          <a id="venue-close" class="dc-workspace-close" href="${routeHref('/')}" data-i18n-title="calibration.close" data-i18n-aria-label="calibration.close">${activityIcon('home')}</a>
          <dialog id="venue-close-confirm" class="dc-workspace-confirm" aria-labelledby="venue-close-confirm-title" aria-describedby="venue-close-confirm-hint"><div class="dc-workspace-confirm-body">
            <p id="venue-close-confirm-title" class="dc-workspace-confirm-title" data-i18n="calibration.closeConfirm"></p>
            <p id="venue-close-confirm-hint" class="dc-workspace-confirm-hint" data-i18n="calibration.closeConfirmHint"></p>
            <div class="dc-workspace-confirm-actions">
              <button type="button" id="venue-close-cancel" data-i18n="practice.stopCancel" autofocus></button>
              <a id="venue-close-confirm-btn" class="is-danger" href="${routeHref('/')}" data-i18n="calibration.closeConfirmAction"></a>
            </div></div></dialog>
        </div></div>
      </div>
      <div class="column tool-column">
        <div class="column-header"><h2 data-i18n="calibration.objects">${t('calibration.objects')}</h2></div>
        <div class="dc-venue-status"><span id="venue-status" role="status" aria-live="polite"></span>${button('venue-reload', 'calibration.reload')}</div>
        <div class="tool-content dc-practice-settings">
          <div class="dc-tool-panel is-active" id="dc-tool-panel-objects" role="tabpanel" aria-labelledby="dc-activity-objects" data-tool-panel="objects">
            <div id="venue-section-objects"></div>
            <details id="venue-model-transform" class="tool-section"><summary>${label('practice.scale')}</summary><form id="practice-venue-form">
            ${field('practice-unit', 'practice.unit', .00001, 10000)}${vectorFields('practice-v-position','practice.position')}${vectorFields('practice-v-rotation','practice.rotation',-360,360)}${vectorFields('practice-v-scale','practice.scale',.0001,1000)}
            <label class="dc-practice-field">${label('practice.color')}<input id="practice-color" type="color"></label></form></details>
          </div>
          <div class="dc-tool-panel" id="dc-tool-panel-trace" role="tabpanel" aria-labelledby="dc-activity-trace" data-tool-panel="trace"></div>
          <div class="dc-tool-panel" id="dc-tool-panel-projector" role="tabpanel" aria-labelledby="dc-activity-projector" data-tool-panel="projector">
            <label class="dc-practice-field">${label('practice.output')}<select id="practice-output"></select></label>
            <div class="dc-venue-step" role="group" aria-labelledby="venue-step-label"><span id="venue-step-label">${label('calibration.step')}</span>
              <button type="button" id="venue-step-coarse" class="tool-button" aria-pressed="true">${label('calibration.coarse')}</button>
              <button type="button" id="venue-step-fine" class="tool-button" aria-pressed="false">${label('calibration.fine')}</button></div>
            <p class="dc-practice-hint">${label('calibration.adjustHint')}</p>
            <p class="dc-practice-hint">${label('calibration.keysHint')}</p>
            ${button('venue-undo-projector', 'calibration.undoProjector')}
            <form id="practice-projector-form">${vectorFields('practice-p-position','practice.position')}${vectorFields('practice-p-rotation','practice.rotation',-360,360)}
            ${field('practice-fov','practice.fov',1,170)}${field('practice-aspect','practice.aspect',MIN_ASPECT,MAX_ASPECT)}<p class="dc-practice-hint">${label('calibration.aspectHint')}</p>
            ${vectorFields('practice-shift','practice.shift',-200,200,.1,['X','Y'])}
            ${field('practice-near','practice.near',.001,1000)}${field('practice-far','practice.far',.002,10000)}${button('practice-reset-projector','practice.resetProjector')}</form>
          </div>
          <div class="dc-tool-panel" id="dc-tool-panel-output" role="tabpanel" aria-labelledby="dc-activity-output" data-tool-panel="output">
            <label class="dc-practice-field">${label('calibration.resolution')}<select id="venue-resolution">${PRESETS.map(([w,h])=>`<option value="${w}x${h}">${w} × ${h}</option>`).join('')}</select></label>
            <p class="dc-practice-hint">${label('calibration.resolutionHint')}</p>
            <p class="dc-practice-hint">${label('calibration.outputHint')}</p>
          </div>
          <div class="dc-tool-panel" id="dc-tool-panel-files" role="tabpanel" aria-labelledby="dc-activity-files" data-tool-panel="files">
            <section class="tool-section"><h3>${label('practice.venue')}</h3>
              <p class="dc-practice-hint">${label('calibration.intro')}</p>
              <label class="dc-practice-field">${label('calibration.venueName')}<input id="venue-name" maxlength="200" required></label>
              <p id="venue-storage" class="dc-practice-hint" role="status"></p>
              ${button('venue-export', 'practice.exportVenue')}
              <p class="dc-practice-hint">${label('calibration.isolated')}</p>
            </section>
            <section class="tool-section">
              ${button('venue-load', 'calibration.load')}${button('venue-copy-mapping', 'calibration.copyMapping')}
              ${button('practice-load-glb', 'practice.loadGlb')}${button('practice-sample', 'practice.sample')}
              <a id="venue-mapping" class="tool-button dc-venue-entry-link" href="${routeHref('/mapping')}" target="_blank" rel="noopener noreferrer" data-i18n="calibration.mapping"></a>
            </section>
            <section class="tool-section dc-venue-lang"><h3>${label('lang.label')}</h3>${langSwitcherHtml()}</section>
          </div>
        </div>
        ${buildInfoHtml() ? `<footer class="dc-build-info">${buildInfoHtml()}</footer>` : ''}
      </div>
      <div class="dc-column-resizer" data-resize-edge="tool" data-i18n-title="control.resizer.tool" title="${t('control.resizer.tool')}" aria-hidden="true"></div>
      <div class="column source-column dc-venue-pane" id="venue-image-pane">
        <div class="column-header">
          <h2>${label('calibration.projection')}</h2>
          <label class="dc-venue-header-field">${label('calibration.pattern')}<select id="venue-pattern">${['outline','grid','white','black'].map(kind=>`<option value="${kind}" data-i18n="calibration.${kind}">${t(`calibration.${kind}` as MessageKey)}</option>`).join('')}</select></label>
          ${button('venue-open-output','calibration.openOutput')}${button('venue-close-output','calibration.closeOutput')}
        </div>
        <div id="venue-output-stage" tabindex="0" data-i18n-title="calibration.imageHint" data-i18n-aria-label="calibration.imageHint"></div>
      </div>
      <div class="dc-column-resizer" data-resize-edge="source" data-i18n-title="control.resizer.source" title="${t('control.resizer.source')}" aria-hidden="true"></div>
      <div class="column mapping-column dc-venue-pane" id="venue-model-pane">
        <div class="column-header dc-practice-view-actions">
          <h2>${label('calibration.model')}</h2>
          ${button('practice-overview','practice.overview')}${button('practice-audience','practice.audience')}${button('practice-projector-view','practice.projectorView')}${button('venue-edit','practice.buildVenue')}
          <label class="dc-practice-check"><input id="practice-guides" type="checkbox" checked>${label('practice.guides')}</label>
        </div>
        <div class="dc-practice-viewport"></div>
      </div>
    </div>
    <input id="venue-file" type="file" accept=".json,application/json" hidden><input id="venue-glb-file" type="file" accept=".glb,model/gltf-binary" hidden>`;
    this.canvas.id = 'venue-canvas'; this.canvas.tabIndex = 0;
    this.get('venue-model-pane').querySelector('.dc-practice-viewport')!.append(this.canvas);
    document.querySelector('#app')!.replaceChildren(this.root); wireLangSwitcher(this.root);
    this.input('practice-aspect').readOnly = true;
    this.resizers.attach(this.root, document); this.activityBar.attach(this.root);
    this.get('venue-reload').hidden = true; this.setInert(true);
    this.get<HTMLButtonElement>('venue-export').disabled = true;
    this.wire(); this.off.push(onLangChange(() => this.translate())); this.translate();
    await this.session.ready;
    if (this.disposed) return;
    // レンダラーを作り終えるまでの失敗は WebGL が使えないことによる。それ以降の失敗を 3D 描画の停止と案内しない (#198)。
    let graphics = true;
    try {
      this.preview = new ProjectionPreview(this.canvas, document.createElement('video'));
      this.preview.setGuidesVisible(true);
      this.projection = new CalibrationProjection(this.preview);
      graphics = false;
      this.projection.canvas.hidden = true; this.mirror.id = 'venue-image';
      this.get('venue-output-stage').append(this.mirror, this.projection.canvas);
      this.output = new CalibrationWindow(this.projection, () => this.updateOutput(), {
        key: event => this.keydown(event), screen: (width, height) => this.setOutputSize(width, height, 'fullscreen'),
        pointer: (pixel, kind) => this.trace?.outputPointer(pixel, kind),
      });
      this.builder = new VenueBuilder((scene, fit) => this.editVenue(scene, fit), () => this.undo(), () => this.export(), () => this.get<HTMLInputElement>('venue-file').click());
      this.builder.element.open = true; this.get('venue-section-objects').append(this.builder.element);
      this.editor = new VenueEditor(this.preview, this.builder, object => {
        const scene = this.session.changes.get().venue.scene;
        if (scene.kind === 'objects') this.editVenue({ ...scene, objects: scene.objects!.map(current => current.id === object.id ? object : current) }, false);
      }, () => this.undo());
      this.adjuster = new ProjectorAdjuster({
        current: () => this.committedProjector(),
        preview: projector => this.showProjector(projector),
        commit: projector => this.commitProjector(projector),
        depth: projector => this.depth(projector),
        stepChanged: step => this.showStep(step),
      });
      this.adjuster.attach(this.get('venue-output-stage'), this.mirror);
      this.trace = new TracePanel(this.outputSize[0], this.outputSize[1], {
        projector: () => this.committedProjector(),
        showEstimate: estimate => this.showTraceEstimate(estimate),
        apply: estimate => this.applyTrace(estimate),
        applyProjector: projector => { this.commitProjector(projector); this.status('calibration.traceMatchApplied'); },
        vertices: () => this.venueVertices(),
        vertexVisible: (world, projector) => !!this.preview && isVertexVisible(this.preview.venueMeshes(), projector, world),
        displayedProjector: () => this.traceShown?.projector ?? this.adjuster?.pending ?? this.committedProjector(),
        undo: () => this.undo(),
        crosshair: pixel => this.projection?.setCrosshair(pixel),
        redraw: () => { this.mirrored = ''; },
        outputOpen: () => !!this.output?.isOpen,
        openOutput: () => this.openOutput(),
        pattern: () => this.get<HTMLSelectElement>('venue-pattern').value as CalibrationPattern,
        setPattern: pattern => { this.get<HTMLSelectElement>('venue-pattern').value = pattern; this.projection?.setPattern(pattern); },
      });
      this.get('dc-tool-panel-trace').append(this.trace.element);
      // 今やることの案内は、投影される像 (なぞる間は十字の操作盤) の上に置く。
      this.get('venue-output-stage').before(this.trace.guide);
      this.trace.attach(this.get('venue-output-stage'), this.mirror);
      this.off.push(this.activityBar.onChange(panel => this.setTracing(panel === 'trace')));
      this.builder.onSelection = () => this.update(this.session.changes.get());
      this.get('venue-model-pane').querySelector('.dc-practice-viewport')!.before(this.editor.element);
      this.off.push(this.session.changes.subscribe(project => this.update(project)), this.session.storage.subscribe(() => this.storageStatus()));
      this.resize = new ResizeObserver(() => this.resizePreview()); this.resize.observe(this.canvas.parentElement!);
      this.canvas.addEventListener('webglcontextlost', this.graphicsLost); this.projection.canvas.addEventListener('webglcontextlost', this.graphicsLost);
      const action = ++this.action, prepared = await prepareVenue(this.session.changes.get());
      if (this.disposed || this.failed || action !== this.action) { prepared.dispose(); return; }
      this.preview.setVenue(prepared.group, prepared.dispose); this.update(this.session.changes.get()); this.resizePreview();
      this.preview.overview(); this.editor.setActive(true); this.translate(); this.status('calibration.ready'); this.updateOutput(); this.setReady();
      this.frame = requestAnimationFrame(this.render);
    } catch (error) { if (!this.disposed) { this.fail(graphics ? 'calibration.graphicsError' : 'calibration.openError'); console.warn('Venue setup unavailable', error); } }
  }
  private get<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.querySelector(`#${id}`)!; }
  private input(id: string): HTMLInputElement { return this.get(id); }
  private value(id: string, value: number | string): void { if (document.activeElement !== this.input(id)) this.input(id).value = typeof value === 'number' ? String(Number(value.toFixed(5))) : value; }
  private vector(id: string): Vec3 { return [0,1,2].map(i=>this.input(`${id}-${i}`).valueAsNumber) as Vec3; }
  private setVector(id: string, values: number[]): void { values.forEach((value,i)=>this.value(`${id}-${i}`,value)); }
  private click(id: string, run: () => void): void { this.get(id).addEventListener('click', run); }
  private wire(): void {
    this.root.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
    // 微調整の途中で他の操作を始めたら、先に微調整を 1 回分として確定する。
    // 投影される像の上の操作は微調整そのものなので除く。
    for (const type of ['pointerdown', 'focusin'] as const) this.root.addEventListener(type, event => {
      if (!this.get('venue-output-stage').contains(event.target as Node)) this.adjuster?.flush();
    }, true);
    document.addEventListener('keydown', this.documentKeydown);
    window.addEventListener('blur', this.settle); window.addEventListener('pagehide', this.settle);
    // 出力が開いているときだけ確認する。下書きは自動で保存されるので、それ以外は 1 クリックで戻る。
    const confirm = this.get<HTMLDialogElement>('venue-close-confirm');
    this.get('venue-close').addEventListener('click', event => {
      if (!this.output?.isOpen) return;
      // ルーターは document でリンクを拾い、defaultPrevented を見ずに遷移するので伝播も止める。
      event.preventDefault(); event.stopPropagation(); if (!confirm.open) confirm.showModal();
    });
    this.click('venue-close-cancel', () => confirm.close());
    confirm.addEventListener('click', event => { if (event.target === confirm) confirm.close(); });
    confirm.addEventListener('keydown', event => event.stopPropagation());
    this.click('venue-step-coarse', () => this.adjuster?.setStep('coarse')); this.click('venue-step-fine', () => this.adjuster?.setStep('fine'));
    this.click('venue-undo-projector', () => this.undo());
    this.click('venue-edit',()=>this.editor?.setActive(true));
    this.click('practice-overview',()=>this.preview?.overview()); this.click('practice-audience',()=>this.preview?.audienceView()); this.click('practice-projector-view',()=>this.preview?.projectorView());
    this.get('practice-guides').addEventListener('change',()=>this.preview?.setGuidesVisible(this.input('practice-guides').checked));
    this.click('venue-open-output',()=>this.openOutput());
    this.click('venue-close-output',()=>this.output?.close());
    this.get('venue-pattern').addEventListener('change',()=>{ this.projection?.setPattern(this.get<HTMLSelectElement>('venue-pattern').value as CalibrationPattern); this.trace?.render(); });
    this.get('venue-resolution').addEventListener('change',()=>{
      const [width,height] = this.get<HTMLSelectElement>('venue-resolution').value.split('x').map(Number);
      this.setOutputSize(width,height,'preset');
    });
    this.get('practice-output').addEventListener('change',()=>{ this.editor?.cancel(); this.selected = this.get<HTMLSelectElement>('practice-output').value; this.update(this.session.changes.get()); });
    this.get('practice-projector-form').addEventListener('change',()=>{
      if (!this.get<HTMLFormElement>('practice-projector-form').reportValidity() || this.input('practice-near').valueAsNumber >= this.input('practice-far').valueAsNumber) { this.status('practice.invalid',true); return; }
      const projector = this.committedProjector(); if (!projector) return;
      this.commitProjector({ ...projector,
        position:this.vector('practice-p-position'),quaternion:quaternion(this.vector('practice-p-rotation')),verticalFovDegrees:this.input('practice-fov').valueAsNumber,
        lensShift:[this.input('practice-shift-0').valueAsNumber/100,this.input('practice-shift-1').valueAsNumber/100],
        near:this.input('practice-near').valueAsNumber,far:this.input('practice-far').valueAsNumber });
    });
    this.click('practice-reset-projector',()=>{
      const projector = this.committedProjector(); if (!projector) return;
      this.commitProjector({ ...defaultProjector(this.selected), id: projector.id, aspect: projector.aspect });
    });
    this.get('practice-venue-form').addEventListener('change',()=>{
      if (!this.get<HTMLFormElement>('practice-venue-form').reportValidity()) return;
      const project=this.session.changes.get(); this.commit({...project,venue:{...project.venue,scene:{...project.venue.scene,
        position:this.vector('practice-v-position'),quaternion:quaternion(this.vector('practice-v-rotation')),scale:this.vector('practice-v-scale'),metersPerUnit:this.input('practice-unit').valueAsNumber,color:this.input('practice-color').value}}});
    });
    this.get('venue-name').addEventListener('change',()=>{ const name=this.input('venue-name').value.trim(); if(name) this.commit({...this.session.changes.get(),name}); });
    this.click('venue-export',()=>this.export()); this.click('venue-load',()=>this.input('venue-file').click());
    this.click('practice-load-glb',()=>this.input('venue-glb-file').click());
    this.get('venue-file').addEventListener('change',()=>void this.readFile(false)); this.get('venue-glb-file').addEventListener('change',()=>void this.readFile(true));
    this.click('venue-copy-mapping',()=>void this.copyMapping());
    this.click('practice-sample',()=>{ const project=this.session.changes.get(); void this.apply({...project,assets:[],venue:{...project.venue,scene:defaultScene()}}); });
    this.click('venue-reload',()=>window.location.reload());
  }
  private settle = (): void => { this.adjuster?.flush(); };
  private documentKeydown = (event: KeyboardEvent): void => {
    if (this.root.querySelector('dialog[open]')) return;
    this.keydown(event);
  };
  private keydown(event: KeyboardEvent): void {
    if (this.disposed || this.failed || !this.preview) return;
    if (this.trace?.isActive) { if (this.trace.handleKey(event)) event.preventDefault(); return; }
    if (this.adjuster?.handleKey(event)) event.preventDefault();
  }
  private committedProjector(): Projector | null {
    return this.session.changes.get().venue.projectors.find(p=>p.outputId===this.selected) ?? null;
  }
  private commitProjector(projector: Projector): void {
    const project = this.session.changes.get();
    this.commit({ ...project, venue: { ...project.venue, projectors: project.venue.projectors.map(p=>p.outputId===projector.outputId?projector:p) } });
  }
  /** 表示だけを更新する (保存しない)。微調整の途中と確定後の両方で使う。 */
  private showProjector(projector: Projector): void {
    this.preview?.setProjector(projector);
    this.setVector('practice-p-position',projector.position); this.setVector('practice-p-rotation',rotation(projector.quaternion));
    this.value('practice-fov',projector.verticalFovDegrees); this.value('practice-aspect',projector.aspect); this.setVector('practice-shift',projector.lensShift.map(v=>v*100));
    this.value('practice-near',projector.near); this.value('practice-far',projector.far);
    this.projection?.render();
  }
  private showStep(step: NudgeStep): void {
    for (const name of ['coarse','fine'] as const) this.get(`venue-step-${name}`).setAttribute('aria-pressed', String(name === step));
  }
  /** 平行移動ドラッグの基準: 会場の外接箱の中心までの、光軸方向の深さ。 */
  private depth(projector: Projector): number {
    const box = new THREE.Box3();
    for (const mesh of this.preview?.venueMeshes() ?? []) { mesh.updateWorldMatrix(true, false); box.expandByObject(mesh); }
    if (box.isEmpty()) return 3;
    const local = box.getCenter(new THREE.Vector3()).sub(new THREE.Vector3(...projector.position))
      .applyQuaternion(new THREE.Quaternion(...projector.quaternion).invert());
    return Math.max(.2, -local.z);
  }
  /**
   * 出力 canvas の解像度を決め、プロジェクタのアスペクト比をそれに合わせる。
   * 'venue' は読み込んだ会場のアスペクト比から決めたときで、会場は書き換えない。
   */
  private setOutputSize(width: number, height: number, source: SizeSource): void {
    if (this.disposed || this.failed || !this.projection) return;
    if (this.outputSize[0] !== width || this.outputSize[1] !== height || this.sizeSource !== source) {
      this.outputSize = [width, height]; this.sizeSource = source;
      this.projection.setSize(width, height); this.trace?.setOutput(width, height); this.projection.render(); this.output?.update();
      this.showResolution();
    }
    if (source === 'venue') return;
    const projector = this.committedProjector(), aspect = THREE.MathUtils.clamp(width / height, MIN_ASPECT, MAX_ASPECT);
    if (projector && Math.abs(projector.aspect - aspect) > 1e-6) this.commitProjector({ ...projector, aspect });
  }
  private showResolution(): void {
    const select = this.get<HTMLSelectElement>('venue-resolution'), [width, height] = this.outputSize, value = `${width}x${height}`;
    select.querySelector('option[data-custom]')?.remove();
    if (this.sizeSource === 'fullscreen' || !PRESETS.some(([w,h]) => w === width && h === height)) {
      const option = new Option(t(this.sizeSource === 'fullscreen' ? 'calibration.fullscreenSize' : 'calibration.customSize', { size: `${width} × ${height}` }), value);
      option.dataset.custom = ''; select.prepend(option);
    }
    select.value = value;
  }
  /** 読み込んだ会場のアスペクト比が出力と合わないときは、同じ比のプリセットか高さ 1080 の幅に合わせる。 */
  private followAspect(aspect: number): void {
    const [width, height] = this.outputSize;
    if (Math.abs(width / height - aspect) < 1e-3) return;
    const preset = PRESETS.find(([w,h]) => Math.abs(w / h - aspect) < 1e-3);
    const size: [number, number] = preset ?? [Math.max(1, Math.round(1080 * aspect)), 1080];
    this.setOutputSize(size[0], size[1], 'venue');
  }
  private update(project: Project): void {
    if (this.disposed || !this.preview) return;
    const outputs = project.venue.layout.outputs;
    if (!outputs.some(output=>output.id===this.selected)) this.selected=outputs[0].id;
    const select=this.get<HTMLSelectElement>('practice-output'), options=JSON.stringify(outputs.map(o=>[o.id,o.name]));
    if(select.dataset.options!==options) { select.replaceChildren(...outputs.map((o,i)=>new Option(o.name||`Output ${i+1}`,o.id))); select.dataset.options=options; }
    select.value=this.selected;
    const projector=project.venue.projectors.find(p=>p.outputId===this.selected)!;
    if (this.traceShown?.objects) this.showProjector(this.traceShown.projector);
    else { this.preview.setVenueTransform(project.venue.scene); this.showProjector(this.traceShown?.projector ?? this.adjuster?.pending ?? projector); }
    this.followAspect(projector.aspect);
    const scene=project.venue.scene; this.get('venue-model-transform').hidden=scene.kind==='objects';
    this.setVector('practice-v-position',scene.position); this.setVector('practice-v-rotation',rotation(scene.quaternion)); this.setVector('practice-v-scale',scene.scale);
    this.value('practice-unit',scene.metersPerUnit); this.value('practice-color',scene.color); this.value('venue-name',project.name==='Untitled'?t('practice.untitled'):project.name);
    this.builder?.update(scene,!!this.previous); this.editor?.update(scene,this.builder?.selectedId??'',!!this.previous); this.projection?.render();
    this.get<HTMLButtonElement>('venue-undo-projector').disabled = !this.previous;
  }
  private commit(project: Project, prepared?: PreparedVenue, fit=false): void {
    if (this.disposed || this.failed) { prepared?.dispose(); return; }
    this.adjuster?.flush();
    try {
      const next=parseProject({...project,venue:{...project.venue,revision:project.venue.revision+1}});
      this.editor?.cancel(); this.action++; this.previous=this.session.changes.get();
      if(prepared) { this.traceShown=null; this.traceRestore++; this.preview!.setVenue(prepared.group,prepared.dispose); }
      this.session.update(next);
      if(fit) { this.preview!.overview(); if(next.venue.scene.objects?.length===1) this.editor?.focusSelection(); }
      this.status('calibration.updated');
    } catch(error) { prepared?.dispose(); this.error(error); }
  }
  /** なぞるパネルを開いている間は、像の直接操作と立体の編集を止める (十字の操作と取り合わない)。 */
  private setTracing(active: boolean): void {
    if (!this.trace || active === this.trace.isActive) return;
    this.adjuster?.flush();
    if (this.adjuster) this.adjuster.suspended = active;
    if (active) this.editor?.setActive(false);
    this.trace.setActive(active);
    this.root.classList.toggle('is-tracing', active);
  }
  /** 推定した会場とプロジェクタを一時表示する (保存しない)。null なら確定済みの表示へ戻す。 */
  private showTraceEstimate(estimate: TracePreview | null): void {
    if (!this.preview || this.disposed || this.failed) return;
    const token = ++this.traceRestore;
    if (estimate?.objects) {
      const prepared = prepareObjects(estimate.objects);
      this.traceShown = estimate;
      this.preview.setVenue(prepared.group, prepared.dispose);
      this.preview.setVenueTransform({ ...defaultScene(), kind: 'objects' });
      this.update(this.session.changes.get());
      return;
    }
    const replacedVenue = !!this.traceShown?.objects;
    // プロジェクタだけの推定 (測った会場に合わせる) は、確定済みの会場のまま投影を差し替える。
    this.traceShown = estimate;
    if (!replacedVenue) { this.update(this.session.changes.get()); return; }
    void prepareVenue(this.session.changes.get()).then(prepared => {
      if (this.disposed || this.failed || token !== this.traceRestore) { prepared.dispose(); return; }
      this.preview!.setVenue(prepared.group, prepared.dispose); this.update(this.session.changes.get());
    }).catch(error => { if (!this.disposed && token === this.traceRestore) this.error(error); });
  }
  /** なぞった会場とプロジェクタを 1 回の変更 (1 revision) として書き込む。「直前の変更を戻す」1 回で戻る。 */
  /** 確定済みの会場の、壁に輪郭として映る頂点。なぞって作った会場を一時表示している間は候補にしない。 */
  private venueVertices(): Vec3[] {
    if (!this.preview || this.traceShown?.objects) return [];
    const meshes = this.preview.venueMeshes();
    meshes.forEach(mesh => mesh.updateWorldMatrix(true, false));
    const key = JSON.stringify(meshes.map(mesh => mesh.matrixWorld.elements));
    const cache = this.vertexCache;
    if (cache && cache.key === key && cache.meshes.length === meshes.length && cache.meshes.every((mesh, i) => mesh === meshes[i])) return cache.vertices;
    const vertices = collectVertices(meshes);
    this.vertexCache = { key, meshes, vertices };
    return vertices;
  }
  private applyTrace(estimate: TraceEstimate): void {
    const current = this.session.changes.get();
    try {
      const project = parseProject({ ...current, assets: [], venue: { ...current.venue,
        scene: { ...defaultScene(), kind: 'objects', objects: estimate.objects },
        projectors: current.venue.projectors.map(p => p.outputId === estimate.projector.outputId ? estimate.projector : p) } });
      this.commit(project, prepareObjects(project.venue.scene.objects!), false);
      this.status('calibration.traceApplied');
    } catch (error) { this.error(error); }
  }
  private editVenue(scene: VenueScene, fit: boolean): void {
    if(!this.preview || this.disposed || this.failed) return;
    const current=this.session.changes.get();
    try {
      const project=parseProject({...current,assets:[],venue:{...current.venue,scene}});
      this.commit(project,prepareObjects(project.venue.scene.objects!),fit);
    } catch(error) { this.error(error); }
  }
  private async apply(project: Project): Promise<void> {
    const action=++this.action; this.editor?.cancel(); this.adjuster?.cancel(); this.status('practice.busy');
    try {
      const next=parseProject(project), prepared=await prepareVenue(next);
      if(this.disposed || this.failed || action!==this.action) { prepared.dispose(); return; }
      this.commit(next,prepared,true); this.status('calibration.loaded');
    } catch(error) { if(!this.disposed && action===this.action) this.error(error); }
  }
  private undo(): void { this.adjuster?.cancel(); if(this.previous) void this.apply(this.previous); }
  private async readFile(model: boolean): Promise<void> {
    const input=this.input(model?'venue-glb-file':'venue-file'), file=input.files?.[0]; input.value=''; if(!file)return;
    const action=++this.action; this.editor?.cancel(); this.status('practice.busy');
    try {
      if(file.size>(model?MAX_GLB_BYTES:MAX_PACKAGE_BYTES)) throw new ProjectFormatError('size');
      if(model) {
        const bytes=await file.arrayBuffer(); if(this.disposed || action!==this.action)return;
        const current=this.session.changes.get(), id=randomId();
        await this.apply({...current,assets:[{id,name:file.name,mimeType:'model/gltf-binary',data:encodeAsset(new Uint8Array(bytes))}],venue:{...current.venue,scene:{...defaultScene(),kind:'glb',assetId:id}}});
      } else {
        const text=await file.text(); if(this.disposed || action!==this.action)return;
        const value=JSON.parse(text), project=value?.format==='dropcaster-venue'?{...importVenue(value,createProject()),name:value.name}:parseProject(value);
        await this.apply(project);
      }
    } catch(error) { if(!this.disposed && action===this.action) this.error(error); }
  }
  private async copyMapping(): Promise<void> {
    const action=++this.action;
    try {
      const project=await readProject(); if(this.disposed || action!==this.action)return;
      if(!project) { this.status('calibration.noMapping',true);return; }
      await this.apply(parseProject(project));
    } catch(error) { if(!this.disposed && action===this.action)this.error(error); }
  }
  private export(): void {
    this.adjuster?.flush();
    const project=this.session.changes.get(), url=URL.createObjectURL(new Blob([JSON.stringify(portableVenue(project),null,2)],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url; link.download=`${project.name.replace(/[^\p{L}\p{N}._-]/gu,'_')}.venue.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  private setInert(inert: boolean): void {
    for (const selector of ['.tool-content', '#venue-image-pane', '#venue-model-pane']) (this.root.querySelector(selector) as HTMLElement).inert = inert;
  }
  private setReady(): void { this.setInert(false); this.get<HTMLButtonElement>('venue-export').disabled = false; }
  private updateOutput(): void { this.get<HTMLButtonElement>('venue-close-output').disabled=!this.output?.isOpen; this.trace?.render(); }
  private openOutput(): void { this.editor?.cancel(); if (!this.output?.open()) this.status('calibration.blocked',true); }
  private resizePreview(): void {
    const rect=this.canvas.parentElement?.getBoundingClientRect(); if(rect?.width && rect.height) this.preview?.resize(Math.round(rect.width),Math.round(rect.height));
  }
  private render=():void=>{
    if(this.disposed || this.failed)return;
    this.preview?.renderGeometry();
    this.projection?.render(); this.drawMirror(); this.frame=requestAnimationFrame(this.render);
  };
  private drawMirror(): void {
    const projection = this.projection, stage = this.get('venue-output-stage'); if (!projection) return;
    const ratio = window.devicePixelRatio || 1, rect = stage.getBoundingClientRect(), source = projection.canvas;
    const scale = Math.min(rect.width / source.width, rect.height / source.height);
    if (!(scale > 0)) return;
    const width = Math.max(1, Math.round(source.width * scale * ratio)), height = Math.max(1, Math.round(source.height * scale * ratio));
    const key = `${projection.revision}/${width}x${height}/${this.trace?.isActive ? this.trace.controller.version : -1}`;
    if (key === this.mirrored) return;
    this.mirrored = key;
    if (this.mirror.width !== width || this.mirror.height !== height) {
      this.mirror.width = width; this.mirror.height = height;
      this.mirror.style.width = `${width / ratio}px`; this.mirror.style.height = `${height / ratio}px`;
    }
    const context = this.mirror.getContext('2d'); if (!context) return;
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    this.trace?.drawOverlay(context, width / source.width, ratio);
  }
  private status(key: MessageKey,error=false):void { this.statusKey=key;this.errorStatus=error;this.get('venue-status').textContent=t(key);this.get('venue-status').classList.toggle('is-error',error); }
  private error(error:unknown):void {
    // 形式の検証で分かった原因はその文言を出す。それ以外は汎用の文言になるので、元の例外を残す (#198)。
    if(!(error instanceof ProjectFormatError)) console.warn('Venue change failed',error);
    this.status(error instanceof ProjectFormatError?`practice.${error.message}` as MessageKey:'practice.invalid',true);
  }
  private storageStatus():void { const state=this.session.storage.get(); this.get('venue-storage').textContent=t(state==='error'?'practice.storageError':state==='saving'?'practice.saving':'calibration.saved'); }
  private translate(): void {
    applyControlTranslations(this.root); this.activityBar.render();
    this.root.querySelector('[data-lang-switcher]')?.setAttribute('aria-label',t('lang.toggle.title'));
    this.root.querySelectorAll<HTMLElement>('[data-lang-set]').forEach(button=>{
      const active=button.dataset.langSet===getLang();button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
    });
    this.root.querySelectorAll('fieldset input').forEach(input=>{
      const axis=input.closest('label')?.textContent?.trim(),name=input.closest('fieldset')?.querySelector('legend')?.textContent;
      if(axis&&name)input.setAttribute('aria-label',`${name} ${axis}`);
    });
    this.status(this.statusKey,this.errorStatus);this.storageStatus();this.update(this.session.changes.get());this.canvas.setAttribute('aria-label',t('practice.viewHint'));
    if (this.projection) this.showResolution();
    this.trace?.render(); this.mirrored = '';
  }
  private graphicsLost=(event:Event):void=>{event.preventDefault();this.fail();};
  private fail(key:MessageKey='calibration.graphicsError'):void {this.failed=true;this.setReady();this.adjuster?.cancel();this.editor?.cancel();this.output?.close();cancelAnimationFrame(this.frame);this.status(key,true);this.get<HTMLButtonElement>('venue-open-output').disabled=true;this.get('venue-reload').hidden=false;}
  destroy():void {
    if(this.disposed)return;
    this.adjuster?.flush();
    this.disposed=true;this.action++;cancelAnimationFrame(this.frame);this.resize?.disconnect();this.off.forEach(off=>off());this.resizers.destroy();this.activityBar.destroy();
    document.removeEventListener('keydown',this.documentKeydown);
    window.removeEventListener('blur',this.settle);window.removeEventListener('pagehide',this.settle);
    this.canvas.removeEventListener('webglcontextlost',this.graphicsLost);this.projection?.canvas.removeEventListener('webglcontextlost',this.graphicsLost);
    this.adjuster?.dispose();this.trace?.dispose();this.output?.dispose();this.editor?.dispose();this.projection?.dispose();this.preview?.dispose();this.session.dispose();this.root.remove();
  }
}
