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
  /**
   * 下書きを復元できなかった。明示的な確定 (`update(project, true)` / `save()`) が書くまで、ほかの変更は書かずに保留する
   * (離脱の前には確認が出る)。ProjectSession の自動保存と同じ扱い (#286, ADR 0010)。
   */
  private unrestored = false;
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
    } catch (error) {
      console.warn('Venue draft could not be restored', error);
      if (!this.disposed) { this.unrestored = true; this.storage.set('error'); }
    }
  }
  private document(project: Project): Project {
    return { ...project, content: [], show: { contentIds: [], currentIndex: 0, intervalSeconds: 30 } };
  }
  /**
   * Every caller commits a finished change (the page settles drags and nudges first), so saving starts now.
   * While the draft could not be restored, only an `explicit` commit (the user naming, importing, confirming a form…)
   * writes; any other change is held: not written, the storage label keeps the error, and leaving asks first.
   */
  update(project: Project, explicit = false): void {
    if (this.disposed) return;
    this.changes.set(this.document({ ...project, updatedAt: new Date().toISOString() }));
    if (this.unrestored && !explicit) { this.saver.hold(); return; }
    void this.save();
  }
  /** A change was held instead of written (see `update`). */
  get holding(): boolean { return this.saver.holding; }
  async save(): Promise<void> {
    this.unrestored = false;
    try { await this.saver.save(); } catch (error) { console.warn('Venue draft could not be saved', error); /* the state is reported through storage */ }
  }
  dispose(): void {
    this.disposed = true; this.saver.dispose();
  }
}
