// Imports nothing so that tests/draft-saver.test.js can load it directly in Node.
export type StorageState = 'saved' | 'saving' | 'error';

/** Where leaving the page is observed. Tests pass plain EventTargets. */
export interface LeaveEvents {
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly hidden: boolean };
}

/** Quiet period after the last continuous change (drag) before writing. */
export const DRAFT_DEBOUNCE_MS = 600;

/**
 * 下書きを保存する規則 (#168, ADR 0010)。ProjectSession と VenueSession が共有する。
 *
 * - 名前・フォームの確定・取り込みのような離散的な確定は `save()` でその場で書き込みを始める。
 * - ドラッグのような連続操作は `schedule()` で、最後の変更から DRAFT_DEBOUNCE_MS 後に 1 回だけ書く。
 * - 保存待ちか書き込み中に離脱しようとしたら、保存を始めてから離脱確認を出す。
 * - 持ち主が書かないと決めた変更 (`hold()`。下書きを復元できなかった間、#286) は、次の `save()` まで離脱確認を出す。
 *   再読み込みでは非同期の IndexedDB 書込が完了しないので、離脱時の書込だけには頼らない。
 */
export class DraftSaver {
  private readonly write: () => Promise<void>;
  private readonly report: (state: StorageState) => void;
  private readonly beforeLeave: () => void;
  private readonly events: LeaveEvents;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  private writing = 0;
  private held = false;

  /** `beforeLeave` commits edits the owner still holds (e.g. a nudge waiting to settle) before the check. */
  constructor(write: () => Promise<void>, report: (state: StorageState) => void, beforeLeave: () => void = () => {},
    events: LeaveEvents = { window, document }) {
    this.write = write; this.report = report; this.beforeLeave = beforeLeave; this.events = events;
    events.window.addEventListener('beforeunload', this.beforeUnload);
    events.window.addEventListener('pagehide', this.flush);
    events.document.addEventListener('visibilitychange', this.visibility);
  }

  /** A debounced write is waiting, a write has not finished, or a change was held. */
  get pending(): boolean { return this.timer !== undefined || this.writing > 0 || this.held; }
  /** A change was held back by `hold()` and no save has started since. */
  get holding(): boolean { return this.held; }

  /** A change the owner does not write yet: nothing is written, but leaving asks first until the next `save()`. */
  hold(): void { this.held = true; }

  /** Continuous change: write once the changes stop. */
  schedule(): void {
    clearTimeout(this.timer);
    this.version++;
    this.report('saving');
    this.timer = setTimeout(() => { this.timer = undefined; this.saveQuietly(); }, DRAFT_DEBOUNCE_MS);
  }

  /**
   * Discrete commit: start writing now (synchronously, so a reload in the same task is already pending).
   * Rejects with the write error; the state is reported either way.
   */
  async save(write = this.write): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined; this.held = false;
    const version = ++this.version;
    this.writing++;
    this.report('saving');
    try {
      await write();
      if (version === this.version) this.report('saved');
    } catch (error) {
      if (version === this.version) this.report('error');
      throw error;
    } finally { this.writing--; }
  }

  /** Start a waiting debounced write now. */
  flush = (): void => { if (this.timer !== undefined) this.saveQuietly(); };

  /** Stop observing the page; a waiting debounced write still starts. */
  dispose(): void {
    this.events.window.removeEventListener('beforeunload', this.beforeUnload);
    this.events.window.removeEventListener('pagehide', this.flush);
    this.events.document.removeEventListener('visibilitychange', this.visibility);
    this.flush();
  }

  private saveQuietly(): void { this.save().catch(error => { console.warn('Draft could not be saved', error); /* the state is reported as 'error' */ }); }
  private visibility = (): void => { if (this.events.document.hidden) this.flush(); };
  private beforeUnload = (event: Event): void => {
    this.beforeLeave();
    this.flush();
    if (!this.pending) return;
    // 保存が済むまで離脱を確認する。確認中も書き込みは進み、キャンセルすればそのまま保存済みになる。
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = 'Changes are still being saved.';
  };
}
