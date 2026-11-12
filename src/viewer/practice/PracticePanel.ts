import { ProjectionPreview } from './ProjectionPreview';
import { prepareVenue, prepareObjects } from './loadVenue';
import { defaultProjector, defaultScene, encodeAsset, parseProject, portableProject, portableVenue, importVenue, ProjectFormatError,
  MAX_GLB_BYTES, MAX_PACKAGE_BYTES, type Project, type Vec3, type VenueScene } from './project';
import { listProjects, readProject } from './projectStore';
import type { ProjectSession } from './ProjectSession';
import type { WindowController } from '../components/WindowController';
import type { ControlWindow } from '../windows/control/ControlWindow';
import { applyControlTranslations } from '../windows/control/ControlWindow.template';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import { routeHref } from '../utils/paths';
import { label, button, field, vectorFields, rotation, quaternion } from './controls';
import { VenueBuilder } from './VenueBuilder';

export class PracticePanel {
  readonly preview: ProjectionPreview;
  private root = document.createElement('section');
  private settings = document.createElement('div');
  private video = document.createElement('video');
  private frame = 0;
  private visible = false;
  private observer: ResizeObserver;
  private resizePending = true;
  private off: (() => void)[] = [];
  private disposed = false;
  private action = 0;
  private selected: string;
  private background = '';
  private opticsKey = '';
  private venueKey = '';
  private previous: Project | null = null;
  private previousMode: 'project' | 'venue' | 'model' = 'project';
  private session: ProjectSession;
  private editor: ControlWindow;
  private status: (key: MessageKey, error?: boolean) => void;
  private onFailure: () => void;
  private canvas = document.createElement('canvas');
  private builder: VenueBuilder;

