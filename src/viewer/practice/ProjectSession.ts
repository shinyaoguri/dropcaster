import type { WindowController } from '../components/WindowController';
import type { Sketch } from '../types/sketch';
import { Emitter } from '../utils/emitter';
import { createProject, parseProject, reconcileProjectLayout, showReferences, ProjectFormatError, type Project, type Projector } from './project';
import { readProject, writeProject } from './projectStore';
import { DraftSaver, type StorageState } from './draftSaver';

export interface ShowContext { sketches: Sketch[]; currentIndex: number; intervalSeconds: number }

/** Working Project; WindowController remains the sole owner of the live 2D layout. */
export class ProjectSession {
  readonly changes: Emitter<Project>;
  readonly storage = new Emitter<StorageState>('saved');
  readonly ready: Promise<void>;
  private wc: WindowController;
  private off: () => void;
  private saver: DraftSaver;
  private disposed = false;
  private initialized = false;
  /**
   * 下書きを復元できなかった (読めない版・読み出しの失敗)。明示的な確定 (`update` / `save`) が書くまで自動保存しない。
   * 自動保存は利用者の操作なしに書くので、読めなかった下書きを黙って既定のプロジェクトで上書きしてしまう (#286, ADR 0010)。
   */
  private unrestored = false;
  private followContext = true;
  private getContext: () => ShowContext;
  /**
   * 配置から消えた出力のプロジェクタ。同じ出力 ID が配置へ戻ったとき (削除の Undo、以前書き出した 2D 設定の
   * 読込) に校正値を返すため、出力 ID ごとに覚える (#165)。保存はしない。プロジェクトを配置ごと差し替えると
   * 捨てる (そのとき編集の履歴も空になる)。編集画面を閉じて履歴だけが消えた場合は、このセッションが残る間は残る。
   */
  private removedProjectors = new Map<string, Projector>();
  /**
   * 最後に書こうとしたプロジェクトが、このアプリで読み込み直せなかった理由。読み込み直せないものは下書きに
   * 書かず、前に保存した内容を残す (#173)。自動保存も明示的な保存も同じ判定を通る。
   */
  private unwritableReason: ProjectFormatError | null = null;

  constructor(wc: WindowController, getContext: () => ShowContext) {
    this.wc = wc; this.getContext = getContext;
    this.changes = new Emitter(createProject(wc.events.state.get()));
    this.saver = new DraftSaver(async () => writeProject(this.writable(this.changes.get())), state => this.storage.set(state));
    this.off = wc.events.state.subscribe(layout => {
      this.changes.set(reconcileProjectLayout(this.changes.get(), layout, this.removedProjectors));
      // 2D の変更はドラッグ中に毎フレーム届くので、止まってから書く。2D そのものは WindowController が
      // localStorage へ同期で残す。下書きから開く /project では待ちの間の離脱に確認が出る。
      this.autosave();
    });
    this.ready = this.restore();
  }
  private async restore(): Promise<void> {
    try {
      const stored = await readProject();
      if (this.disposed) return;
      // The latest v2 working layout wins; an older async draft cannot roll it back.
      if (stored) this.changes.set(reconcileProjectLayout(parseProject(stored), this.wc.events.state.get(), this.removedProjectors));
    } catch (error) {
      console.warn('Project draft could not be restored', error);
      // 保存欄は error のまま残し、復元できなかったことを示す。
      if (!this.disposed) { this.unrestored = true; this.storage.set('error'); }
    }
    if (this.disposed) return;
    this.initialized = true;
    this.updateContent();
  }
  updateContent(): void {
    if (!this.followContext) return;
    const context = this.getContext();
    if (!context.sketches.length) return;
    const { content, contentIds } = showReferences(context.sketches);
    this.changes.set({ ...this.changes.get(), content, show: { contentIds,
      currentIndex: context.currentIndex, intervalSeconds: context.intervalSeconds } });
    // 作品の自動送り・連打のたびに資産ごと書かないよう、まとめて書く。参照は再表示時に表示中の作品から作り直す。
    this.autosave();
  }
  private autosave(): void { if (this.initialized && !this.unrestored) this.saver.schedule(); }
  /** 保存しなかった理由 (読み込み直せない内容)。保存できたら null に戻る。 */
  get unwritable(): ProjectFormatError | null { return this.unwritableReason; }
  /** 下書きに書く前に、読み込むときと同じ検証を通す。作業中の GLB は検証済みなので復号し直さない。 */
  private writable(project: Project): Project {
    try { parseProject(project, project.assets); } catch (error) {
      if (error instanceof ProjectFormatError) this.unwritableReason = error;
      throw error;
    }
    this.unwritableReason = null;
    return project;
  }
  /** A discrete commit (name, import, undo of an import, copy): saving starts now. */
  update(next: Project, layout = false, replaceContent = true): void {
    if (this.disposed) return;
    if (layout && replaceContent) this.followContext = false; // Keep imported references until the user opens them.
    if (layout) this.removedProjectors.clear();
    const project = { ...next, updatedAt: new Date().toISOString() };
    this.changes.set(project);
    if (layout) this.wc.applyStateFromInline(project.venue.layout);
    void this.save(); // Also takes over the layout write the line above scheduled.
  }
  followCurrentContent(): void { this.followContext = true; this.updateContent(); }
  /** Explicit commit; it also ends the hold a failed restore put on autosave. */
  async save(named = false): Promise<void> {
    const project = this.changes.get();
    try {
      await this.saver.save(async () => {
        this.writable(project);
        this.unrestored = false; // 読み込み直せない内容は書かないので、復元できなかった下書きもそのまま残る
        await writeProject(project);
        if (named) await writeProject(project, project.id);
      });
    } catch (error) { if (named) throw error; console.warn('Project draft could not be saved', error); }
  }
  dispose(): void {
    this.disposed = true; this.off(); this.saver.dispose();
  }
}
