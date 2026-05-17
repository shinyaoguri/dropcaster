// 多言語化 (en/ja) — 軽量実装。
//
// - 初期言語は localStorage('dropcaster.lang') → navigator.language の順で決定。
// - setLang() で切替し localStorage に保存、`dropcaster:langchange` をディスパッチ。
//   購読側（各 View / ControlWindow）はこのイベントで再描画する。
// - t(key, vars?) は `{name}` プレースホルダ展開のみサポート。

import { messages, type MessageKey } from './messages.js';

export type Lang = 'en' | 'ja';
export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'ja'] as const;

const STORAGE_KEY = 'dropcaster.lang';
const EVENT_NAME = 'dropcaster:langchange';

function detectInitialLang(): Lang {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored === 'en' || stored === 'ja') return stored;
  } catch {
    // localStorage が使えない (SSR / privacy mode) — fallthrough
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav && nav.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let currentLang: Lang = detectInitialLang();

// 初回ロード時に <html lang> を同期しておく
if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLang;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang !== 'en' && lang !== 'ja') return;
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 保存できなくても切替は続行
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { lang } }));
  }
}

export function onLangChange(handler: (lang: Lang) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail.lang as Lang);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const dict = messages[currentLang] ?? messages.en;
  const raw = (dict[key] ?? messages.en[key] ?? key) as string;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
  );
}

export type { MessageKey } from './messages.js';
