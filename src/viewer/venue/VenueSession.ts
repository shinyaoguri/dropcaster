import { Emitter } from '../utils/emitter';
import { createProject, parseProject, type Project } from '../practice/project';
import { readProject, writeProject } from '../practice/projectStore';
import { DraftSaver, type StorageState } from '../practice/draftSaver';
import { roomScene } from '../practice/venueObjects';
import { t } from '../i18n';

/** An independent document: never writes the mapping draft or v2 layout storage. */
export class VenueSession {
  readonly changes: Emitter<Project>;
  readonly storage = new Emitter<StorageState>('saved');
  readonly ready: Promise<void>;
  private saver: DraftSaver;
  private disposed = false;
  /** `beforeLeave` commits an adjustment the page still holds, so leaving cannot skip it. */
  constructor(beforeLeave?: () => void) {
    const project = createProject();
    project.venue.scene = roomScene(8, 3, 6, [t('practice.floor'), t('practice.backWall'), t('practice.leftWall'), t('practice.rightWall')]);
    this.changes = new Emitter(project);
    this.saver = new DraftSaver(() => writeProject(this.changes.get(), 'venue-draft'), state => this.storage.set(state), beforeLeave);
    this.ready = this.restore();
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
  /** Every caller commits a finished change (the page settles drags and nudges first), so saving starts now. */
  update(project: Project): void {
    if (this.disposed) return;
    this.changes.set(this.document({ ...project, updatedAt: new Date().toISOString() }));
    void this.save();
  }
  async save(): Promise<void> {
    try { await this.saver.save(); } catch { /* reported through storage */ }
  }
  dispose(): void {
    this.disposed = true; this.saver.dispose();
  }
}
