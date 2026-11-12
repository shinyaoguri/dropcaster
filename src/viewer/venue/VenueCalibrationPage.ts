import { ProjectionPreview } from '../practice/ProjectionPreview';
import { VenueBuilder } from '../practice/VenueBuilder';
import { VenueEditor } from '../practice/VenueEditor';
import { prepareVenue, prepareObjects, type PreparedVenue } from '../practice/loadVenue';
import { createProject, defaultProjector, defaultScene, encodeAsset, importVenue, parseProject, portableVenue, ProjectFormatError,
  MAX_GLB_BYTES, MAX_PACKAGE_BYTES, type Project, type VenueScene, type Vec3 } from '../practice/project';
import { readProject } from '../practice/projectStore';
import { button, field, label, quaternion, rotation, vectorFields } from '../practice/controls';
import { applyControlTranslations } from '../windows/control/ControlWindow.template';
import { onLangChange, t, type MessageKey } from '../i18n';
import { langSwitcherHtml, wireLangSwitcher } from '../i18n/LanguageSwitcher';
import { routeHref } from '../utils/paths';
import { installPracticeStyles } from '../practice/style';
import { installVenueStyles } from './style';
import { VenueSession } from './VenueSession';
import { CalibrationProjection, type CalibrationPattern } from './CalibrationProjection';
import { CalibrationWindow } from './CalibrationWindow';

/** Standalone calibration. No sketch, WindowController or mapping-storage writer is created here. */
export class VenueCalibrationPage {
  private root = document.createElement('section');
  private session = new VenueSession();
  private preview?: ProjectionPreview;
  private projection?: CalibrationProjection;
  private output?: CalibrationWindow;
  private builder?: VenueBuilder;
  private editor?: VenueEditor;
  private canvas = document.createElement('canvas');
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

