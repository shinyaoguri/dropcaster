// Node 側（CLI / core）の多言語化 — viewer 側と独立して動く。
//
// 言語決定の優先順位:
//   1. 環境変数 DROPCASTER_LANG=en|ja
//   2. 環境変数 LANG / LC_ALL の先頭が ja → 'ja'
//   3. デフォルト 'en'

import { messages } from './messages.js';

function detectLang() {
  const explicit = (process.env.DROPCASTER_LANG || '').toLowerCase();
  if (explicit === 'en' || explicit === 'ja') return explicit;
  const locale = (process.env.LC_ALL || process.env.LANG || '').toLowerCase();
  if (locale.startsWith('ja')) return 'ja';
  return 'en';
}

let currentLang = detectLang();

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (lang === 'en' || lang === 'ja') currentLang = lang;
}

export function t(key, vars) {
  const dict = messages[currentLang] ?? messages.en;
  const raw = dict[key] ?? messages.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
  );
}
