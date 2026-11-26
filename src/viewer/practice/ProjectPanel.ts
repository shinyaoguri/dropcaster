import { randomId } from '../utils/randomId';
import { parseProject, parseShowReferences, exportText, importVenue, ProjectFormatError,
  MAX_PACKAGE_BYTES, type Project } from './project';
import { listProjects, readProject } from './projectStore';
import { readSnapshot, storeSnapshot } from './snapshotStore';
import { shownSnapshots, type SketchSnapshot } from './sketchSnapshot';
import { OpenProcessingSource } from '../services/OpenProcessingSource';
import { GistSource } from '../services/GistSource';
import type { ProjectSession } from './ProjectSession';
import { applyControlTranslations } from '../windows/control/ControlWindow.template';
import { t, getLang, onLangChange, type MessageKey } from '../i18n/index';
import { routeHref } from '../utils/paths';

// `./controls` は回転の換算に three を使う。このパネルは Three.js を読み込まないので、同じ形の部品をここに持つ。
const label = (key: MessageKey) => `<span data-i18n="${key}">${t(key)}</span>`;
const button = (id: string, key: MessageKey) => `<button type="button" id="${id}" class="tool-button">${label(key)}</button>`;

const FORMAT_ERRORS = ['invalid', 'version', 'asset', 'reference', 'externalAsset', 'unsupportedAsset', 'size', 'contentLimit'];
/** 取り込み・会場の構築で投げられた失敗を、利用者に見せる文言のキーにする。 */
export function projectErrorKey(error: unknown): MessageKey | null {
  return error instanceof ProjectFormatError && FORMAT_ERRORS.includes(error.message) ? `practice.${error.message}` as MessageKey : null;
}

type Content = Project['content'][number];
type Pinned = Extract<Content, { revisionPinned: true }>;
/**
 * 固定した作品 (#197) のコードがこのブラウザにあるか。無ければ今の内容を取得して照合する。
 * changed は受け取ったプロジェクトなどで、今の内容が固定時と違う (固定時のコードはどこにも無い)。
 */
type PinState = { kind: 'checking' } | { kind: 'pinned'; fetchedAt: string } | { kind: 'changed'; latest: SketchSnapshot }
  | { kind: 'unavailable' } | { kind: 'storeError' };
const pinKey = (item: Pinned) => `${item.id}:${item.hash}`;
const sameSketch = (snapshot: SketchSnapshot, item: Content) =>
  snapshot.payload.kind === item.kind && snapshot.payload.ref.toLowerCase() === item.ref.toLowerCase();

/**
 * プロジェクトという入れ物の操作 (名前・保存・複製・開く・書き出し・取り込み・会場の書き出し・取り込み前に戻す・作品参照と
 * そのコードの固定 (#197))。ProjectSession・projectStore・snapshotStore と OP / Gist の取得元に依存し、WebGL / Three.js を必要としない (ADR 0012)。
 * 取り込みは検証 (parseProject / importVenue) に成功した時点で確定する。3D の会場は PracticePanel が session の変更を見て作り直す。
 * 取り込み・保存済みを開く・取り込み前に戻すで会場が変わったら、確定の後に `venueChanged` で知らせる。形のある会場なら
 * MappingWorkspace が 3D を裏で読み込む (ADR 0010)。
 */
export class ProjectPanel {
  private root = document.createElement('div');
  private off: (() => void)[] = [];
  private disposed = false;
  private action = 0;
  private previous: Project | null = null;
  private previousMode: 'project' | 'venue' = 'project';
  /** 保存して読み込み直せるかを最後に確かめた作品参照。作品が変わったときだけ確かめ直す (#173)。 */
  private checkedContent: Project['content'] | null = null;
  private session: ProjectSession;
  private status: (key: MessageKey, error?: boolean, reason?: MessageKey | null) => void;
  private venueChanged: (shaped: boolean) => void;
  private pins = new Map<string, PinState>();
  /** 固定・最新版の取得・固定し直しを実行中の作品の id。 */
  private pinning = new Set<string>();
  private sources?: { op: OpenProcessingSource; gist: GistSource };

