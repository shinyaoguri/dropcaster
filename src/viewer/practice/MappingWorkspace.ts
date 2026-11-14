import type { WindowController } from '../components/WindowController';
import type { ControlWindow } from '../windows/control/ControlWindow';
import type { SketchFrame } from '../runtime/SketchFrame';
import type { PracticePanel } from './PracticePanel';
import { ProjectSession, type ShowContext } from './ProjectSession';
import { installPracticeStyles } from './style';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import { routeHref } from '../utils/paths';
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
  /** ツールカラムの見出し行に差し込む「設定・共有」と閉じる。 */
  private toolbar: HTMLElement | null = null;
  /** ツール見出しの直下に差し込む状態文と再試行。 */
  private notice: HTMLElement | null = null;
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
    // 専用の上部バーは作業領域を削るので持たない。操作はツールカラムの見出し行に、
    // 状態文と再試行はその直下に置き、エラー時だけ見せる。
    const toolHeader = this.scope.querySelector<HTMLElement>('.tool-column > .column-header');
    if (!toolHeader) { this.stop(); return; }
    this.notice = document.createElement('div'); this.notice.className = 'dc-workspace-notice';
    this.notice.innerHTML = `<span id="dc-practice-status" role="status" aria-live="polite"></span>
      <button type="button" id="practice-retry" class="tool-button" data-i18n="practice.retry" hidden></button>`;
    toolHeader.after(this.notice);
    this.toolbar = document.createElement('div'); this.toolbar.className = 'dc-workspace-actions';
    this.toolbar.innerHTML = `<details id="practice-menu" class="dc-workspace-menu"><summary>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6m-6 0v6"/></svg><span data-i18n="practice.menu"></span>
      </summary><div class="dc-workspace-menu-items">
        <button type="button" id="practice-settings" data-i18n="calibration.previewSettings"></button>
        <a id="practice-venue" href="${routeHref('/venue')}" target="_blank" rel="noopener noreferrer" data-i18n="calibration.open"></a>
        <button type="button" id="practice-project" data-i18n="practice.storage"></button>
      </div></details>
      <button type="button" id="practice-stop" class="dc-workspace-close" data-i18n-title="practice.stop" data-i18n-aria-label="practice.stop"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
    toolHeader.append(this.toolbar);
    const menu = this.toolbar.querySelector<HTMLDetailsElement>('#practice-menu')!;
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary')!.focus();
    });
    document.addEventListener('pointerdown', this.closeMenuOutside);
    this.toolbar.querySelector('#practice-stop')!.addEventListener('click', () => this.stop());
    this.notice.querySelector('#practice-retry')!.addEventListener('click', () => {
      editor.selectTab('preview'); void this.ensurePanel();
    });
    for (const [button, id] of [['practice-settings', 'dc-practice-settings'], ['practice-project', 'dc-practice-project']]) {
      this.toolbar.querySelector(`#${button}`)!.addEventListener('click', async () => {
        menu.open = false;
        const generation = this.generation;
        await this.ensurePanel();
        if (!this.active || generation !== this.generation) return;
        const element = this.scope?.querySelector<HTMLElement>(`#${id}`);
        if (element instanceof HTMLDetailsElement) element.open = true;
        element?.scrollIntoView({ block: 'start' });
        if (element) { element.tabIndex = -1; element.focus({ preventScroll: true }); }
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
    this.status('practice.loading'); this.setRetry(false);
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
    this.setRetry(true);
    this.editor?.selectTab('mapping');
  }
  private setRetry(visible: boolean): void {
    this.notice?.querySelector('#practice-retry')?.toggleAttribute('hidden', !visible);
    this.updateNotice();
  }
  private status(key: MessageKey, error = false): void {
    this.statusKey = key; this.error = error;
    const element = this.notice?.querySelector('#dc-practice-status');
    if (element) { element.textContent = t(key); element.classList.toggle('is-error', error); }
    this.updateNotice();
  }
  /** 平常時の状態文は読み上げ用に残して見た目からは外し、エラーと再試行があるときだけ見せる。 */
  private updateNotice(): void {
    if (!this.notice) return;
    const retry = this.notice.querySelector('#practice-retry');
    this.notice.classList.toggle('is-visible', this.error || (!!retry && !retry.hasAttribute('hidden')));
  }
  private translate(): void {
    if (this.toolbar) applyControlTranslations(this.toolbar);
    if (this.notice) applyControlTranslations(this.notice);
    this.status(this.statusKey, this.error);
  }
  stop(): void {
    if (!this.active) return;
    this.active = false; this.generation++; this.pendingPanel = null;
    document.removeEventListener('pointerdown', this.closeMenuOutside);
    this.offTab?.(); this.offTab = null;
    this.panel?.dispose(); this.panel = null; this.editor = null;
    this.toolbar?.remove(); this.toolbar = null;
    this.notice?.remove(); this.notice = null;
    this.scope?.classList.remove('dc-mapping-workspace'); this.scope = null;
    this.options.unmountEditor();
    const release = this.release; this.release = null; release?.();
  }
  dispose(): void {
    this.disposed = true; this.stop(); this.off.forEach(off => off()); this.session?.dispose();
  }
}
