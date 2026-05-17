// 言語切替用 segmented toggle。
// JA / EN の 2 つのセグメントを左右に並べ、現在言語が active 表示になる。
// 非 active セグメントをクリックすると setLang() で切り替える。

import { getLang, setLang, type Lang, t } from './index.js';

/** segmented toggle の HTML を返す（innerHTML 補間に乗せる用）。 */
export function langSwitcherHtml(): string {
  const lang = getLang();
  const opts: Array<{ value: Lang; label: string }> = [
    { value: 'en', label: 'EN' },
    { value: 'ja', label: 'JA' },
  ];
  const title = escapeAttr(t('lang.toggle.title'));
  const segments = opts.map((o) => {
    const active = o.value === lang;
    return `<button
      type="button"
      class="dc-lang-toggle-opt${active ? ' is-active' : ''}"
      data-lang-set="${o.value}"
      aria-pressed="${active ? 'true' : 'false'}"
    >${o.label}</button>`;
  }).join('');
  return `
    <div
      class="dc-lang-toggle"
      role="group"
      aria-label="${title}"
      data-lang-switcher
    >${segments}</div>
  `;
}

/** scope 内の `[data-lang-switcher]` セグメントに click ハンドラを束ねる。 */
export function wireLangSwitcher(scope: ParentNode = document): void {
  const groups = scope.querySelectorAll<HTMLElement>('[data-lang-switcher]:not([data-wired])');
  groups.forEach((group) => {
    group.setAttribute('data-wired', 'true');
    group.querySelectorAll<HTMLButtonElement>('[data-lang-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.langSet as Lang | undefined;
        if (next === 'en' || next === 'ja') setLang(next);
      });
    });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
