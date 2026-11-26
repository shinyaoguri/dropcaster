import { ProjectionPreview } from './ProjectionPreview';
import { prepareVenue, type PreparedVenue } from './loadVenue';
import type { Project } from './project';
import type { ProjectSession } from './ProjectSession';
import type { WindowController } from '../components/WindowController';
import type { ControlWindow } from '../windows/control/ControlWindow';
import { applyControlTranslations } from '../windows/control/ControlWindow.template';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import { routeHref } from '../utils/paths';
import { label, button } from './controls';

/** 3D の会場を作る元。これが変わったら会場を作り直す (位置・倍率・色の変更は作り直さない)。 */
interface VenueSource { kind: string; data: string | undefined; objects: string }
function venueSource(project: Project): VenueSource {
  const scene = project.venue.scene;
  return { kind: scene.kind, data: scene.kind === 'glb' ? project.assets.find(a => a.id === scene.assetId)?.data : undefined,
    objects: scene.kind === 'objects' ? JSON.stringify(scene.objects) : '' };
}

/** 3D プレビューとその設定。プロジェクトの操作は ProjectPanel が持ち、ここは session の変更を表示へ映すだけ。 */
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
  /** 作成中または表示中の会場の元。initialize() が最初の会場を作るまでは null。 */
  private venue: VenueSource | null = null;
  private building = false;
  private session: ProjectSession;
  private editor: ControlWindow;
  private status: (key: MessageKey, error?: boolean) => void;
  /** 3D の失敗。会場を作れなかったときはその例外を、状態文を出し済みのとき (context lost) は null を渡す。 */
  private onFailure: (error: unknown) => void;
  private chooseVenueFile: () => void;
  private canvas = document.createElement('canvas');

  constructor(scope: HTMLElement, wc: WindowController, session: ProjectSession, editor: ControlWindow,
    status: (key: MessageKey, error?: boolean) => void, onFailure: (error: unknown) => void, chooseVenueFile: () => void) {
    this.session = session; this.editor = editor; this.status = status; this.onFailure = onFailure; this.chooseVenueFile = chooseVenueFile;
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
      <div class="tool-section"><p class="dc-practice-hint">${label('calibration.previewHint')}</p>
      ${button('practice-load-venue', 'calibration.loadPreview')}<p id="practice-dimensions" class="dc-practice-hint"></p>
      <a class="dc-practice-help" href="${routeHref('/venue')}" target="_blank" rel="noopener noreferrer">${label('calibration.open')}</a></div>`;
    scope.querySelector('#preview-stage')!.append(this.root);
    scope.querySelector('#dc-tool-panel-preview3d')!.append(this.settings);
    this.observer = new ResizeObserver(() => { this.resizePending = true; }); this.observer.observe(this.canvas.parentElement!);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.root.querySelector<HTMLInputElement>('#practice-guides')!.addEventListener('change', event => this.preview.setGuidesVisible((event.target as HTMLInputElement).checked));
    this.wireControls();
    this.off.push(wc.events.stream.subscribe(stream => this.bindStream(stream)), session.changes.subscribe(project => this.update(project)),
      onLangChange(() => this.translate()));
    this.bindStream(wc.events.stream.get()); this.translate();
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

  /** 最初の会場を作る。失敗は呼び出し側 (MappingWorkspace) が 3D の失敗として扱う。 */
  async initialize(): Promise<void> {
    await this.buildVenue(this.session.changes.get());
  }
  /**
   * `project` の会場を作って差し替える。作っている間に session が進んだら、終わりの update() が次の会場を作り直す。
   * 後から始めた構築に追い越されたら false を返す。
   */
  private async buildVenue(project: Project): Promise<boolean> {
    const action = ++this.action; this.venue = venueSource(project);
    // 作っている間は前の会場と前の配置のまま見せ、できあがってからまとめて切り替える。
    this.building = true; this.root.setAttribute('aria-busy', 'true');
    let prepared: PreparedVenue;
    try { prepared = await prepareVenue(project); } catch (error) {
      if (this.disposed || action !== this.action) return false;
      throw error;
    }
    if (this.disposed || action !== this.action) { prepared.dispose(); return false; }
    this.preview.setVenue(prepared.group, prepared.dispose); this.venueKey = ''; this.opticsKey = '';
    this.building = false; this.root.removeAttribute('aria-busy');
    this.update(this.session.changes.get());
    return true;
  }
  /**
   * 取り込み・保存済みを開く・取り込み前に戻すで会場が変わったあとの作り直し。取り込みは検証だけで確定しているので、
   * ここで失敗しても取り消さず、3D の失敗として知らせる (ADR 0010)。2D 編集とプロジェクトの操作は続けられる。
   */
  private async rebuildVenue(project: Project): Promise<void> {
    try {
      if (await this.buildVenue(project)) this.preview.overview();
    } catch (error) {
      if (!this.disposed) this.onFailure(error);
    }
  }
  private get<T extends HTMLElement = HTMLInputElement>(id: string): T { return this.settings.querySelector<T>(`#${id}`)!; }
  private val(id: string): number { return this.get<HTMLInputElement>(id).valueAsNumber; }
  private translate(): void {
    applyControlTranslations(this.root); applyControlTranslations(this.settings);
    this.update(this.session.changes.get());
    this.canvas.setAttribute('aria-label', t('practice.viewHint'));
    this.settings.querySelectorAll('fieldset').forEach(group => {
      const text = group.querySelector('legend')?.textContent;
      group.querySelectorAll('input').forEach(input => input.setAttribute('aria-label', `${text} ${input.parentElement?.firstChild?.textContent}`));
    });
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
    const source = venueSource(project);
    if (this.venue && (this.venue.kind !== source.kind || this.venue.data !== source.data || this.venue.objects !== source.objects)) {
      void this.rebuildVenue(project);
    }
    if (this.building) return;
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
    this.preview.setOtherProjectors(project.venue.projectors.filter(p => p.outputId !== this.selected));
    if (this.venueKey !== venueKey) { this.preview.setVenueTransform(project.venue.scene); this.venueKey = venueKey; }
    this.preview.setState(layout, this.selected);
    if (backgroundChanged) this.background = this.preview.backgroundImage();
    this.showBackground();
    this.get('practice-dimensions').textContent = t('practice.dimensions', { size: this.preview.venueDimensions().map(n => n.toFixed(2)).join(' × ') });
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
    click('practice-load-venue', () => this.chooseVenueFile());
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.status('practice.contextLost', true); this.onFailure(null); };
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.action++;
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.off.forEach(off => off());
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.editor.setPracticeBackground(this.selected, null); this.preview.dispose();
    this.video.pause(); this.video.srcObject = null; this.root.remove(); this.settings.remove();
    // WindowController owns the borrowed stream and all of its tracks.
  }
}