  constructor(scope: HTMLElement, wc: WindowController, session: ProjectSession, editor: ControlWindow,
    status: (key: MessageKey, error?: boolean) => void, onFailure: () => void) {
    this.session = session; this.editor = editor; this.status = status; this.onFailure = onFailure;
    const state = session.changes.get().venue.layout;
    this.selected = state.activeOutputId ?? state.outputs[0].id;
    this.video.muted = true; this.video.playsInline = true;
    this.preview = new ProjectionPreview(this.canvas, this.video); this.preview.setGuidesVisible(true);
    this.root.className = 'dc-practice-panel';
    this.canvas.id = 'dc-practice-canvas'; this.canvas.tabIndex = 0;
    this.root.innerHTML = `<div class="column-header"><h2>${label('practice.previewTitle')}</h2><div class="dc-practice-view-actions">
      ${button('practice-overview', 'practice.overview')}${button('practice-audience', 'practice.audience')}
      ${button('practice-projector-view', 'practice.projectorView')}${button('practice-reset-view', 'practice.resetView')}</div></div>
      <div class="dc-practice-guide-row"><label class="dc-practice-check"><input id="practice-guides" type="checkbox" checked>${label('practice.guides')}</label><span class="dc-practice-hint">${label('practice.guideHint')}</span></div>
      <p class="dc-practice-hint">${label('practice.viewHint')}</p><div class="dc-practice-viewport"></div>`;
    this.root.querySelector('.dc-practice-viewport')!.append(this.canvas);
    this.settings.className = 'dc-practice-settings';
    this.settings.id = 'dc-practice-settings';
    this.settings.innerHTML = `<div class="tool-section">
      <label class="dc-practice-field">${label('practice.output')}<select id="practice-output"></select></label>
      <label class="dc-practice-field">${label('practice.quality')}<select id="practice-quality"><option>320</option><option selected>640</option><option>960</option></select></label>
      <label class="dc-practice-check"><input id="practice-background" type="checkbox" checked>${label('practice.background')}</label>
      <label class="dc-practice-field">${label('practice.blend')}<input id="practice-blend" type="range" min="0.1" max="1" step="0.05" value="0.65"></label>
      <p class="dc-practice-hint">${label('practice.geometryHint')}</p></div>
      <details class="tool-section" open><summary>${label('practice.projector')}</summary><form id="practice-projector-form">
      ${vectorFields('practice-p-position', 'practice.position')}${vectorFields('practice-p-rotation', 'practice.rotation', -360, 360, 0.1)}
      ${field('practice-fov', 'practice.fov', 1, 170)}${field('practice-aspect', 'practice.aspect', 0.2, 5, 0.0001)}
      ${vectorFields('practice-shift', 'practice.shift', -200, 200, 0.1, ['X', 'Y'])}
      ${field('practice-near', 'practice.near', 0.001, 1000, 0.001)}${field('practice-far', 'practice.far', 0.002, 10000, 0.001)}
      ${button('practice-reset-projector', 'practice.resetProjector')}</form></details>
      <details class="tool-section"><summary>${label('practice.venue')}</summary>
      ${button('practice-sample', 'practice.sample')}${button('practice-load-glb', 'practice.loadGlb')}
      <input id="practice-glb-file" type="file" accept=".glb,model/gltf-binary" hidden>
      <p id="practice-dimensions" class="dc-practice-hint"></p><form id="practice-venue-form">
      ${field('practice-unit', 'practice.unit', 0.00001, 10000, 0.00001)}
      ${vectorFields('practice-v-position', 'practice.position')}${vectorFields('practice-v-rotation', 'practice.rotation', -360, 360, 0.1)}
      ${vectorFields('practice-v-scale', 'practice.scale', 0.0001, 1000, 0.0001)}
      <label class="dc-practice-field">${label('practice.color')}<input id="practice-color" type="color"></label></form></details>
      <details id="dc-practice-project" class="tool-section"><summary>${label('practice.project')}</summary>
      <label class="dc-practice-field">${label('practice.projectName')}<input id="practice-project-name" maxlength="200" required></label>
      ${button('practice-save', 'practice.save')}${button('practice-duplicate', 'practice.duplicate')}
      <p id="practice-storage" class="dc-practice-hint" role="status"></p>
      <label class="dc-practice-field">${label('practice.savedProjects')}<select id="practice-saved-projects"></select></label>
      ${button('practice-open-project', 'practice.openProject')}${button('practice-export', 'practice.export')}${button('practice-import', 'practice.import')}
      ${button('practice-export-venue', 'practice.exportVenue')}<p class="dc-practice-hint">${label('practice.shareVenueHint')}</p>
      <input id="practice-project-file" type="file" accept=".json,application/json" hidden>
      ${button('practice-undo-import', 'practice.undoImport')}
      <h3>${label('practice.content')}</h3><ul id="practice-content-list"></ul>
      <p class="dc-practice-hint">${label('practice.referencesOnly')}</p>${button('practice-open-content', 'practice.openContent')}</details>`;
    this.builder = new VenueBuilder((scene, fit) => this.editVenue(scene, fit), () => {
      if (this.previous && this.previousMode === 'model') void this.apply(this.previous, false);
    });
    this.settings.prepend(this.builder.element);
    scope.querySelector('#preview-stage')!.append(this.root);
    scope.querySelector('.tool-content')!.append(this.settings);
    this.observer = new ResizeObserver(() => { this.resizePending = true; }); this.observer.observe(this.canvas.parentElement!);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.root.querySelector<HTMLInputElement>('#practice-guides')!.addEventListener('change', event => this.preview.setGuidesVisible((event.target as HTMLInputElement).checked));
    this.wireControls();
    this.off.push(wc.events.stream.subscribe(stream => this.bindStream(stream)), session.changes.subscribe(project => this.update(project)),
      session.storage.subscribe(() => this.storageStatus()), onLangChange(() => this.translate()));
    this.bindStream(wc.events.stream.get()); this.translate();
    void this.refreshSaved();
  }

  setVisible(visible: boolean): void {
    this.visible = visible; cancelAnimationFrame(this.frame); this.frame = 0;
    if (!visible || this.disposed) return;
    this.resizePending = true; this.frame = requestAnimationFrame(this.render);
  }
  private render = (): void => {
    if (this.disposed || !this.visible) return;
    if (this.resizePending) { this.resizePending = false; this.resize(); }
    this.preview.setProjectionEnabled(this.video.readyState >= 2 && !!this.video.srcObject);
    this.preview.render(); this.frame = requestAnimationFrame(this.render);
  };