  constructor(scope: HTMLElement, session: ProjectSession, status: (key: MessageKey, error?: boolean, reason?: MessageKey | null) => void, venueChanged: (shaped: boolean) => void) {
    this.session = session; this.status = status; this.venueChanged = venueChanged;
    this.root.className = 'dc-practice-settings';
    this.root.innerHTML = `<section id="dc-practice-project" class="tool-section"><h3>${label('practice.project')}</h3>
      <label class="dc-practice-field">${label('practice.projectName')}<input id="practice-project-name" maxlength="200" required></label>
      ${button('practice-save', 'practice.save')}${button('practice-duplicate', 'practice.duplicate')}
      <p id="practice-storage" class="dc-practice-hint" role="status"></p>
      <label class="dc-practice-field">${label('practice.savedProjects')}<select id="practice-saved-projects"></select></label>
      ${button('practice-open-project', 'practice.openProject')}${button('practice-export', 'practice.export')}${button('practice-import', 'practice.import')}
      ${button('practice-export-venue', 'practice.exportVenue')}<p class="dc-practice-hint">${label('practice.shareVenueHint')}</p>
      <input id="practice-project-file" type="file" accept=".json,application/json" hidden>
      ${button('practice-undo-import', 'practice.undoImport')}
      <h3>${label('practice.content')}</h3><ul id="practice-content-list"></ul>
      <p class="dc-practice-hint">${label('practice.referencesOnly')}</p>${button('practice-open-content', 'practice.openContent')}</section>`;
    // 保存・読込を、ControlWindow の「設定の入出力」より先に置く。
    scope.querySelector('#dc-tool-panel-project')!.prepend(this.root);
    this.wireControls();
    this.off.push(session.changes.subscribe(project => this.update(project)),
      session.storage.subscribe(() => this.storageStatus()), onLangChange(() => this.translate()));
    this.translate();
    void this.refreshSaved();
  }

  /** 会場ファイル・プロジェクトを選ぶ。3D パネルの「会場ファイルを読み込む」も同じ入口を使う。 */
  chooseFile(): void { if (!this.disposed) this.get<HTMLInputElement>('practice-project-file').click(); }

