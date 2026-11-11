import type { WindowController } from '../components/WindowController';
import type { Sketch } from '../types/sketch';
import { Emitter } from '../utils/emitter';
import { createProject, parseProject, reconcileProjectLayout, type Project, type ContentReference } from './project';
import { readProject, writeProject } from './projectStore';

export interface ShowContext { sketches: Sketch[]; currentIndex: number; intervalSeconds: number }
export function contentReference(sketch: Sketch): ContentReference {
  const kind = sketch.id.startsWith('op-') ? 'op' : sketch.id.startsWith('gist-') ? 'gist' : 'local';
  return { id: sketch.id, kind, ref: kind === 'local' ? sketch.id : sketch.id.slice(kind.length + 1), title: sketch.title,
    path: kind === 'local' ? sketch.path.replace(/^(\.\.\/|\.\/|\/)+/, '') : undefined,
    revision: sketch.lastModified || null, revisionPinned: false };
}

/** Working Project; WindowController remains the sole owner of the live 2D layout. */
export class ProjectSession {
  readonly changes: Emitter<Project>;
  readonly storage = new Emitter<'saved' | 'saving' | 'error'>('saved');
  readonly ready: Promise<void>;
  private wc: WindowController;
  private off: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private initialized = false;
  private saveVersion = 0;
  private getContext: () => ShowContext;

  constructor(wc: WindowController, getContext: () => ShowContext) {
    this.wc = wc; this.getContext = getContext;
    this.changes = new Emitter(createProject(wc.events.state.get()));
    this.off = wc.events.state.subscribe(layout => {
      this.changes.set(reconcileProjectLayout(this.changes.get(), layout));
      if (this.initialized) this.scheduleSave();
    });
    this.ready = this.restore();
  }
  private async restore(): Promise<void> {
    try {
      const stored = await readProject();
      if (this.disposed) return;
      // The latest v2 working layout wins; an older async draft cannot roll it back.
      if (stored) this.changes.set(reconcileProjectLayout(parseProject(stored), this.wc.events.state.get()));
    } catch { if (!this.disposed) this.storage.set('error'); }
    if (this.disposed) return;
    this.initialized = true;
    this.updateContent();
  }
  updateContent(): void {
    const context = this.getContext();
    if (!context.sketches.length) return;
    const content = context.sketches.map(contentReference);
    this.changes.set({ ...this.changes.get(), content, show: { contentIds: content.map(c => c.id),
      currentIndex: context.currentIndex, intervalSeconds: context.intervalSeconds } });
    if (this.initialized) this.scheduleSave();
  }
  update(next: Project, layout = false): void {
    if (this.disposed) return;
    const project = { ...next, updatedAt: new Date().toISOString() };
    this.changes.set(project);
    if (layout) this.wc.applyStateFromInline(project.venue.layout);
    this.scheduleSave();
  }
  private scheduleSave(): void {
    clearTimeout(this.timer);
    this.saveVersion++;
    this.storage.set('saving');
    this.timer = setTimeout(() => { this.timer = undefined; void this.save(); }, 600);
  }
  async save(named = false): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    const version = ++this.saveVersion;
    this.storage.set('saving');
    try {
      const project = this.changes.get();
      await writeProject(project);
      if (named) await writeProject(project, project.id);
      if (version === this.saveVersion) this.storage.set('saved');
    } catch (error) {
      if (version === this.saveVersion) this.storage.set('error');
      if (named) throw error;
    }
  }
  dispose(): void {
    this.disposed = true; this.off();
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; void this.save(); }
  }
}
