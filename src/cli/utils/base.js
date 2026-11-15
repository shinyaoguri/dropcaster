import { t } from '../i18n/index.js';

// 配信先のベースパス (Vite の base / import.meta.env.BASE_URL / manifest の start_url・scope) を
// CLI のどの入口でも同じ規則で決める (#175)。viewer の getBasePath (src/viewer/utils/paths.ts) と
// 同じく先頭と末尾の '/' を補った絶対パスにそろえる。

/**
 * 設置先 base を正規化する。未指定 (undefined / null / '') は '/'。
 * 先頭・末尾の '/' を補う。`./` のような相対 base や `https://…` のような URL は、viewer が
 * 実行時に '/' を前置して壊れるので受け付けずに止める。`?`・`#`・空白・バックスラッシュを含む値も、
 * そのまま manifest と Vite の base に入ってパスとして成り立たないので止める。
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeBase(raw) {
  if (raw === undefined || raw === null || raw === '') return '/';
  if (
    typeof raw !== 'string' ||
    raw.startsWith('.') ||
    raw.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(raw) ||
    /[?#\s\\]/.test(raw)
  ) {
    throw new Error(t('base.invalid', { base: String(raw) }));
  }
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * 明示された `base` オプション > dropcaster.config.js の `base` > '/' で決めて正規化する。
 * commander 経由では `--base` に既定値が入るので、値の出どころが 'cli' のときだけ明示とみなす。
 * command 無しで (プログラムから) 呼ばれたときは、options.base が与えられていれば明示とみなす。
 *
 * @param {{ base?: string }} options
 * @param {import('commander').Command | undefined} command
 * @param {{ base?: unknown }} config loadConfig の結果
 * @returns {string}
 */
export function resolveBase(options, command, config) {
  const explicit = command
    ? command.getOptionValueSource('base') === 'cli'
    : options.base !== undefined;
  return normalizeBase(explicit ? options.base : config.base);
}

/**
 * manifest の start_url・scope を base に合わせた設定を返す。config で start_url を既定の '/'
 * 以外に、または scope を明示していればそちらを残す。
 *
 * @template {{ start_url?: string, scope?: string }} C
 * @param {C} config
 * @param {string} base 正規化済みの base
 * @returns {C & { base: string, start_url: string, scope: string }}
 */
export function manifestConfigFor(config, base) {
  const startUrl = !config.start_url || config.start_url === '/' ? base : config.start_url;
  return { ...config, base, start_url: startUrl, scope: config.scope || base };
}