  async initialize(): Promise<void> {
    const action = ++this.action;
    const prepared = await prepareVenue(this.session.changes.get());
    if (this.disposed || action !== this.action) { prepared.dispose(); return; }
    this.preview.setVenue(prepared.group, prepared.dispose); this.venueKey = '';
    this.update(this.session.changes.get());
  }
  private get<T extends HTMLElement = HTMLInputElement>(id: string): T { return this.settings.querySelector(`#${id}`)!; }
  private val(id: string): number { return this.get<HTMLInputElement>(id).valueAsNumber; }
  private vec(id: string): Vec3 { return [0, 1, 2].map(i => this.val(`${id}-${i}`)) as Vec3; }
  private value(id: string, value: string | number): void {
    const input = this.get<HTMLInputElement>(id);
    if (document.activeElement !== input) input.value = typeof value === 'number' ? String(Number(value.toFixed(5))) : value;
  }
  private setVec(id: string, values: number[]): void { values.forEach((v, i) => this.value(`${id}-${i}`, v)); }
  private translate(): void {
    applyControlTranslations(this.root); applyControlTranslations(this.settings);
    this.update(this.session.changes.get()); this.storageStatus();
    this.canvas.setAttribute('aria-label', t('practice.viewHint'));
    this.settings.querySelectorAll('fieldset').forEach(group => {
      const text = group.querySelector('legend')?.textContent;
      group.querySelectorAll('input').forEach(input => input.setAttribute('aria-label', `${text} ${input.parentElement?.firstChild?.textContent}`));
    });
  }
  private storageStatus(): void {
    const state = this.session.storage.get();
    this.get('practice-storage').textContent = t(state === 'error' ? 'practice.storageError' : state === 'saving' ? 'practice.saving' : 'practice.saved');
  }
  private resize(): void {
    if (this.disposed) return;
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.preview.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
  }
  private bindStream(stream: MediaStream | null): void {
    this.video.pause(); this.video.srcObject = stream;
    this.preview.compositor.replaceVideo(this.video);
    if (stream) void this.video.play().catch(() => { /* capture may be replaced again */ });
  }
  private update(project: Project): void {
    if (this.disposed) return;
    const layout = project.venue.layout;
    if (!layout.outputs.some(o => o.id === this.selected)) this.selected = layout.outputs[0].id;
    const select = this.get<HTMLSelectElement>('practice-output');
    const options = layout.outputs.map((o, i) => [o.id, o.name || `Output ${i + 1}`]);
    if (JSON.stringify(options) !== select.dataset.options) {
      select.replaceChildren(...options.map(([value, text]) => new Option(text, value)));
      select.dataset.options = JSON.stringify(options);
    }
    select.value = this.selected;
    const projector = project.venue.projectors.find(p => p.outputId === this.selected)!;
    const opticsKey = JSON.stringify(projector), venueKey = JSON.stringify(project.venue.scene);
    const backgroundChanged = this.opticsKey !== opticsKey || this.venueKey !== venueKey;
    if (this.opticsKey !== opticsKey) { this.preview.setProjector(projector); this.opticsKey = opticsKey; }
    if (this.venueKey !== venueKey) { this.preview.setVenueTransform(project.venue.scene); this.venueKey = venueKey; }
    this.preview.setState(layout, this.selected);
    if (backgroundChanged) this.background = this.preview.backgroundImage();
    this.showBackground();
    this.setVec('practice-p-position', projector.position); this.setVec('practice-p-rotation', rotation(projector.quaternion));
    this.value('practice-fov', projector.verticalFovDegrees); this.value('practice-aspect', projector.aspect);
    this.setVec('practice-shift', projector.lensShift.map(v => v * 100));
    this.value('practice-near', projector.near); this.value('practice-far', projector.far);
    const scene = project.venue.scene;
    this.builder.update(scene, !!this.previous && this.previousMode === 'model');
    this.get('practice-venue-form').hidden = scene.kind === 'objects';
    this.setVec('practice-v-position', scene.position); this.setVec('practice-v-rotation', rotation(scene.quaternion));
    this.setVec('practice-v-scale', scene.scale); this.value('practice-unit', scene.metersPerUnit); this.value('practice-color', scene.color);
    this.get('practice-dimensions').textContent = t('practice.dimensions', { size: this.preview.venueDimensions().map(n => n.toFixed(2)).join(' × ') });
    this.value('practice-project-name', project.name === 'Untitled' ? t('practice.untitled') : project.name);
    const contents = this.get('practice-content-list');
    const text = project.show.contentIds.map(id => project.content.find(c => c.id === id)?.title ?? id).join('\n');
    if (contents.dataset.content !== text) {
      contents.replaceChildren(...text.split('\n').filter(Boolean).map(title => { const li = document.createElement('li'); li.textContent = title; return li; }));
      contents.dataset.content = text;
    }
    this.get<HTMLButtonElement>('practice-open-content').disabled = !project.content.length;
    this.get<HTMLButtonElement>('practice-undo-import').disabled = !this.previous;
  }
  private showBackground(): void {
    this.editor.setPracticeBackground(this.selected, this.get<HTMLInputElement>('practice-background').checked ? this.background : null, this.val('practice-blend'));
  }
  private wireControls(): void {
    const click = (id: string, run: () => void) => this.get(id).addEventListener('click', run);
    for (const [id, run] of [['practice-overview', () => this.preview.overview()], ['practice-audience', () => this.preview.audienceView()],
      ['practice-projector-view', () => this.preview.projectorView()], ['practice-reset-view', () => this.preview.overview()]] as const) this.root.querySelector(`#${id}`)!.addEventListener('click', run);
    this.get('practice-output').addEventListener('change', () => { this.selected = this.get<HTMLSelectElement>('practice-output').value; this.update(this.session.changes.get()); });
    this.get('practice-quality').addEventListener('change', () => {
      this.preview.setPreviewWidth(Number(this.get<HTMLSelectElement>('practice-quality').value));
      this.background = this.preview.backgroundImage(); this.showBackground();
    });
    this.get('practice-background').addEventListener('change', () => this.showBackground());
    this.get('practice-blend').addEventListener('input', () => this.showBackground());
    for (const id of ['practice-projector-form', 'practice-venue-form']) this.get(id).addEventListener('submit', e => e.preventDefault());
    this.get('practice-projector-form').addEventListener('change', () => {
      if (!this.get<HTMLFormElement>('practice-projector-form').reportValidity() || this.val('practice-far') <= this.val('practice-near')) { this.status('practice.invalid', true); return; }
      const project = this.session.changes.get();
      this.session.update({ ...project, venue: { ...project.venue, revision: project.venue.revision + 1,
        projectors: project.venue.projectors.map(p => p.outputId !== this.selected ? p : { ...p, position: this.vec('practice-p-position'), quaternion: quaternion(this.vec('practice-p-rotation')),
          verticalFovDegrees: this.val('practice-fov'), aspect: this.val('practice-aspect'), lensShift: [this.val('practice-shift-0') / 100, this.val('practice-shift-1') / 100],
          near: this.val('practice-near'), far: this.val('practice-far') }) } });
    });
    this.get('practice-venue-form').addEventListener('change', () => {
      if (!this.get<HTMLFormElement>('practice-venue-form').reportValidity()) return;
      const project = this.session.changes.get();
      this.session.update({ ...project, venue: { ...project.venue, revision: project.venue.revision + 1, scene: { ...project.venue.scene,
        position: this.vec('practice-v-position'), quaternion: quaternion(this.vec('practice-v-rotation')), scale: this.vec('practice-v-scale'),
        metersPerUnit: this.val('practice-unit'), color: this.get<HTMLInputElement>('practice-color').value } } });
    });
    click('practice-reset-projector', () => {
      const project = this.session.changes.get();
      this.session.update({ ...project, venue: { ...project.venue, projectors: project.venue.projectors.map(p => p.outputId === this.selected ? defaultProjector(this.selected) : p) } });
    });
    click('practice-sample', () => {
      const project = this.session.changes.get();
      void this.apply({ ...project, assets: [], venue: { ...project.venue, scene: defaultScene(), revision: project.venue.revision + 1 } }, false);
    });
    click('practice-load-glb', () => this.get<HTMLInputElement>('practice-glb-file').click());
    this.get('practice-glb-file').addEventListener('change', () => void this.readFile(true));
    click('practice-import', () => this.get<HTMLInputElement>('practice-project-file').click());
    this.get('practice-project-file').addEventListener('change', () => void this.readFile(false));
    this.get('practice-project-name').addEventListener('change', () => {
      const name = this.get<HTMLInputElement>('practice-project-name').value.trim();
      if (name) this.session.update({ ...this.session.changes.get(), name });
    });
    click('practice-save', () => void this.saveNamed(false));
    click('practice-duplicate', () => void this.saveNamed(true));
    click('practice-open-project', () => void this.openSaved());
    click('practice-export', () => this.export());
    click('practice-export-venue', () => this.export(true));
    click('practice-undo-import', () => {
      if (this.previous) void this.apply(this.previous, this.previousMode !== 'model', this.previousMode === 'venue');
    });
    click('practice-open-content', () => void this.openContent());
  }
  private error(error: unknown): void {
    const codes = ['invalid', 'version', 'asset', 'reference', 'externalAsset', 'unsupportedAsset', 'size'];
    this.status(error instanceof ProjectFormatError && codes.includes(error.message) ? `practice.${error.message}` as MessageKey : 'practice.invalid', true);
  }
  private async readFile(model: boolean): Promise<void> {
    const input = this.get<HTMLInputElement>(model ? 'practice-glb-file' : 'practice-project-file'), file = input.files?.[0];
    input.value = ''; if (!file) return;
    const action = ++this.action;
    try {
      if (file.size > (model ? MAX_GLB_BYTES : MAX_PACKAGE_BYTES)) throw new ProjectFormatError('size');
      if (model) {
        const project = this.session.changes.get(), id = crypto.randomUUID();
        const bytes = await file.arrayBuffer();
        if (this.disposed || action !== this.action) return;
        const asset = { id, name: file.name, mimeType: 'model/gltf-binary' as const, data: encodeAsset(new Uint8Array(bytes)) };
        const next = parseProject({ ...project, assets: [asset], venue: { ...project.venue, revision: project.venue.revision + 1, scene: { ...defaultScene(), kind: 'glb', assetId: id } } });
        await this.apply(next, false);
      } else {
        const text = await file.text();
        if (this.disposed || action !== this.action) return;
        const value = JSON.parse(text);
        if (value?.format === 'dropcaster-venue') await this.apply(importVenue(value, this.session.changes.get()), true, true);
        else await this.apply(parseProject(value));
      }
    } catch (error) { if (!this.disposed && action === this.action) this.error(error); }
  }
  private async apply(project: Project, layout = true, venueOnly = false): Promise<void> {
    if (this.disposed) return;
    const action = ++this.action; this.status('practice.busy');
    try {
      const prepared = await prepareVenue(project);
      if (this.disposed || action !== this.action) { prepared.dispose(); return; }
      this.previous = this.session.changes.get();
      this.previousMode = venueOnly ? 'venue' : layout ? 'project' : 'model';
      // A slideshow may have advanced while the venue asset was being decoded.
      if (venueOnly) project = { ...this.previous, venue: project.venue, assets: project.assets };
      if (!layout) project = { ...this.previous, assets: project.assets, venue: { ...this.previous.venue,
        revision: this.previous.venue.revision + 1, scene: project.venue.scene } };
      this.preview.setVenue(prepared.group, prepared.dispose); this.venueKey = ''; this.opticsKey = '';
      this.session.update(project, layout, !venueOnly);
      this.preview.overview(); this.status(venueOnly ? 'practice.venueImported' : layout ? 'practice.imported' : 'practice.modelLoaded');
    } catch (error) { if (!this.disposed && action === this.action) this.error(error); }
  }
  private editVenue(scene: VenueScene, fit: boolean): void {
    if (this.disposed) return;
    const current = this.session.changes.get();
    try {
      const next = parseProject({ ...current, assets: [], venue: { ...current.venue, revision: current.venue.revision + 1, scene } });
      const prepared = prepareObjects(next.venue.scene.objects!);
      this.action++; this.previous = current; this.previousMode = 'model';
      this.preview.setVenue(prepared.group, prepared.dispose); this.venueKey = '';
      this.session.update(next); if (fit) this.preview.overview(); this.status('practice.venueEdited');
    } catch (error) { this.error(error); }
  }
  private async refreshSaved(): Promise<void> {
    try {
      const projects = await listProjects(); if (this.disposed) return;
      this.get<HTMLSelectElement>('practice-saved-projects').replaceChildren(...projects.map(p => new Option(p.name, p.id)));
      this.get<HTMLButtonElement>('practice-open-project').disabled = projects.length === 0;
    } catch { if (!this.disposed) this.session.storage.set('error'); }
  }
  private async saveNamed(copy: boolean): Promise<void> {
    try {
      if (copy) this.session.update({ ...this.session.changes.get(), id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      await this.session.save(true); await this.refreshSaved();
    } catch { this.status('practice.storageError', true); }
  }
  private async openSaved(): Promise<void> {
    const action = ++this.action;
    try {
      const project = await readProject(this.get<HTMLSelectElement>('practice-saved-projects').value);
      if (project && !this.disposed && action === this.action) await this.apply(parseProject(project));
    } catch (error) { if (!this.disposed && action === this.action) this.error(error); }
  }
  private export(venueOnly = false): void {
    const project = this.session.changes.get();
    const url = URL.createObjectURL(new Blob([JSON.stringify(venueOnly ? portableVenue(project) : portableProject(project), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.${venueOnly ? 'venue' : 'dropcaster'}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private async openContent(): Promise<void> {
    await this.session.save(); if (this.disposed || this.session.storage.get() === 'error') { this.status('practice.storageError', true); return; }
    // App resolves references before replacing the running view. Opening a project never opens outputs.
    const link = document.createElement('a'); link.href = routeHref('/project'); document.body.append(link); link.click(); link.remove();
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.status('practice.contextLost', true); this.onFailure(); };
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.action++;
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.off.forEach(off => off());
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.editor.setPracticeBackground(this.selected, null); this.preview.dispose();
    this.video.pause(); this.video.srcObject = null; this.root.remove(); this.settings.remove();
    // WindowController owns the borrowed stream and all of its tracks.
  }
}
