import type { WindowController } from '../components/WindowController';
import type { ControlWindow } from '../windows/control/ControlWindow';
import type { SketchFrame } from '../runtime/SketchFrame';
import type { PracticePanel } from './PracticePanel';
import { ProjectSession, type ShowContext } from './ProjectSession';
import { installPracticeStyles } from './style';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import type { Project } from './project';
import { applyControlTranslations } from '../windows/control/ControlWindow.template';

export interface MappingWorkspaceOptions {
  wc: WindowController; getFrame: () => SketchFrame | null;
  mountEditor: () => ControlWindow | null; unmountEditor: () => void; getContext: () => ShowContext;
}
/** The editor owns a stream consumer independently of real outputs and the optional 3D tab. */
export class MappingWorkspace {
  private options: MappingWorkspaceOptions;
  private session: ProjectSession | null = null;
  private panel: PracticePanel | null = null;
  private pendingPanel: Promise<void> | null = null;
  private editor: ControlWindow | null = null;
  private toolbar: HTMLElement | null = null;
  private scope: HTMLElement | null = null;
  private release: (() => void) | null = null;
  private offTab: (() => void) | null = null;
  private generation = 0;
  private off: (() => void)[] = [];
  private active = false;
  private statusKey: MessageKey = 'practice.waiting';
  private error = false;
  private disposed = false;
  private closeMenuOutside = (event: PointerEvent): void => {
    const menu = this.toolbar?.querySelector<HTMLDetailsElement>('#practice-menu');
    if (menu && !menu.contains(event.target as Node)) menu.open = false;
  };

  constructor(options: MappingWorkspaceOptions) {
    this.options = options; installPracticeStyles();
    this.off.push(onLangChange(() => this.translate()), options.wc.events.streaming.subscribe(active => {
      if (!active && this.active) this.stop();
    }), options.wc.events.stream.subscribe(stream => {
      if (!this.active) return;
      if (stream && this.statusKey === 'practice.waiting') this.status('practice.ready');
      else if (!stream && this.statusKey === 'practice.ready') this.status('practice.waiting');
    }));
  }
  get isActive(): boolean { return this.active; }
  toggle(): void { if (this.active) this.stop(); else void this.start(); }
  updateContent(): void { this.session?.updateContent(); }
  async openProject(project: Project): Promise<void> {
    if (this.disposed) return;
    this.session ??= new ProjectSession(this.options.wc, this.options.getContext);
    await this.session.ready;
    if (this.disposed) return;
    this.session.update(project, true); this.session.followCurrentContent();
    await this.start();
    await this.ensurePanel(); // Explicitly opening a saved venue prepares its fixed editing background.
  }

