#!/usr/bin/env node
// 版を決め、リリースノートを組む (docs/decisions/0022)。
//
// リリースは**リポジトリのファイルを 1 つも変えない**。変更履歴や package.json の版を main へ
// 入れるには PR が要り、Actions の既定のトークンで作った PR は他のワークフローを起こさないので
// 必須チェック (verify / pr-policy) が走らない。版はタグ、ノートは GitHub Release に置く。
//
//   - 版は履歴から決める (`v<major>.<minor>.<patch>` のタグが唯一の記録。無ければ BASELINE から数える)
//   - ノートは、前回のタグ以降に**追加された** changelog.d/ の断片から組む
//   - 断片が 1 つも増えていなければリリースしない (中身の無い版を出さない)
//
// サブコマンド (.github/workflows/release.yml と pr-policy.yml から呼ぶ):
//   next-version   次の版のタグ名を出す。出すものが無ければ終了コード 2
//   notes          Release の本文を出す
//   lint           changelog.d/ の断片がノートに組める形かを見る。壊れていれば終了コード 1
//   check-pr       PR が断片を伴うべきなのに伴っていなければ終了コード 1
//                  (環境変数 PR_TITLE / PR_FILES / PR_LABELS。後ろ 2 つは改行区切り)
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { envWithoutRepositoryLocation } from '../src/core/git-env.js';

export const FRAGMENT_DIR = 'changelog.d';

/** 断片の分類と見出し。並びがそのままノートの並びになる。分類の正本はここ。 */
export const SECTIONS = /** @type {const} */ ([
  ['breaking', '破壊的変更'],
  ['feature', '新機能'],
  ['fix', '修正'],
  ['perf', '性能'],
  ['docs', 'ドキュメント'],
]);

/** タグが 1 つも無いときに「前の版」とみなす版。タグを打つ前の package.json が名乗っていた版。 */
export const BASELINE = '0.1.0';

/** 断片を伴わずに通さない PR の type。利用者から見える変化を持つもの。 */
export const TYPES_NEEDING_FRAGMENT = ['feat', 'fix', 'perf'];

/** 断片が要らない変更だと申告するラベル。 */
export const SKIP_LABEL = 'changelog: none';

const FRAGMENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?<category>[a-z]+)\.md$/;
const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
// Conventional Commits の頭。`!` は破壊的変更の印 (scripts/check-pr-title.sh と同じ形)
const TITLE_PATTERN = /^(?<type>[a-z]+)(\([^)]*\))?(?<breaking>!)?: /;
// `[文字](行き先)` の行き先。画像も含む — Release の本文では相対パスがどれも壊れる
const INLINE_LINK_PATTERN = /\[[^\]]*\]\((?<target>[^)\s]*)[^)]*\)/g;
// `[文字][ラベル]` — 定義が別の断片に残るとノートでは壊れる
const REFERENCE_LINK_PATTERN = /\[[^\]]*\]\[[^\]]*\]/;

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, ...args) {
  // 親の GIT_DIR などを引き継ぐと、cwd ではなく外側のリポジトリのタグと履歴を読む (#253)
  const env = envWithoutRepositoryLocation();
  return execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/**
 * @param {string} version `0.2.0`
 * @returns {[number, number, number]}
 */
function parseVersion(version) {
  const parts = version.split('.').map(Number);
  return [parts[0], parts[1], parts[2]];
}

/**
 * HEAD から辿れる、いちばん新しい版のタグ。1 つも無ければ null。
 * @param {string} cwd
 * @returns {string | null}
 */
export function latestTag(cwd) {
  const tags = git(cwd, 'tag', '--list', 'v*', '--merged', 'HEAD').split('\n').filter((t) => TAG_PATTERN.test(t));
  if (tags.length === 0) return null;
  const key = (/** @type {string} */ t) => parseVersion(t.slice(1));
  return tags.reduce((best, t) => {
    const [a, b] = [key(t), key(best)];
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? t : best;
    return best;
  });
}

/**
 * コミットの題 (squash merge なので PR タイトル) と断片の分類から次の版を決める。
 *
 * **1.0 未満では破壊的変更も minor で出す。** 0.x は形が動くことを織り込んだ区間で、
 * そこで major を上げ始めると 1.0 の意味が薄れる。1.0 はメンテナが決めて手で打つ。
 * @param {string[]} titles
 * @param {string[]} categories 今回の断片の分類
 * @param {string} current `0.1.0`
 * @returns {string}
 */
export function bumpFor(titles, categories, current) {
  const [major, minor, patch] = parseVersion(current);
  const matches = titles.map((t) => TITLE_PATTERN.exec(t)).filter((m) => m !== null);
  const breaking = matches.some((m) => m.groups?.breaking) || categories.includes('breaking');
  const feature = matches.some((m) => m.groups?.type === 'feat') || categories.includes('feature');
  if (major === 0) {
    return breaking || feature ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`;
  }
  if (breaking) return `${major + 1}.0.0`;
  if (feature) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * changelog.d/ 直下の断片か (README と下位ディレクトリは数えない)。
 * @param {string} path リポジトリからの相対パス
 */
function isFragmentPath(path) {
  const rest = path.startsWith(`${FRAGMENT_DIR}/`) ? path.slice(FRAGMENT_DIR.length + 1) : null;
  return rest !== null && !rest.includes('/') && rest.endsWith('.md') && rest !== 'README.md';
}

/**
 * 前回のタグ以降に**追加された**断片 (相対パス)。タグが無ければ置かれている全部。
 * @param {string} cwd
 * @param {string | null} since
 * @returns {string[]}
 */
export function addedFragments(cwd, since) {
  const out = since === null
    ? git(cwd, 'ls-files', '--', FRAGMENT_DIR)
    : git(cwd, 'diff', '--name-only', '--diff-filter=A', `${since}..HEAD`, '--', FRAGMENT_DIR);
  return out.split('\n').filter(isFragmentPath).sort();
}

/**
 * @param {string} cwd
 * @param {string | null} since
 * @returns {string[]}
 */
function titlesSince(cwd, since) {
  const range = since === null ? ['HEAD'] : [`${since}..HEAD`];
  return git(cwd, 'log', '--format=%s', ...range).split('\n').filter(Boolean);
}

/** @param {string} path */
function categoryOf(path) {
  return FRAGMENT_NAME_PATTERN.exec(path.split('/').pop() ?? '')?.groups?.category ?? '';
}

/**
 * 次の版。出すものが無ければ null。
 * @param {string} cwd
 * @returns {{ tag: string, previous: string | null, fragments: string[] } | null}
 */
export function nextRelease(cwd) {
  const previous = latestTag(cwd);
  const fragments = addedFragments(cwd, previous);
  if (fragments.length === 0) return null;
  const current = previous ? previous.slice(1) : BASELINE;
  const version = bumpFor(titlesSince(cwd, previous), fragments.map(categoryOf), current);
  return { tag: `v${version}`, previous, fragments };
}

/** @param {string} text */
function bodyOf(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/**
 * 断片 1 つの検査。問題を日本語の文で返す (無ければ空配列)。
 * @param {string} name ファイル名
 * @param {string} text 中身
 * @returns {string[]}
 */
export function lintFragment(name, text) {
  const errors = [];
  const match = FRAGMENT_NAME_PATTERN.exec(name);
  const known = SECTIONS.map(([category]) => category);
  if (!match) {
    errors.push(`${name}: 名前は <kebab-case の slug>.<分類>.md にする`);
  } else if (!(/** @type {readonly string[]} */ (known)).includes(match.groups?.category ?? '')) {
    errors.push(`${name}: 分類「${match.groups?.category}」は無い (使えるのは ${known.join(' / ')})`);
  }
  const body = bodyOf(text);
  if (!body) errors.push(`${name}: 本文が空`);
  for (const link of body.matchAll(INLINE_LINK_PATTERN)) {
    const target = link.groups?.target ?? '';
    if (!/^https?:\/\//.test(target)) {
      errors.push(`${name}: リンク「${target}」は絶対 URL にする (Release の本文では相対パスが壊れる)`);
    }
  }
  if (REFERENCE_LINK_PATTERN.test(body)) {
    errors.push(`${name}: 参照形式のリンク [文字][ラベル] は使わない (ノートで定義が切れる)`);
  }
  return errors;
}

/**
 * @param {string} cwd
 * @returns {string[]}
 */
export function lintAll(cwd) {
  const dir = join(cwd, FRAGMENT_DIR);
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'README.md')
      .map((entry) => entry.name);
  } catch {
    return [`${FRAGMENT_DIR}/ が無い`];
  }
  return names.sort().flatMap((name) => lintFragment(name, readFileSync(join(dir, name), 'utf-8')));
}

/**
 * Release の本文。分類ごとの見出しの下に、断片を 1 項目ずつ並べる。
 * @param {{ category: string, body: string }[]} entries
 * @param {{ repository?: string, previous?: string | null, tag?: string }} [context]
 * @returns {string}
 */
export function renderNotes(entries, context = {}) {
  const parts = [];
  for (const [category, heading] of SECTIONS) {
    const items = entries.filter((e) => e.category === category);
    if (items.length === 0) continue;
    // 段落が複数あっても 1 項目に収まるよう、2 行目以降をリストの中へ字下げする (空行は字下げしない)
    const listed = items.map((e) => bodyOf(e.body).split('\n')
      .map((line, i) => (i === 0 ? `- ${line}` : line && `  ${line}`)).join('\n'));
    parts.push(`## ${heading}\n\n${listed.join('\n')}`);
  }
  const { repository, previous, tag } = context;
  if (repository && previous && tag) {
    parts.push(`**差分**: https://github.com/${repository}/compare/${previous}...${tag}`);
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * PR が断片を伴うべきか、伴っているか。
 * @param {{ title: string, files: string[], labels: string[] }} pr
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkPullRequest({ title, files, labels }) {
  const match = TITLE_PATTERN.exec(title);
  const needs = Boolean(match && (match.groups?.breaking || TYPES_NEEDING_FRAGMENT.includes(match.groups?.type ?? '')));
  if (!needs) return { ok: true, reason: `「${title}」は断片が要らない type` };
  if (labels.includes(SKIP_LABEL)) return { ok: true, reason: `ラベル「${SKIP_LABEL}」で免除` };
  const fragments = files.filter(isFragmentPath);
  if (fragments.length > 0) return { ok: true, reason: `断片: ${fragments.join(', ')}` };
  return {
    ok: false,
    reason: `「${title}」は利用者から見える変更なので ${FRAGMENT_DIR}/<slug>.<分類>.md を 1 つ追加する `
      + `(書き方は ${FRAGMENT_DIR}/README.md)。利用者に見えない変更ならラベル「${SKIP_LABEL}」を付ける`,
  };
}

/** @param {string | undefined} value */
function lines(value) {
  return (value ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  const cwd = process.cwd();
  const command = process.argv[2];
  switch (command) {
    case 'next-version': {
      const next = nextRelease(cwd);
      if (!next) {
        console.error(`前回のタグ以降に ${FRAGMENT_DIR}/ の断片が増えていないので出さない`);
        process.exit(2);
      }
      console.log(next.tag);
      return;
    }
    case 'notes': {
      const next = nextRelease(cwd);
      if (!next) {
        console.error('出すものが無い');
        process.exit(2);
      }
      const entries = next.fragments.map((path) => ({
        category: categoryOf(path),
        body: readFileSync(join(cwd, path), 'utf-8'),
      }));
      process.stdout.write(renderNotes(entries, {
        repository: process.env.GITHUB_REPOSITORY, previous: next.previous, tag: next.tag,
      }));
      return;
    }
    case 'lint': {
      const errors = lintAll(cwd);
      for (const error of errors) console.error(`NG: ${error}`);
      if (errors.length > 0) process.exit(1);
      console.log(`OK: ${FRAGMENT_DIR}/ の断片はノートに組める`);
      return;
    }
    case 'check-pr': {
      const result = checkPullRequest({
        title: process.env.PR_TITLE ?? '', files: lines(process.env.PR_FILES), labels: lines(process.env.PR_LABELS),
      });
      console[result.ok ? 'log' : 'error'](`${result.ok ? 'OK' : 'NG'}: ${result.reason}`);
      if (!result.ok) process.exit(1);
      return;
    }
    default:
      console.error('使い方: node scripts/release.js <next-version | notes | lint | check-pr>');
      process.exit(64);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
