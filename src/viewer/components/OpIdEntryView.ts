// OpenProcessing 作品 ID を入力して読み込ませる UI。
//
// 2 つのレンダリングモードを持つ:
//   renderHero(onSubmit)   ローカル catalog が空 (ホスト版) のときのメイン画面。
//                          画面中央の大きな入力欄。
//   renderInline(container, onSubmit)
//                          ギャラリーの上に出す小さな入力バー。
//
// どちらも submit 時に parseOpId() で ID を抽出し、onSubmit(id) を呼ぶ。
// 入力は数値だけでなく "sketch<id>" や OP の URL もそのまま受ける。

const HERO_HTML = `
  <div class="container op-hero-container">
    <header class="op-hero-header">
      <h1 class="op-hero-title">dropcaster</h1>
      <p class="op-hero-subtitle">OpenProcessing の作品を投影マッピング用に読み込みます。</p>
    </header>
    <form class="op-id-form op-id-form--hero" novalidate>
      <label class="op-id-label" for="op-id-input-hero">作品 ID または URL</label>
      <div class="op-id-row">
        <input
          id="op-id-input-hero"
          class="op-id-input"
          name="op-id"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="例: 2257553 / https://openprocessing.org/sketch/2257553"
          required
        >
        <button type="submit" class="op-id-submit">読み込み</button>
      </div>
      <p class="op-id-error" hidden>有効な作品 ID または OpenProcessing の URL を入力してください。</p>
    </form>
    <footer class="op-hero-footer">
      <p>p5js モードの作品に対応しています。アセット付き作品は asset proxy 設定で読み込み可能になります。</p>
      <p class="op-hero-credit">
        &copy; <span data-year></span> Shinya Oguri ·
        <a href="https://github.com/shinyaoguri/dropcaster/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a> ·
        <a href="https://github.com/shinyaoguri/dropcaster" target="_blank" rel="noopener">GitHub</a>
      </p>
    </footer>
  </div>
`;

const INLINE_HTML = `
  <form class="op-id-form op-id-form--inline" novalidate>
    <input
      class="op-id-input"
      name="op-id"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      placeholder="OpenProcessing 作品 ID / URL"
      required
    >
    <button type="submit" class="op-id-submit">開く</button>
  </form>
`;

export class OpIdEntryView {
  /** catalog が空のときのメイン画面として #app 全体を埋める。 */
  static renderHero(onSubmit: (id: string) => void): void {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) return;
    app.innerHTML = HERO_HTML;
    const yearEl = app.querySelector<HTMLElement>('[data-year]');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    OpIdEntryView.wireForm(app, onSubmit);
    // フォーカスは hero モードのときだけ自動付与 (inline はギャラリー閲覧を邪魔したくない)
    app.querySelector<HTMLInputElement>('.op-id-input')?.focus();
  }

  /** ギャラリー UI 内などに小さな入力バーを差し込む。 */
  static renderInline(container: HTMLElement, onSubmit: (id: string) => void): void {
    container.insertAdjacentHTML('beforeend', INLINE_HTML);
    OpIdEntryView.wireForm(container, onSubmit);
  }

  /** インライン形式の HTML 文字列を返す（既存テンプレに埋め込み用）。 */
  static inlineHtml(): string {
    return INLINE_HTML;
  }

  /** scope 内の最後の .op-id-form を 1 つだけ wire する。重複バインドはしない。 */
  static wireForm(scope: HTMLElement, onSubmit: (id: string) => void): void {
    const form = scope.querySelector<HTMLFormElement>('.op-id-form:not([data-wired])');
    if (!form) return;
    form.setAttribute('data-wired', 'true');
    const input = form.querySelector<HTMLInputElement>('.op-id-input');
    const error = form.querySelector<HTMLElement>('.op-id-error');
    if (!input) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = parseOpId(input.value);
      if (id) {
        error?.setAttribute('hidden', '');
        input.classList.remove('op-id-input--invalid');
        onSubmit(id);
      } else {
        error?.removeAttribute('hidden');
        input.classList.add('op-id-input--invalid');
        input.focus();
        input.select();
      }
    });
    input.addEventListener('input', () => {
      input.classList.remove('op-id-input--invalid');
      error?.setAttribute('hidden', '');
    });
  }
}

/**
 * 入力文字列から OpenProcessing の作品 ID (数値) を抽出する。
 * 数値そのもの、"sketch<id>"、OP の作品 URL (https://openprocessing.org/sketch/<id>) を受け付ける。
 * 抽出不能なら null。
 */
export function parseOpId(raw: string): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  // OP の URL から抽出 (path 中の /sketch/<digits>)
  const urlMatch = t.match(/openprocessing\.org\/sketch\/(\d+)/i);
  if (urlMatch) return urlMatch[1];
  // "sketch<id>" 形式
  const prefixMatch = t.match(/^sketch(\d+)$/i);
  if (prefixMatch) return prefixMatch[1];
  // 純粋な数値
  if (/^\d+$/.test(t)) return t;
  return null;
}