  async start(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true; ++this.generation;
    this.release = this.options.wc.acquireStreamConsumer();
    const editor = this.options.mountEditor();
    this.scope = document.querySelector('#dc-inline-editor .dc-control-shell');
    if (!editor || !this.scope) { this.stop(); return; }
    this.editor = editor;
    this.scope.classList.add('dc-mapping-workspace');
    this.toolbar = document.createElement('header'); this.toolbar.className = 'dc-practice-toolbar';
    this.toolbar.innerHTML = `<strong data-i18n="practice.title"></strong><span id="dc-practice-status" role="status" aria-live="polite"></span>
      <button type="button" id="practice-retry" data-i18n="practice.retry" hidden></button>
      <details id="practice-menu" class="dc-workspace-menu"><summary>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6m-6 0v6"/></svg><span data-i18n="practice.menu"></span>
      </summary><div class="dc-workspace-menu-items">
        <button type="button" id="practice-settings" data-i18n="practice.settings"></button>
        <button type="button" id="practice-venue" data-i18n="practice.buildVenue"></button>
        <button type="button" id="practice-project" data-i18n="practice.project"></button>
      </div></details>
      <button type="button" id="practice-stop" class="dc-workspace-close" data-i18n-title="practice.stop" data-i18n-aria-label="practice.stop"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
    this.scope.prepend(this.toolbar);
    const menu = this.toolbar.querySelector<HTMLDetailsElement>('#practice-menu')!;
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary')!.focus();
    });
    document.addEventListener('pointerdown', this.closeMenuOutside);
    this.toolbar.querySelector('#practice-stop')!.addEventListener('click', () => this.stop());
    this.toolbar.querySelector('#practice-retry')!.addEventListener('click', () => {
      editor.selectTab('preview'); void this.ensurePanel();
    });
    for (const [button, id] of [['practice-settings', 'dc-practice-settings'], ['practice-venue', 'dc-practice-venue'], ['practice-project', 'dc-practice-project']]) {
      this.toolbar.querySelector(`#${button}`)!.addEventListener('click', async () => {
        menu.open = false;
        const generation = this.generation;
        if (button === 'practice-venue') editor.selectTab('preview');
        await this.ensurePanel();
        if (!this.active || generation !== this.generation) return;
        const element = this.scope?.querySelector<HTMLElement>(`#${id}`);
        if (element instanceof HTMLDetailsElement) element.open = true;
        element?.scrollIntoView({ block: 'start' });
        element?.querySelector<HTMLElement>('summary, input, select')?.focus({ preventScroll: true });
      });
    }
    this.offTab = editor.onTabChange(tab => {
      this.panel?.setVisible(tab === 'preview');
      if (tab === 'preview') void this.ensurePanel();
    });
    this.session ??= new ProjectSession(this.options.wc, this.options.getContext);
    this.status(this.options.wc.events.stream.get() ? 'practice.ready' : 'practice.waiting'); this.translate();
    void this.connectSource();
  }

  private async connectSource(): Promise<void> {
    const generation = this.generation;
    while (this.active && !this.disposed) {
      const frame = this.options.getFrame();
      if (!frame) { this.status('practice.waiting'); return; }
      await frame.ready;
      if (!this.active || this.disposed || generation !== this.generation) return;
      if (frame !== this.options.getFrame()) continue;
      await this.options.wc.startCanvasStreaming(frame.iframe);
      return;
    }
  }

  private ensurePanel(): Promise<void> {
    if (!this.active || this.disposed) return Promise.resolve();
    if (this.pendingPanel) return this.pendingPanel;
    if (this.panel) return Promise.resolve();
    const generation = this.generation;
    const pending = this.loadPanel(generation).finally(() => { if (this.pendingPanel === pending) this.pendingPanel = null; });
    this.pendingPanel = pending;
    return pending;
  }
  private async loadPanel(generation: number): Promise<void> {
    this.status('practice.loading'); this.toolbar?.querySelector('#practice-retry')?.setAttribute('hidden', '');
    try {
      const [{ PracticePanel }] = await Promise.all([import('./PracticePanel'), this.session!.ready]);
      if (!this.active || this.disposed || generation !== this.generation || !this.scope || !this.editor) return;
      const panel = new PracticePanel(this.scope, this.options.wc, this.session!, this.editor,
        (key, error) => this.status(key, error), () => this.previewFailed());
      this.panel = panel;
      await panel.initialize();
      if (!this.active || generation !== this.generation || this.panel !== panel) { panel.dispose(); return; }
      panel.setVisible(this.editor.selectedTab === 'preview');
      this.status(this.options.wc.events.stream.get() ? 'practice.ready' : 'practice.waiting');
    } catch {
      if (!this.active || this.disposed || generation !== this.generation) return;
      this.status('practice.error', true); this.previewFailed();
    }
  }
  private previewFailed(): void {
    this.panel?.dispose(); this.panel = null;
    this.toolbar?.querySelector('#practice-retry')?.removeAttribute('hidden');
    this.editor?.selectTab('mapping');
  }
  private status(key: MessageKey, error = false): void {
    this.statusKey = key; this.error = error;
    const element = this.toolbar?.querySelector('#dc-practice-status');
    if (element) { element.textContent = t(key); element.classList.toggle('is-error', error); }
  }
  private translate(): void {
    if (this.toolbar) applyControlTranslations(this.toolbar);
    this.status(this.statusKey, this.error);
  }
  stop(): void {
    if (!this.active) return;
    this.active = false; this.generation++; this.pendingPanel = null;
    document.removeEventListener('pointerdown', this.closeMenuOutside);
    this.offTab?.(); this.offTab = null;
    this.panel?.dispose(); this.panel = null; this.editor = null;
    this.toolbar?.remove(); this.toolbar = null;
    this.scope?.classList.remove('dc-mapping-workspace'); this.scope = null;
    this.options.unmountEditor();
    const release = this.release; this.release = null; release?.();
  }
  dispose(): void {
    this.disposed = true; this.stop(); this.off.forEach(off => off()); this.session?.dispose();
  }
}
