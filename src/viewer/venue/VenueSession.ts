import { Emitter } from '../utils/emitter';
import { createProject, parseProject, type Project } from '../practice/project';
import { readProject, writeProject } from '../practice/projectStore';
import { roomScene } from '../practice/venueObjects';
import { t } from '../i18n';

/** An independent document: never writes the mapping draft or v2 layout storage. */
export class VenueSession {
  readonly changes: Emitter<Project>;
  readonly storage = new Emitter<'saved' | 'saving' | 'error'>('saved');
  readonly ready: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private version = 0;
  constructor() {
    const project = createProject();
    project.venue.scene = roomScene(8, 3, 6, [t('practice.floor'), t('practice.backWall'), t('practice.leftWall'), t('practice.rightWall')]);
    this.changes = new Emitter(project); this.ready = this.restore();
    window.addEventListener('pagehide', this.flush);
    document.addEventListener('visibilitychange', this.visibility);
  }
  private async restore(): Promise<void> {
    try {
      const stored = await readProject('venue-draft');
      if (!this.disposed && stored) this.changes.set(this.document(parseProject(stored)));
      else if (!this.disposed) await this.save();
    } catch { if (!this.disposed) this.storage.set('error'); }
  }
  private document(project: Project): Project {
    return { ...project, content: [], show: { contentIds: [], currentIndex: 0, intervalSeconds: 30 } };
  }
  update(project: Project): void {
    if (this.disposed) return;
    this.changes.set(this.document({ ...project, updatedAt: new Date().toISOString() }));
    clearTimeout(this.timer); this.version++; this.storage.set('saving');
    this.timer = setTimeout(() => { this.timer = undefined; void this.save(); }, 600);
  }
  async save(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    const version = ++this.version; this.storage.set('saving');
    try {
      await writeProject(this.changes.get(), 'venue-draft');
      if (version === this.version) this.storage.set('saved');
    } catch { if (version === this.version) this.storage.set('error'); }
  }
  private flush = (): void => { if (this.timer) void this.save(); };
  private visibility = (): void => { if (document.hidden) this.flush(); };
  dispose(): void {
    this.disposed = true; this.flush(); window.removeEventListener('pagehide', this.flush);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
