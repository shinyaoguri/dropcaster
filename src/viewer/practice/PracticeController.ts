import type { WindowController } from '../components/WindowController';
import type { ControlWindow } from '../windows/control/ControlWindow';
import type { SketchFrame } from '../runtime/SketchFrame';
import type { PracticePanel } from './PracticePanel';
import { ProjectSession, type ShowContext } from './ProjectSession';
import { installPracticeStyles } from './style';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import type { Project } from './project';

export interface PracticeOptions {
  wc: WindowController; getFrame: () => SketchFrame | null;
  mountEditor: () => ControlWindow | null; getContext: () => ShowContext;
}
/** Lightweight entry point. Three.js/GLTFLoader are loaded only after Start. */
export class PracticeController {
  private options: PracticeOptions;
  private session: ProjectSession | null = null;
  private panel: PracticePanel | null = null;
  private toolbar: HTMLElement | null = null;
  private scope: HTMLElement | null = null;
  private release: (() => void) | null = null;
  private generation = 0;
  private off: (() => void)[] = [];
  private active = false;
  private statusKey: MessageKey = 'practice.loading';
  private error = false;
  private disposed = false;

  constructor(options: PracticeOptions) {
    this.options = options; installPracticeStyles();
    this.off.push(onLangChange(() => this.translate()), options.wc.events.streaming.subscribe(active => {
      if (!active && this.active) this.stop();
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
    this.session.update(project, true);
    await this.start();
  }

  async start(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true;
    const generation = ++this.generation;
    this.release = this.options.wc.acquireStreamConsumer();
    const editor = this.options.mountEditor();
    this.scope = document.querySelector('#dc-inline-editor .dc-control-shell');
    if (!editor || !this.scope) { this.stop(); return; }
    this.scope.classList.add('dc-practice-mode');
    this.toolbar = document.createElement('header'); this.toolbar.className = 'dc-practice-toolbar';
    this.toolbar.innerHTML = '<strong data-i18n="practice.title"></strong><span id="dc-practice-status" role="status" aria-live="polite"></span><button type="button" id="practice-retry" data-i18n="practice.retry" hidden></button><button type="button" id="practice-open-output" data-i18n="practice.openOutput"></button><button type="button" id="practice-stop" data-i18n="practice.stop"></button>';
    this.scope.prepend(this.toolbar);
    this.toolbar.querySelector('#practice-stop')!.addEventListener('click', () => this.stop());
    this.toolbar.querySelector('#practice-open-output')!.addEventListener('click', () => this.options.wc.openOutputWindow());
    this.toolbar.querySelector('#practice-retry')!.addEventListener('click', () => void this.startPanel(editor, ++this.generation));
    this.status('practice.loading'); this.translate();
    this.session ??= new ProjectSession(this.options.wc, this.options.getContext);
    void this.connectSource();
    await this.startPanel(editor, generation);
  }

  /** Re-read the current frame after async readiness; never reconnect a previous slide. */
  async connectSource(): Promise<void> {
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
  private async startPanel(editor: ControlWindow, generation: number): Promise<void> {
    this.panel?.dispose(); this.panel = null; this.status('practice.loading');
    this.toolbar?.querySelector('#practice-retry')?.setAttribute('hidden', '');
    try {
      const [{ PracticePanel }] = await Promise.all([import('./PracticePanel'), this.session!.ready]);
      if (!this.active || this.disposed || generation !== this.generation || !this.scope) return;
      const panel = new PracticePanel(this.scope, this.options.wc, this.session!, editor,
        (key, error) => this.status(key, error), () => {
          this.panel?.dispose(); this.panel = null;
          this.toolbar?.querySelector('#practice-retry')?.removeAttribute('hidden');
        });
      this.panel = panel;
      await panel.initialize();
      if (!this.active || generation !== this.generation) { panel.dispose(); return; }
      this.status('practice.ready');
      // Retry may have invalidated a pending source wait.
      if (!this.options.wc.events.stream.get()) void this.connectSource();
    } catch {
      if (!this.active || this.disposed || generation !== this.generation) return;
      this.panel?.dispose(); this.panel = null; this.status('practice.error', true);
      this.toolbar?.querySelector('#practice-retry')?.removeAttribute('hidden');
    }
  }
  private status(key: MessageKey, error = false): void {
    this.statusKey = key; this.error = error;
    const element = this.toolbar?.querySelector('#dc-practice-status');
    if (element) { element.textContent = t(key); element.classList.toggle('is-error', error); }
  }
  private translate(): void {
    this.toolbar?.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n as MessageKey); });
    this.status(this.statusKey, this.error);
  }
  stop(): void {
    if (!this.active) return;
    this.active = false; this.generation++;
    this.panel?.dispose(); this.panel = null;
    this.toolbar?.remove(); this.toolbar = null;
    this.scope?.classList.remove('dc-practice-mode'); this.scope = null;
    const release = this.release; this.release = null; release?.();
  }
  dispose(): void {
    this.disposed = true; this.stop(); this.off.forEach(off => off()); this.session?.dispose();
  }
}
