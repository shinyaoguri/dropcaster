/**
 * 左端のアクティビティバー (ADR 0021)。マッピング画面と会場の作成・調整画面で共有する。
 *
 *   - `.dc-activity-btn[data-tool-panel]` を押すと、同じ `data-tool-panel` の `.dc-tool-panel` をツールカラムに出す。
 *   - 選択中のボタンをもう一度押すとツールカラムを畳む (`.control-container.is-tool-collapsed`)。
 *     どれかのボタンで開き直す。列幅 (ColumnResizers が書いた inline width) は触らないので元の幅に戻る。
 *   - 上下矢印・Home・End で隣のボタンへ移り、そのパネルを選ぶ (タブストリップと同じく「移動 = 選択」)。
 *   - 見出し (`.tool-column > .column-header h2`) に選択中のパネル名を出す。
 *
 * 開閉とパネルの選択は保存しない (毎回 `initial` で開く)。
 */
import { t, type MessageKey } from '../../../i18n/index.js';
import { CleanupStack } from '../../../utils/cleanupStack';

export class ActivityBar<T extends string> {
  private scope: HTMLElement | null = null;
  private active: T;
  private collapsed = false;
  private listeners = new Set<(panel: T) => void>();
  private cleanups = new CleanupStack();

  private readonly initial: T;
  private readonly titleKey: (panel: T) => MessageKey;

  constructor(initial: T, titleKey: (panel: T) => MessageKey) {
    this.initial = initial; this.active = initial; this.titleKey = titleKey;
  }

  get panel(): T { return this.active; }
  get isCollapsed(): boolean { return this.collapsed; }

  /** パネルが選ばれるたびに呼ぶ (畳んだ状態から同じパネルを開き直したときも含む)。 */
  onChange(listener: (panel: T) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  attach(scope: HTMLElement): void {
    this.detach();
    this.scope = scope;
    const buttons = [...scope.querySelectorAll<HTMLButtonElement>('.dc-activity-btn')];
    buttons.forEach((button, index) => {
      const panel = button.dataset.toolPanel as T;
      const onClick = (): void => {
        if (panel === this.active) this.setCollapsed(!this.collapsed);
        else this.select(panel);
      };
      const onKeydown = (event: KeyboardEvent): void => {
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
          : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next < 0) return;
        // document に張られた編集のキー操作 (矢印での微調整など) へ届けない。
        event.preventDefault(); event.stopPropagation();
        this.select(buttons[next].dataset.toolPanel as T); buttons[next].focus();
      };
      button.addEventListener('click', onClick);
      button.addEventListener('keydown', onKeydown);
      this.cleanups.push(() => { button.removeEventListener('click', onClick); button.removeEventListener('keydown', onKeydown); });
    });
    this.render();
  }

  /** ツールカラムに `name` のパネルを出す。畳んでいれば開く。 */
  select(name: T): void {
    if (!this.scope) return;
    const changed = name !== this.active;
    this.active = name;
    // 畳んでいれば開く (開いたことの通知は setCollapsed が出す)。
    if (this.collapsed) { this.setCollapsed(false); return; }
    if (!changed) return;
    this.render();
    this.listeners.forEach(listener => listener(name));
  }

  /** ツールカラムを畳む / 開く。 */
  setCollapsed(collapsed: boolean): void {
    if (!this.scope || collapsed === this.collapsed) return;
    this.collapsed = collapsed;
    this.render();
    if (!collapsed) this.listeners.forEach(listener => listener(this.active));
    // 列幅が変わったステージは、各パネルの ResizeObserver が新しい寸法で描き直す。
  }

  /** 言語切替のあとに見出しを書き直す。 */
  render(): void {
    const scope = this.scope;
    if (!scope) return;
    const name = this.active;
    scope.querySelector('.control-container')?.classList.toggle('is-tool-collapsed', this.collapsed);
    scope.querySelectorAll<HTMLButtonElement>('.dc-activity-btn').forEach(button => {
      const active = button.dataset.toolPanel === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      // 選択中のボタンだけが「ツールカラムを開閉する」状態を持つ。
      if (active) button.setAttribute('aria-expanded', String(!this.collapsed));
      else button.removeAttribute('aria-expanded');
    });
    scope.querySelectorAll<HTMLElement>('.dc-tool-panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.toolPanel === name));
    const title = scope.querySelector<HTMLElement>('.tool-column > .column-header h2');
    if (title) {
      const key = this.titleKey(name);
      title.setAttribute('data-i18n', key); title.textContent = t(key);
    }
  }

  /** listener を外し、状態を初期値へ戻す。 */
  detach(): void {
    this.cleanups.runAll();
    this.scope = null; this.active = this.initial; this.collapsed = false;
  }

  /** detach に加えて購読も外す。 */
  destroy(): void {
    this.detach(); this.listeners.clear();
  }
}