  private get<T extends HTMLElement = HTMLInputElement>(id: string): T { return this.root.querySelector<T>(`#${id}`)!; }
  private translate(): void {
    applyControlTranslations(this.root);
    this.update(this.session.changes.get()); this.renderContent(undefined, true); this.storageStatus();
  }
  private storageStatus(): void {
    const state = this.session.storage.get();
    const unwritable = state === 'error' ? this.session.unwritable : null;
    this.get('practice-storage').textContent = unwritable ? t('practice.notSaved', { reason: t(this.reason(unwritable)) })
      : t(state === 'error' ? 'practice.storageError' : state === 'saving' ? 'practice.saving' : 'practice.saved');
  }
  private update(project: Project): void {
    if (this.disposed) return;
    const name = this.get<HTMLInputElement>('practice-project-name');
    if (document.activeElement !== name) name.value = project.name === 'Untitled' ? t('practice.untitled') : project.name;
    this.renderContent(project);
    this.get<HTMLButtonElement>('practice-open-content').disabled = !project.content.length;
    this.checkContent(project);
    this.get<HTMLButtonElement>('practice-undo-import').disabled = !this.previous;
  }
  /** 作品の一覧。OP / Gist は固定の状態と操作を並べる (#197)。題名は第三者の文字列なので textContent で入れる。 */
  private renderContent(project = this.session.changes.get(), force = false): void {
    if (this.disposed) return;
    const contents = this.get('practice-content-list');
    // 変更 (ドラッグ中は毎フレーム) のたびに通るので、作品数の 2 乗にならないよう引く (#173)。
    const refs = new Map(project.content.map(c => [c.id, c]));
    const items = project.show.contentIds.map(id => refs.get(id)
      ?? { id, kind: 'local' as const, ref: id, title: id, revision: null, revisionPinned: false as const });
    const view = items.map(item => {
      const state = item.revisionPinned ? this.pins.get(pinKey(item)) : undefined;
      const shown = shownSnapshots.get(item.id);
      return { item, state, busy: this.pinning.has(item.id),
        notShown: item.revisionPinned && state?.kind === 'pinned' && !!shown && sameSketch(shown, item) && shown.hash !== item.hash };
    });
    const signature = JSON.stringify(view.map(({ item, state, busy, notShown }) => [item.id, item.title, item.kind, item.revisionPinned && item.hash,
      state?.kind, state?.kind === 'pinned' ? state.fetchedAt : '', busy, notShown]));
    if (!force && contents.dataset.content === signature) return;
    contents.dataset.content = signature;
    const focused = document.activeElement instanceof HTMLElement && contents.contains(document.activeElement) ? document.activeElement.dataset : undefined;
    contents.replaceChildren(...view.map(({ item, state, busy, notShown }) => {
      const li = document.createElement('li'); li.dataset.id = item.id;
      const title = document.createElement('span'); title.className = 'dc-content-title'; title.textContent = item.title; li.append(title);
      if (item.kind !== 'op' && item.kind !== 'gist') return li;
      const hint = (text: string) => { const p = document.createElement('p'); p.className = 'dc-practice-hint dc-content-pin'; p.textContent = text; li.append(p); };
      const actions: [string, MessageKey][] = [];
      if (!item.revisionPinned) actions.push(['pin', 'practice.pin']);
      else {
        if (state?.kind === 'pinned') {
          const date = new Date(state.fetchedAt).toLocaleString(getLang() === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
          hint(t('practice.pinnedAt', { date }));
          if (notShown) hint(t('practice.pinNotShown'));
        } else hint(t(state?.kind === 'changed' ? 'practice.pinChanged' : state?.kind === 'unavailable' ? 'practice.pinUnavailable'
          : state?.kind === 'storeError' ? 'practice.pinStoreError' : 'practice.pinChecking'));
        hint(t('practice.pinAssets'));
        actions.push(state?.kind === 'changed' ? ['repin', 'practice.repin'] : ['refresh', 'practice.refreshPin'], ['unpin', 'practice.unpin']);
      }
      const row = document.createElement('div'); row.className = 'dc-content-actions';
      for (const [action, key] of actions) {
        const control = document.createElement('button'); control.type = 'button'; control.className = 'tool-button';
        control.dataset.action = action; control.dataset.id = item.id; control.textContent = t(key); control.disabled = busy;
        row.append(control);
      }
      li.append(row);
      return li;
    }));
    // 状態が変わって作り直しても、操作していた作品のボタンからフォーカスを外さない。
    if (focused?.id) {
      const same = [...contents.querySelectorAll<HTMLButtonElement>('button[data-id]')].filter(b => b.dataset.id === focused.id);
      (same.find(b => b.dataset.action === focused.action) ?? same[0])?.focus();
    }
    for (const { item } of view) if (item.revisionPinned && !this.pins.has(pinKey(item))) void this.checkPin(item);
  }
  private source(kind: 'op' | 'gist'): OpenProcessingSource | GistSource {
    this.sources ??= { op: new OpenProcessingSource(), gist: new GistSource() };
    return this.sources[kind];
  }
  /** いま表示している版 (取得し直さない)。 */
  private shown(item: Content): SketchSnapshot | undefined {
    const shown = shownSnapshots.get(item.id);
    return shown && sameSketch(shown, item) ? shown : undefined;
  }
  /** 取得元から今の内容を取り、開ける作品か (未対応の mode・index.html の無い Gist でないか) を組み立てて確かめる。 */
  private async fetchLatest(item: Content): Promise<SketchSnapshot> {
    if (item.kind !== 'op' && item.kind !== 'gist') throw new Error('Only OpenProcessing and Gist sketches can be pinned');
    const source = this.source(item.kind), snapshot = await source.fetchSnapshot(item.ref);
    source.build(snapshot);
    return snapshot;
  }
  private async checkPin(item: Pinned): Promise<void> {
    const key = pinKey(item);
    this.pins.set(key, { kind: 'checking' });
    let state: PinState;
    try {
      const stored = await readSnapshot(item.hash);
      if (stored) state = { kind: 'pinned', fetchedAt: stored.fetchedAt };
      else {
        // 受け取ったプロジェクトなど、固定時のコードがこのブラウザに無い。今の内容 (表示中ならその版) が同じなら、それを固定時のコードとして残す。
        let latest: SketchSnapshot | undefined;
        try { latest = this.shown(item) ?? await this.fetchLatest(item); }
        catch (error) { console.warn('Current sketch code could not be fetched to check the pin', error); }
        if (!latest) state = { kind: 'unavailable' };
        else if (latest.hash === item.hash) state = { kind: 'pinned', fetchedAt: (await storeSnapshot(latest)).fetchedAt };
        else state = { kind: 'changed', latest };
      }
    } catch (error) { console.warn('Pinned sketch code could not be read', error); state = { kind: 'storeError' }; }
    if (this.disposed) return;
    this.pins.set(key, state); this.renderContent();
  }
  private async pin(id: string, action: string): Promise<void> {
    const item = this.session.changes.get().content.find(c => c.id === id);
    if (!item || (item.kind !== 'op' && item.kind !== 'gist') || this.pinning.has(id)) return;
    if (action === 'unpin') {
      if (!item.revisionPinned) return;
      const { hash: _hash, ...rest } = item;
      const project = this.session.changes.get();
      this.session.update({ ...project, content: project.content.map(c => c.id === id ? { ...rest, revisionPinned: false as const } : c) });
      this.status('practice.unpinned');
      return;
    }
    this.pinning.add(id); this.renderContent();
    try {
      let snapshot: SketchSnapshot;
      const state = item.revisionPinned ? this.pins.get(pinKey(item)) : undefined;
      if (action === 'repin' && state?.kind === 'changed') snapshot = state.latest;
      else if (action === 'refresh') {
        // 明示的に最新を取る。取れなければ固定したコードをそのまま使う。
        try { snapshot = await this.fetchLatest(item); }
        catch (error) { console.warn('Latest sketch code could not be fetched', error); if (!this.disposed) this.status('practice.pinFetchFailed', true); return; }
      } else if (action === 'pin') snapshot = this.shown(item) ?? await this.fetchLatest(item);
      else return;
      const stored = await storeSnapshot(snapshot);
      if (this.disposed) return;
      const project = this.session.changes.get(), target = project.content.find(c => c.id === id);
      // 待つ間に取り込みなどで作品が入れ替わったら、何も変えない。
      if (!target || target.kind !== item.kind || target.ref !== item.ref) return;
      const unchanged = target.revisionPinned && target.hash === stored.hash;
      this.pins.set(`${id}:${stored.hash}`, { kind: 'pinned', fetchedAt: stored.fetchedAt });
      this.session.update({ ...project, content: project.content.map(c => c.id === id ? { ...c, revisionPinned: true as const, hash: stored.hash } : c) });
      this.status(action === 'refresh' ? (unchanged ? 'practice.pinUpToDate' : 'practice.pinRefreshed') : 'practice.pinned');
    } catch (error) {
      console.warn('Sketch code could not be pinned', error);
      if (!this.disposed) this.status('practice.pinFailed', true);
    } finally { this.pinning.delete(id); this.renderContent(); }
  }
  /** 保存しても読み込み直せない作品参照 (1 万件を超える・長すぎる作品名など) があれば、黙って保存せず理由を出す (#173)。 */
  private checkContent(project: Project): void {
    if (project.content === this.checkedContent) return;
    this.checkedContent = project.content;
    try { parseShowReferences(project.content, project.show.contentIds); } catch (error) {
      if (!(error instanceof ProjectFormatError)) throw error;
      this.status('practice.contentUnsavable', true, this.reason(error));
    }
  }
  /** 書き出し・保存できない理由。形式の検証の汎用の失敗は、値の範囲の文言にする。 */
  private reason(error: ProjectFormatError): MessageKey {
    const key = projectErrorKey(error);
    return key === 'practice.invalid' || !key ? 'practice.unreadableValue' : key;
  }
  private wireControls(): void {
    const click = (id: string, run: () => void) => this.get(id).addEventListener('click', run);
    click('practice-import', () => this.chooseFile());
    this.get('practice-project-file').addEventListener('change', () => void this.readFile());
    this.get('practice-project-name').addEventListener('change', () => {
      const name = this.get<HTMLInputElement>('practice-project-name').value.trim();
      if (name) this.session.update({ ...this.session.changes.get(), name });
    });
    click('practice-save', () => void this.saveNamed(false));
    click('practice-duplicate', () => void this.saveNamed(true));
    click('practice-open-project', () => void this.openSaved());
    click('practice-export', () => this.export());
    click('practice-export-venue', () => this.export(true));
    click('practice-undo-import', () => {
      if (this.previous) this.apply(this.previous, this.previousMode === 'venue');
    });
    click('practice-open-content', () => void this.openContent());
    this.get('practice-content-list').addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
      if (target?.dataset.id && target.dataset.action) void this.pin(target.dataset.id, target.dataset.action);
    });
  }
  private error(error: unknown): void {
    // 形式の検証で分かった原因はその文言を出す。それ以外は設定の誤りとは言わず、元の例外を残す (#198)。
    if (!(error instanceof ProjectFormatError)) console.warn('Project change failed', error);
    this.status(projectErrorKey(error) ?? (error instanceof ProjectFormatError ? 'practice.invalid' : 'practice.changeFailed'), true);
  }
  private async readFile(): Promise<void> {
    const input = this.get<HTMLInputElement>('practice-project-file'), file = input.files?.[0];
    input.value = ''; if (!file) return;
    const action = ++this.action; this.status('practice.busy');
    try {
      if (file.size > MAX_PACKAGE_BYTES) throw new ProjectFormatError('size');
      const text = await file.text();
      if (this.disposed || action !== this.action) return;
      const value = JSON.parse(text);
      if (value?.format === 'dropcaster-venue') this.apply(importVenue(value, this.session.changes.get()), true);
      else this.apply(parseProject(value));
    } catch (error) { if (!this.disposed && action === this.action) this.error(error); }
  }
  /** `project` は検証済み (parseProject / importVenue を通ったもの)。3D の構築を待たずに確定する。 */
  private apply(project: Project, venueOnly = false): void {
    if (this.disposed) return;
    ++this.action;
    this.previous = this.session.changes.get();
    this.previousMode = venueOnly ? 'venue' : 'project';
    // 会場だけの取り込みは、受け取る側の作品・再生設定を残す。
    if (venueOnly) project = { ...this.previous, venue: project.venue, assets: project.assets };
    // 先に結果を出す。会場を作れなかった・3D を表示できなかったときは、3D の側 (PracticePanel・裏の読み込み) がその失敗で上書きする。
    this.status(venueOnly ? 'practice.venueImported' : 'practice.imported');
    this.session.update(project, true, !venueOnly);
    // 形のある会場 (GLB・部材) が入ったら 3D を裏で読み込む。2D 編集の背景 (プロジェクタ視点の会場) がすぐ出て、
    // 作れない会場の失敗も取り込み前に戻せるうちに分かる。戻した先の会場も同じく出す。読み込みに失敗しても取り込みは確定したまま (#169)。
    this.venueChanged(project.venue.scene.kind !== 'sample');
  }
  private async refreshSaved(): Promise<void> {
    try {
      const projects = await listProjects(); if (this.disposed) return;
      this.get<HTMLSelectElement>('practice-saved-projects').replaceChildren(...projects.map(p => new Option(p.name, p.id)));
      this.get<HTMLButtonElement>('practice-open-project').disabled = projects.length === 0;
    } catch (error) { console.warn('Saved projects could not be listed', error); if (!this.disposed) this.session.storage.set('error'); }
  }
  private async saveNamed(copy: boolean): Promise<void> {
    try {
      if (copy) this.session.update({ ...this.session.changes.get(), id: randomId(), createdAt: new Date().toISOString() });
      await this.session.save(true); await this.refreshSaved();
    } catch (error) {
      if (error instanceof ProjectFormatError) { this.status('practice.notSaved', true, this.reason(error)); return; }
      console.warn('Named project could not be saved', error); this.status('practice.storageError', true);
    }
  }
  private async openSaved(): Promise<void> {
    const action = ++this.action;
    try {
      const project = await readProject(this.get<HTMLSelectElement>('practice-saved-projects').value);
      if (this.disposed || action !== this.action) return;
      // 一覧にあるのに読み出せない (別のタブで消えたなど)。黙って終えずに知らせ、一覧を取り直す (#198)
      if (!project) { void this.refreshSaved(); throw new Error('The selected project is no longer saved'); }
      this.apply(parseProject(project));
    } catch (error) { if (!this.disposed && action === this.action) this.error(error); }
  }
  private export(venueOnly = false): void {
    const project = this.session.changes.get();
    let text: string;
    // 自分で読み込めないファイルは書き出さず、理由を出す (#173)。
    try { text = exportText(project, venueOnly); } catch (error) {
      if (!(error instanceof ProjectFormatError)) throw error;
      this.status('practice.exportRefused', true, this.reason(error));
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.${venueOnly ? 'venue' : 'dropcaster'}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private async openContent(): Promise<void> {
    // 読み込み直せない内容は保存しないので、/project へは移らない (#173)。
    await this.session.save(); if (this.disposed) return;
    if (this.session.storage.get() === 'error') {
      const unwritable = this.session.unwritable;
      if (unwritable) this.status('practice.notSaved', true, this.reason(unwritable)); else this.status('practice.storageError', true);
      return;
    }
    // App resolves references before replacing the running view. Opening a project never opens outputs.
    const link = document.createElement('a'); link.href = routeHref('/project'); document.body.append(link); link.click(); link.remove();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.action++;
    this.off.forEach(off => off()); this.root.remove();
  }
}
