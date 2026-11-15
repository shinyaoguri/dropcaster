// ビルド時に埋め込まれた dropcaster の版 (src/core/build-info.js が求め、vite の define で入る) を表示用に整える。
import { escapeHtml } from './html';

export interface BuildInfo {
  version: string;
  commit: string | null;
}

const REPOSITORY_URL = 'https://github.com/shinyaoguri/dropcaster';

export function getBuildInfo(): BuildInfo | null {
  return import.meta.env.DROPCASTER_BUILD ?? null;
}

/** ツールカラム下端の版表示の中身。埋め込みが無い経路では空文字を返し、何も出さない。 */
export function buildInfoHtml(info: BuildInfo | null = getBuildInfo()): string {
  if (!info) return '';
  const version = `dropcaster v${escapeHtml(info.version)}`;
  if (!info.commit) return `<span title="${version}">${version}</span>`;
  const commit = escapeHtml(info.commit);
  return `<span>${version}</span> · <a href="${REPOSITORY_URL}/commit/${commit}" target="_blank" rel="noopener noreferrer" title="${version} (${commit})">${commit}</a>`;
}
