// 外部ツール（FFmpeg / Playwright の Chromium）と Node バージョンの有無をチェックするユーティリティ。
// postinstall / dropcaster init / dropcaster doctor / scan-sketches.js から使う。
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { t } from '../cli/i18n/index.js';

export const REQUIRED_NODE = '20.19.0';

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function gte(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return true;
    if (x[i] < y[i]) return false;
  }
  return true;
}

function ffmpegHint() {
  switch (process.platform) {
    case 'darwin':
      return t('env.ffmpegHint.darwin');
    case 'win32':
      return t('env.ffmpegHint.win');
    default:
      return t('env.ffmpegHint.linux');
  }
}

export function checkNode() {
  const version = process.versions.node;
  return {
    name: 'Node.js',
    ok: gte(version, REQUIRED_NODE),
    version: `v${version}`,
    detail: `>= v${REQUIRED_NODE}`
  };
}

export function checkFfmpeg() {
  let result;
  try {
    result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8', windowsHide: true });
  } catch {
    result = null;
  }

  if (!result || result.error || result.status !== 0) {
    return {
      name: 'FFmpeg',
      ok: false,
      version: null,
      detail: t('env.previewNeeded'),
      hint: ffmpegHint()
    };
  }

  const m = /ffmpeg version (\S+)/.exec(result.stdout || '');
  return {
    name: 'FFmpeg',
    ok: true,
    version: m ? m[1] : 'unknown',
    detail: t('env.previewNeeded')
  };
}

export async function checkChromium() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (execPath && existsSync(execPath)) {
      return { name: 'Chromium (Playwright)', ok: true, version: null, detail: t('env.previewNeeded') };
    }
    return {
      name: 'Chromium (Playwright)',
      ok: false,
      version: null,
      detail: t('env.previewNeeded'),
      hint: 'npx playwright install chromium'
    };
  } catch (error) {
    return {
      name: 'Chromium (Playwright)',
      ok: false,
      version: null,
      detail: t('env.playwrightMissing', { error: error.message }),
      hint: t('env.playwrightHint')
    };
  }
}

export async function checkEnv() {
  return {
    node: checkNode(),
    ffmpeg: checkFfmpeg(),
    chromium: await checkChromium()
  };
}

// プレビュー GIF 生成に必要なツール（FFmpeg + Chromium）が揃っているか。
// 不足があれば理由（不足アイテムの配列）を返す。
export async function checkPreviewTools() {
  const ffmpeg = checkFfmpeg();
  const chromium = await checkChromium();
  const missing = [ffmpeg, chromium].filter(item => !item.ok);
  return { ok: missing.length === 0, missing, ffmpeg, chromium };
}

/**
 * レポートを人間向けの文字列に整形する。何も出すものが無ければ null。
 * @param {{ node: any, ffmpeg: any, chromium: any }} report
 * @param {{ onlyProblems?: boolean, title?: string }} [options]
 * @returns {string | null}
 */
export function formatEnvReport(report, { onlyProblems = false, title } = {}) {
  const resolvedTitle = title ?? t('env.title');
  const items = [report.node, report.ffmpeg, report.chromium];
  const shown = onlyProblems ? items.filter(item => !item.ok) : items;
  if (shown.length === 0) return null;

  const lines = [`${resolvedTitle}:`];
  for (const item of shown) {
    const mark = item.ok ? '✓' : '✗';
    const version = item.version ? ` ${item.version}` : '';
    const detail = item.detail ? ` — ${item.detail}` : '';
    lines.push(`  ${mark} ${item.name}${version}${detail}`);
    if (!item.ok && item.hint) lines.push(`      ${t('env.installHint')}: ${item.hint}`);
  }
  return lines.join('\n');
}