  async initialize(): Promise<void> {
    installPracticeStyles(); installVenueStyles();
    this.root.className = 'dc-venue-page';
    this.root.innerHTML = `<header class="dc-venue-header"><a href="${routeHref('/')}">${label('calibration.home')}</a><h1>${label('calibration.title')}</h1>${langSwitcherHtml()}${button('venue-export', 'practice.exportVenue')}</header>
      <p class="dc-venue-intro">${label('calibration.intro')}</p>
      <div class="dc-venue-layout"><aside class="dc-practice-settings"><nav class="dc-venue-tabs" role="tablist">
        ${['objects','projector','files'].map((tab,i)=>`<button type="button" id="venue-${tab}-tab" role="tab" aria-controls="venue-${tab}-pane" aria-selected="${i===0}" data-i18n="calibration.${tab}">${t(`calibration.${tab}` as MessageKey)}</button>`).join('')}</nav>
        <div class="dc-venue-sidebar-scroll"><div id="venue-objects-pane" role="tabpanel" aria-labelledby="venue-objects-tab">
          <details id="venue-model-transform" class="tool-section"><summary>${label('practice.venue')}</summary><form id="practice-venue-form">
          ${field('practice-unit', 'practice.unit', .00001, 10000)}${vectorFields('practice-v-position','practice.position')}${vectorFields('practice-v-rotation','practice.rotation',-360,360)}${vectorFields('practice-v-scale','practice.scale',.0001,1000)}
          <label class="dc-practice-field">${label('practice.color')}<input id="practice-color" type="color"></label></form></details>
        </div><div id="venue-projector-pane" role="tabpanel" aria-labelledby="venue-projector-tab" hidden>
          <label class="dc-practice-field">${label('practice.output')}<select id="practice-output"></select></label>
          <p class="dc-practice-hint">${label('calibration.outputHint')}</p>
          <form id="practice-projector-form">${vectorFields('practice-p-position','practice.position')}${vectorFields('practice-p-rotation','practice.rotation',-360,360)}
          ${field('practice-fov','practice.fov',1,170)}${field('practice-aspect','practice.aspect',.2,5)}${vectorFields('practice-shift','practice.shift',-200,200,.1,['X','Y'])}
          ${field('practice-near','practice.near',.001,1000)}${field('practice-far','practice.far',.002,10000)}${button('practice-reset-projector','practice.resetProjector')}</form>
        </div><div id="venue-files-pane" role="tabpanel" aria-labelledby="venue-files-tab" hidden>
          <label class="dc-practice-field">${label('calibration.venueName')}<input id="venue-name" maxlength="200" required></label>
          <p id="venue-storage" class="dc-practice-hint" role="status"></p><p class="dc-practice-hint">${label('calibration.isolated')}</p>
          ${button('venue-load','calibration.load')}${button('venue-copy-mapping','calibration.copyMapping')}${button('practice-load-glb','practice.loadGlb')}${button('practice-sample','practice.sample')}
          <a href="${routeHref('/mapping')}" target="_blank" rel="noopener noreferrer">${label('practice.start')}</a>
        </div></div></aside>
      <main class="dc-venue-main"><div class="dc-venue-output-controls">
        <label>${label('calibration.pattern')}<select id="venue-pattern">${['outline','grid','white','black'].map(kind=>`<option value="${kind}" data-i18n="calibration.${kind}">${t(`calibration.${kind}` as MessageKey)}</option>`).join('')}</select></label>
        <label>${label('calibration.resolution')}<select id="venue-resolution"><option value="1920x1080">1920 × 1080</option><option value="1280x800">1280 × 800</option><option value="1024x768">1024 × 768</option></select></label>
        ${button('venue-open-output','calibration.openOutput')}${button('venue-close-output','calibration.closeOutput')}</div>
        <p class="dc-practice-hint">${label('calibration.resolutionHint')}</p>
        <nav class="dc-venue-tabs" role="tablist"><button id="venue-model-tab" type="button" role="tab" aria-controls="venue-model-stage" aria-selected="true">${label('calibration.model')}</button><button id="venue-output-tab" type="button" role="tab" aria-controls="venue-output-stage" aria-selected="false">${label('calibration.projection')}</button></nav>
        <div id="venue-model-stage" class="dc-practice-panel" role="tabpanel" aria-labelledby="venue-model-tab"><div class="column-header dc-practice-view-actions">
          ${button('practice-overview','practice.overview')}${button('practice-audience','practice.audience')}${button('practice-projector-view','practice.projectorView')}${button('venue-edit','practice.buildVenue')}
          <label class="dc-practice-check"><input id="practice-guides" type="checkbox" checked>${label('practice.guides')}</label></div>
          <div class="dc-practice-viewport"></div></div>
        <div id="venue-output-stage" role="tabpanel" aria-labelledby="venue-output-tab" hidden></div>
      </main></div><footer><span id="venue-status" role="status" aria-live="polite"></span>${button('venue-reload','calibration.reload')}</footer>
      <input id="venue-file" type="file" accept=".json,application/json" hidden><input id="venue-glb-file" type="file" accept=".glb,model/gltf-binary" hidden>`;
    this.canvas.id = 'venue-canvas'; this.canvas.tabIndex = 0;
    this.get('venue-model-stage').querySelector('.dc-practice-viewport')!.append(this.canvas);
    document.querySelector('#app')!.replaceChildren(this.root); wireLangSwitcher(this.root);
    this.get('venue-reload').hidden = true; this.get('venue-model-stage').parentElement!.inert = true; this.get('venue-objects-pane').closest('aside')!.inert = true;
    this.get<HTMLButtonElement>('venue-export').disabled = true;
    this.wire(); this.off.push(onLangChange(() => this.translate())); this.translate();
    await this.session.ready;
    if (this.disposed) return;
    try {
      this.preview = new ProjectionPreview(this.canvas, document.createElement('video'));
      this.preview.setGuidesVisible(true);
      this.projection = new CalibrationProjection(this.preview);
      this.get('venue-output-stage').append(this.projection.canvas);
      this.output = new CalibrationWindow(this.projection, () => this.updateOutput());
      this.builder = new VenueBuilder((scene, fit) => this.editVenue(scene, fit), () => this.undo(), () => this.export(), () => this.get<HTMLInputElement>('venue-file').click());
      this.builder.element.open = true; this.get('venue-objects-pane').append(this.builder.element);
      this.editor = new VenueEditor(this.preview, this.builder, object => {
        const scene = this.session.changes.get().venue.scene;
        if (scene.kind === 'objects') this.editVenue({ ...scene, objects: scene.objects!.map(current => current.id === object.id ? object : current) }, false);
      }, () => this.undo());
      this.builder.onSelection = () => this.update(this.session.changes.get());
      this.get('venue-model-stage').querySelector('.dc-practice-viewport')!.before(this.editor.element);
      this.off.push(this.session.changes.subscribe(project => this.update(project)), this.session.storage.subscribe(() => this.storageStatus()));
      this.resize = new ResizeObserver(() => this.resizePreview()); this.resize.observe(this.canvas.parentElement!);
      this.canvas.addEventListener('webglcontextlost', this.graphicsLost); this.projection.canvas.addEventListener('webglcontextlost', this.graphicsLost);
      const action = ++this.action, prepared = await prepareVenue(this.session.changes.get());
      if (this.disposed || this.failed || action !== this.action) { prepared.dispose(); return; }
      this.preview.setVenue(prepared.group, prepared.dispose); this.update(this.session.changes.get()); this.resizePreview();
      this.preview.overview(); this.editor.setActive(true); this.translate(); this.status('calibration.ready'); this.updateOutput(); this.setReady();
      this.frame = requestAnimationFrame(this.render);
    } catch (error) { if (!this.disposed) { this.fail(); console.warn('Venue setup unavailable', error); } }
  }
  private get<T extends HTMLElement = HTMLElement>(id: string): T { return this.root.querySelector(`#${id}`)!; }
  private input(id: string): HTMLInputElement { return this.get(id); }
  private value(id: string, value: number | string): void { if (document.activeElement !== this.input(id)) this.input(id).value = typeof value === 'number' ? String(Number(value.toFixed(5))) : value; }
  private vector(id: string): Vec3 { return [0,1,2].map(i=>this.input(`${id}-${i}`).valueAsNumber) as Vec3; }
  private setVector(id: string, values: number[]): void { values.forEach((value,i)=>this.value(`${id}-${i}`,value)); }
  private click(id: string, run: () => void): void { this.get(id).addEventListener('click', run); }
  private wire(): void {
    this.root.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
    for (const tab of ['objects','projector','files']) this.click(`venue-${tab}-tab`,()=>{
      for (const name of ['objects','projector','files']) { this.get(`venue-${name}-pane`).hidden = name !== tab; this.get(`venue-${name}-tab`).setAttribute('aria-selected',String(name===tab)); }
    });
    for (const tab of ['model','output']) this.click(`venue-${tab}-tab`,()=>{
      this.editor?.cancel();
      for (const name of ['model','output']) { this.get(`venue-${name}-stage`).hidden = name !== tab; this.get(`venue-${name}-tab`).setAttribute('aria-selected',String(name===tab)); }
      if (tab === 'model') this.resizePreview();
    });
    this.click('venue-edit',()=>this.editor?.setActive(true));
    this.click('practice-overview',()=>this.preview?.overview()); this.click('practice-audience',()=>this.preview?.audienceView()); this.click('practice-projector-view',()=>this.preview?.projectorView());
    this.get('practice-guides').addEventListener('change',()=>this.preview?.setGuidesVisible(this.input('practice-guides').checked));
    this.click('venue-open-output',()=>{ this.editor?.cancel(); if (!this.output?.open()) this.status('calibration.blocked',true); });
    this.click('venue-close-output',()=>this.output?.close());
    this.get('venue-pattern').addEventListener('change',()=>this.projection?.setPattern(this.get<HTMLSelectElement>('venue-pattern').value as CalibrationPattern));
    this.get('venue-resolution').addEventListener('change',()=>{
      const [width,height] = this.get<HTMLSelectElement>('venue-resolution').value.split('x').map(Number);
      this.projection?.setSize(width,height); this.projection?.render(); this.output?.update();
    });
    this.get('practice-output').addEventListener('change',()=>{ this.editor?.cancel(); this.selected = this.get<HTMLSelectElement>('practice-output').value; this.update(this.session.changes.get()); });
    this.get('practice-projector-form').addEventListener('change',()=>{
      if (!this.get<HTMLFormElement>('practice-projector-form').reportValidity() || this.input('practice-near').valueAsNumber >= this.input('practice-far').valueAsNumber) { this.status('practice.invalid',true); return; }
      const project = this.session.changes.get();
      this.commit({ ...project, venue: { ...project.venue, projectors: project.venue.projectors.map(p=>p.outputId!==this.selected?p:{...p,
        position:this.vector('practice-p-position'),quaternion:quaternion(this.vector('practice-p-rotation')),verticalFovDegrees:this.input('practice-fov').valueAsNumber,
        aspect:this.input('practice-aspect').valueAsNumber,lensShift:[this.input('practice-shift-0').valueAsNumber/100,this.input('practice-shift-1').valueAsNumber/100],
        near:this.input('practice-near').valueAsNumber,far:this.input('practice-far').valueAsNumber }) } });
    });
    this.click('practice-reset-projector',()=>{
      const project=this.session.changes.get(); this.commit({...project,venue:{...project.venue,projectors:project.venue.projectors.map(p=>p.outputId===this.selected?defaultProjector(this.selected):p)}});
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
  private update(project: Project): void {
    if (this.disposed || !this.preview) return;
    const outputs = project.venue.layout.outputs;
    if (!outputs.some(output=>output.id===this.selected)) this.selected=outputs[0].id;
    const select=this.get<HTMLSelectElement>('practice-output'), options=JSON.stringify(outputs.map(o=>[o.id,o.name]));
    if(select.dataset.options!==options) { select.replaceChildren(...outputs.map((o,i)=>new Option(o.name||`Output ${i+1}`,o.id))); select.dataset.options=options; }
    select.value=this.selected;
    const projector=project.venue.projectors.find(p=>p.outputId===this.selected)!;
    this.preview.setProjector(projector); this.preview.setVenueTransform(project.venue.scene);
    this.setVector('practice-p-position',projector.position); this.setVector('practice-p-rotation',rotation(projector.quaternion));
    this.value('practice-fov',projector.verticalFovDegrees); this.value('practice-aspect',projector.aspect); this.setVector('practice-shift',projector.lensShift.map(v=>v*100));
    this.value('practice-near',projector.near); this.value('practice-far',projector.far);
    const scene=project.venue.scene; this.get('venue-model-transform').hidden=scene.kind==='objects';
    this.setVector('practice-v-position',scene.position); this.setVector('practice-v-rotation',rotation(scene.quaternion)); this.setVector('practice-v-scale',scene.scale);
    this.value('practice-unit',scene.metersPerUnit); this.value('practice-color',scene.color); this.value('venue-name',project.name==='Untitled'?t('practice.untitled'):project.name);
    this.builder?.update(scene,!!this.previous); this.editor?.update(scene,this.builder?.selectedId??'',!!this.previous); this.projection?.render();
  }
  private commit(project: Project, prepared?: PreparedVenue, fit=false): void {
    if (this.disposed || this.failed) { prepared?.dispose(); return; }
    try {
      const next=parseProject({...project,venue:{...project.venue,revision:project.venue.revision+1}});
      this.editor?.cancel(); this.action++; this.previous=this.session.changes.get();
      if(prepared) this.preview!.setVenue(prepared.group,prepared.dispose);
      this.session.update(next);
      if(fit) { this.preview!.overview(); if(next.venue.scene.objects?.length===1) this.editor?.focusSelection(); }
      this.status('calibration.updated');
    } catch(error) { prepared?.dispose(); this.error(error); }
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
    const action=++this.action; this.editor?.cancel(); this.status('practice.busy');
    try {
      const next=parseProject(project), prepared=await prepareVenue(next);
      if(this.disposed || this.failed || action!==this.action) { prepared.dispose(); return; }
      this.commit(next,prepared,true); this.status('calibration.loaded');
    } catch(error) { if(!this.disposed && action===this.action) this.error(error); }
  }
  private undo(): void { if(this.previous) void this.apply(this.previous); }
  private async readFile(model: boolean): Promise<void> {
    const input=this.input(model?'venue-glb-file':'venue-file'), file=input.files?.[0]; input.value=''; if(!file)return;
    const action=++this.action; this.editor?.cancel(); this.status('practice.busy');
    try {
      if(file.size>(model?MAX_GLB_BYTES:MAX_PACKAGE_BYTES)) throw new ProjectFormatError('size');
      if(model) {
        const bytes=await file.arrayBuffer(); if(this.disposed || action!==this.action)return;
        const current=this.session.changes.get(), id=crypto.randomUUID();
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
    const project=this.session.changes.get(), url=URL.createObjectURL(new Blob([JSON.stringify(portableVenue(project),null,2)],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url; link.download=`${project.name.replace(/[^\p{L}\p{N}._-]/gu,'_')}.venue.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  private setReady(): void { this.get('venue-model-stage').parentElement!.inert = false; this.get('venue-objects-pane').closest('aside')!.inert = false; this.get<HTMLButtonElement>('venue-export').disabled = false; }
  private updateOutput(): void { this.get<HTMLButtonElement>('venue-close-output').disabled=!this.output?.isOpen; }
  private resizePreview(): void {
    const rect=this.canvas.parentElement?.getBoundingClientRect(); if(rect?.width && rect.height) this.preview?.resize(Math.round(rect.width),Math.round(rect.height));
  }
  private render=():void=>{
    if(this.disposed || this.failed)return;
    if(!this.get('venue-model-stage').hidden)this.preview?.renderGeometry();
    this.projection?.render(); this.frame=requestAnimationFrame(this.render);
  };
  private status(key: MessageKey,error=false):void { this.statusKey=key;this.errorStatus=error;this.get('venue-status').textContent=t(key);this.get('venue-status').classList.toggle('is-error',error); }
  private error(error:unknown):void { this.status(error instanceof ProjectFormatError?`practice.${error.message}` as MessageKey:'practice.invalid',true); }
  private storageStatus():void { const state=this.session.storage.get(); this.get('venue-storage').textContent=t(state==='error'?'practice.storageError':state==='saving'?'practice.saving':'calibration.saved'); }
  private translate():void { applyControlTranslations(this.root);this.status(this.statusKey,this.errorStatus);this.storageStatus();this.update(this.session.changes.get());this.canvas.setAttribute('aria-label',t('practice.viewHint')); }
  private graphicsLost=(event:Event):void=>{event.preventDefault();this.fail();};
  private fail():void {this.failed=true;this.setReady();this.editor?.cancel();this.output?.close();cancelAnimationFrame(this.frame);this.status('calibration.graphicsError',true);this.get<HTMLButtonElement>('venue-open-output').disabled=true;this.get('venue-reload').hidden=false;}
  destroy():void {
    if(this.disposed)return;this.disposed=true;this.action++;cancelAnimationFrame(this.frame);this.resize?.disconnect();this.off.forEach(off=>off());
    this.canvas.removeEventListener('webglcontextlost',this.graphicsLost);this.projection?.canvas.removeEventListener('webglcontextlost',this.graphicsLost);
    this.output?.dispose();this.editor?.dispose();this.projection?.dispose();this.preview?.dispose();this.session.dispose();this.root.remove();
  }
}
