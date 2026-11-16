import type { WindowController } from '../components/WindowController';
import type { ControlWindow } from '../windows/control/ControlWindow';
import type { SketchFrame } from '../runtime/SketchFrame';
import type { PracticePanel } from './PracticePanel';
import { ProjectSession, type ShowContext } from './ProjectSession';
import { installPracticeStyles } from './style';
import { t, onLangChange, type MessageKey } from '../i18n/index';
import type { Project } from './project';
import { activityIcon, applyControlTranslations } from '../windows/control/ControlWindow.template';
import { routeHref } from '../utils/paths';

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
  /** アクティビティバーの下端に差し込むホーム・閉じると、それぞれの確認ダイアログ。 */
  private toolbar: HTMLElement | null = null;
  /** プロジェクトパネルの末尾に差し込む会場の作成・調整への入口。 */
  private venueEntry: HTMLElement | null = null;
  /** ツール見出しの直下に差し込む状態文と再試行。 */
  private notice: HTMLElement | null = null;
  private scope: HTMLElement | null = null;
  private release: (() => void) | null = null;
  private offTab: (() => void) | null = null;
  private offToolPanel: (() => void) | null = null;
  private generation = 0;
  private off: (() => void)[] = [];
  private active = false;
  private statusKey: MessageKey = 'practice.waiting';
  private error = false;
  private disposed = false;

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
    // 専用の上部バーは作業領域を削るので持たない。状態文と再試行はツールカラムの見出し直下に置き、
    // エラー時だけ見せる。ホームへ戻る・閉じる操作はアクティビティバーの下端に置く。
    // 会場の作成・調整 (別タブ) は使う頻度が低いので、常時見えるバーではなくプロジェクトパネルの末尾に置く (ADR 0021)。
    const toolHeader = this.scope.querySelector<HTMLElement>('.tool-column > .column-header');
    const activityFooter = this.scope.querySelector<HTMLElement>('.dc-activity-bar-footer');
    const projectPanel = this.scope.querySelector<HTMLElement>('#dc-tool-panel-project');
    if (!toolHeader || !activityFooter || !projectPanel) { this.stop(); return; }
    this.notice = document.createElement('div'); this.notice.className = 'dc-workspace-notice';
    this.notice.innerHTML = `<span id="dc-practice-status" role="status" aria-live="polite"></span>
      <button type="button" id="practice-retry" class="tool-button" data-i18n="practice.retry" hidden></button>`;
    toolHeader.after(this.notice);
    this.toolbar = document.createElement('div'); this.toolbar.className = 'dc-workspace-actions';
    // ホームへ出ると作品のページを離れ、出力ウィンドウも閉じる。× と同じく 1 クリックでは出ず確認を挟む。
    // 確定は <a> なので、ルーターの内部遷移 (SPA) でホームへ移る。
    this.toolbar.innerHTML = `<a id="practice-home" class="dc-workspace-close" href="${routeHref('/')}" data-i18n-title="practice.home" data-i18n-aria-label="practice.home">${activityIcon('home')}</a>
      <dialog id="practice-home-confirm" class="dc-workspace-confirm" aria-labelledby="practice-home-confirm-title" aria-describedby="practice-home-confirm-hint"><div class="dc-workspace-confirm-body">
        <p id="practice-home-confirm-title" class="dc-workspace-confirm-title" data-i18n="practice.homeConfirm"></p>
        <p id="practice-home-confirm-hint" class="dc-workspace-confirm-hint" data-i18n="practice.homeConfirmHint"></p>
        <div class="dc-workspace-confirm-actions">
          <button type="button" id="practice-home-cancel" data-i18n="practice.stopCancel" autofocus></button>
          <a id="practice-home-confirm-btn" class="is-danger" href="${routeHref('/')}" data-i18n="practice.homeConfirmAction"></a>
        </div>
      </div></dialog>
      <button type="button" id="practice-stop" class="dc-workspace-close" data-i18n-title="practice.stop" data-i18n-aria-label="practice.stop"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      <dialog id="practice-stop-confirm" class="dc-workspace-confirm" aria-labelledby="practice-stop-confirm-title" aria-describedby="practice-stop-confirm-hint"><div class="dc-workspace-confirm-body">
        <p id="practice-stop-confirm-title" class="dc-workspace-confirm-title" data-i18n="practice.stopConfirm"></p>
        <p id="practice-stop-confirm-hint" class="dc-workspace-confirm-hint" data-i18n="practice.stopConfirmHint"></p>
        <div class="dc-workspace-confirm-actions">
          <button type="button" id="practice-stop-cancel" data-i18n="practice.stopCancel" autofocus></button>
          <button type="button" id="practice-stop-confirm-btn" class="is-danger" data-i18n="practice.stopConfirmAction"></button>
        </div>
      </div></dialog>`;
    activityFooter.append(this.toolbar);
    this.venueEntry = document.createElement('section');
    this.venueEntry.id = 'practice-venue-entry'; this.venueEntry.className = 'tool-section';
    this.venueEntry.innerHTML = `<h3 data-i18n="calibration.title"></h3><p class="section-hint" data-i18n="practice.venueEntryHint"></p>
      <a id="practice-venue" class="tool-button dc-venue-entry-link" href="${routeHref('/venue')}" target="_blank" rel="noopener noreferrer" data-i18n="calibration.open"></a>`;
    projectPanel.append(this.venueEntry);
    // × は 1 クリックで閉じず確認を挟む。window.confirm() はメインスレッドを止め、同一オリジン
    // iframe の作品描画と出力への captureStream まで止めるので、非ブロッキングの <dialog> を使う。
    const home = this.toolbar.querySelector<HTMLDialogElement>('#practice-home-confirm')!;
    this.toolbar.querySelector('#practice-home')!.addEventListener('click', event => {
      // ルーターの document クリック捕捉より先に止め、確認を経ずに遷移させない。
      event.preventDefault(); event.stopPropagation();
      if (!home.open) home.showModal();
    });
    home.querySelector('#practice-home-cancel')!.addEventListener('click', () => home.close());
    home.querySelector('#practice-home-confirm-btn')!.addEventListener('click', () => home.close());
    home.addEventListener('click', event => { if (event.target === home) home.close(); });
    home.addEventListener('keydown', event => event.stopPropagation());
    const confirm = this.toolbar.querySelector<HTMLDialogElement>('#practice-stop-confirm')!;
    this.toolbar.querySelector('#practice-stop')!.addEventListener('click', () => {
      if (!confirm.open) confirm.showModal();
    });
    confirm.querySelector('#practice-stop-cancel')!.addEventListener('click', () => confirm.close());
    confirm.querySelector('#practice-stop-confirm-btn')!.addEventListener('click', () => { confirm.close(); this.stop(); });
    // 背景 (dialog 要素自身) のクリックは取り消しとして扱う。
    confirm.addEventListener('click', event => { if (event.target === confirm) confirm.close(); });
    // document に張られた編集のキー操作 (矢印での微調整・マスクの Enter/Esc など) へ届けない。
    // Esc でダイアログを閉じるのはブラウザの既定動作なので、伝播を止めても効く。
    confirm.addEventListener('keydown', event => event.stopPropagation());
    this.notice.querySelector('#practice-retry')!.addEventListener('click', () => {
      editor.selectTab('preview'); void this.ensurePanel();
    });
    // 3D とプロジェクトのパネルを開くことは、3D 設定・プロジェクトの明示操作として PracticePanel を読み込む
    // (ADR 0012)。マッピング・出力・確認のパネルだけを使う間は Three.js を読み込まない。
    this.offToolPanel = editor.onToolPanelChange(panel => {
      if (panel === 'preview3d' || panel === 'project') void this.ensurePanel();
    });
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
    if (this.venueEntry) applyControlTranslations(this.venueEntry);
    if (this.notice) applyControlTranslations(this.notice);
    this.status(this.statusKey, this.error);
  }
  stop(): void {
    if (!this.active) return;
    this.active = false; this.generation++; this.pendingPanel = null;
    this.offTab?.(); this.offTab = null;
    this.offToolPanel?.(); this.offToolPanel = null;
    this.panel?.dispose(); this.panel = null; this.editor = null;
    this.toolbar?.remove(); this.toolbar = null;
    this.venueEntry?.remove(); this.venueEntry = null;
    this.notice?.remove(); this.notice = null;
    this.scope?.classList.remove('dc-mapping-workspace'); this.scope = null;
    this.options.unmountEditor();
    const release = this.release; this.release = null; release?.();
  }
  dispose(): void {
    this.disposed = true; this.stop(); this.off.forEach(off => off()); this.session?.dispose();
  }
}
