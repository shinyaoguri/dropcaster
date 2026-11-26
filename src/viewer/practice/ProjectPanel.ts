import { randomId } from '../utils/randomId';
import { parseProject, portableProject, portableVenue, importVenue, ProjectFormatError,
  MAX_PACKAGE_BYTES, type Project } from './project';
import { listProjects, readProject } from './projectStore';
import type { ProjectSession } from './ProjectSession';
import { applyControlTranslations } from '../windows/control/ControlWindow.template';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import { routeHref } from '../utils/paths';

// `./controls` は回転の換算に three を使う。このパネルは Three.js を読み込まないので、同じ形の部品をここに持つ。
const label = (key: MessageKey) => `<span data-i18n="${key}">${t(key)}</span>`;
const button = (id: string, key: MessageKey) => `<button type="button" id="${id}" class="tool-button">${label(key)}</button>`;

const FORMAT_ERRORS = ['invalid', 'version', 'asset', 'reference', 'externalAsset', 'unsupportedAsset', 'size'];
/** 取り込み・会場の構築で投げられた失敗を、利用者に見せる文言のキーにする。 */
export function projectErrorKey(error: unknown): MessageKey | null {
  return error instanceof ProjectFormatError && FORMAT_ERRORS.includes(error.message) ? `practice.${error.message}` as MessageKey : null;
}

/**
 * プロジェクトという入れ物の操作 (名前・保存・複製・開く・書き出し・取り込み・会場の書き出し・取り込み前に戻す・作品参照)。
 * ProjectSession と projectStore だけに依存し、WebGL / Three.js を必要としない (ADR 0012)。
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
  private session: ProjectSession;
  private status: (key: MessageKey, error?: boolean) => void;
  private venueChanged: (shaped: boolean) => void;

  constructor(scope: HTMLElement, session: ProjectSession, status: (key: MessageKey, error?: boolean) => void, venueChanged: (shaped: boolean) => void) {
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
    this.update(this.session.changes.get()); this.storageStatus();
  }
  private storageStatus(): void {
    const state = this.session.storage.get();
    this.get('practice-storage').textContent = t(state === 'error' ? 'practice.storageError' : state === 'saving' ? 'practice.saving' : 'practice.saved');
  }
  private update(project: Project): void {
    if (this.disposed) return;
    const name = this.get<HTMLInputElement>('practice-project-name');
    if (document.activeElement !== name) name.value = project.name === 'Untitled' ? t('practice.untitled') : project.name;
    const contents = this.get('practice-content-list');
    const text = project.show.contentIds.map(id => project.content.find(c => c.id === id)?.title ?? id).join('\n');
    if (contents.dataset.content !== text) {
      contents.replaceChildren(...text.split('\n').filter(Boolean).map(title => { const li = document.createElement('li'); li.textContent = title; return li; }));
      contents.dataset.content = text;
    }
    this.get<HTMLButtonElement>('practice-open-content').disabled = !project.content.length;
    this.get<HTMLButtonElement>('practice-undo-import').disabled = !this.previous;
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
    } catch (error) { console.warn('Named project could not be saved', error); this.status('practice.storageError', true); }
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
    const url = URL.createObjectURL(new Blob([JSON.stringify(venueOnly ? portableVenue(project) : portableProject(project), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.${venueOnly ? 'venue' : 'dropcaster'}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private async openContent(): Promise<void> {
    await this.session.save(); if (this.disposed || this.session.storage.get() === 'error') { this.status('practice.storageError', true); return; }
    // App resolves references before replacing the running view. Opening a project never opens outputs.
    const link = document.createElement('a'); link.href = routeHref('/project'); document.body.append(link); link.click(); link.remove();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.action++;
    this.off.forEach(off => off()); this.root.remove();
  }
}
