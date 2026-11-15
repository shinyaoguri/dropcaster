// `dropcaster fetch <id>` — OpenProcessing 作品 ID からローカルの sketches/sketch<id>/
// 配下に既存のローカル sketch と同じ形式で書き出す。
// アセットは既定で同梱 (--no-assets で抑止)。
// `npm run scan` がそのまま処理できる形を吐く。

import { resolve, join } from 'path';
import { mkdir, writeFile, access, readdir, rm, stat } from 'fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { OpenProcessingApiClient } from '../../core/modules/op-api-client.js';
import { assembleLocalOpSketchHtml, planHtmlModeLocalFiles } from '../../core/modules/op-sketch-builder.js';
import {
  assetPathsForUrl,
  extractDeckardUrls,
  downloadAssets,
  rewriteCodeWithAssetMap,
} from '../../core/modules/asset-downloader.js';
import {
  isReplacementResidue,
  PreviousNotRestoredError,
  readPreviousMarker,
  removeReplacedPrevious,
  replaceDirectory,
  REPLACEMENT_MARKER_FILE,
} from '../../core/modules/directory-replacement.js';
import { getLatestMtime } from '../../core/modules/file-manager.js';
import { t } from '../i18n/index.js';

const SUPPORTED_MODES = ['p5js', 'html'];

// これより長く更新されていない staging は、中断した fetch の残骸とみなして開始時に消す。
// 新しいものは、同じ sketches/ で並行して走っている別の fetch が書き出し中かもしれない
const STALE_STAGING_MS = 60 * 60 * 1000;

/** --overwrite で、同梱できなかったアセットがあるときに投げる (既存の作品を差し替えない) */
class AssetDownloadError extends Error {
  /** @param {{ url: string, error: string }[]} failures */
  constructor(failures) {
    super(`${failures.length} asset(s) could not be downloaded`);
    this.name = 'AssetDownloadError';
    this.failures = failures;
  }
}

export async function fetchCommand(idArg, options = {}) {
  const projectRoot = process.cwd();
  const sketchesDir = resolve(projectRoot, options.output || 'sketches');

  const visualID = normalizeId(idArg);
  if (!/^\d+$/.test(visualID)) {
    console.error(chalk.red(`❌ ${t('fetch.invalidId', { id: `"${idArg}"` })}`));
    process.exit(1);
  }

  // 前回の fetch が異常終了・失敗して残した作業用ディレクトリを片付ける
  await removeLeftoverWorkDirectories(sketchesDir);

  const client = new OpenProcessingApiClient();

  const fetchSpin = ora(`Fetching sketch ${visualID} from OpenProcessing...`).start();
  let meta, codeTabs;
  try {
    [meta, codeTabs] = await Promise.all([
      client.getSketch(visualID),
      client.getSketchCode(visualID),
    ]);
  } catch (err) {
    fetchSpin.fail(`Failed to fetch sketch ${visualID}: ${err.message}`);
    process.exit(1);
  }
  fetchSpin.succeed(`Fetched "${meta.title || '(untitled)'}" by ${meta.username || 'unknown'}`);

  if (!SUPPORTED_MODES.includes(meta.mode)) {
    console.error(chalk.yellow(`⚠ ${t('fetch.modeNotSupported', { mode: meta.mode })}`));
    process.exit(1);
  }
  // タブが無い・全タブが空の作品は、空の作品で旧版を置き換えないよう検証で拒否する
  if (codeTabs.every((tab) => String(tab?.code ?? '').trim() === '')) {
    console.error(chalk.red(`❌ ${t('fetch.noCodeTabs')}`));
    process.exit(1);
  }

  const outDir = resolve(sketchesDir, `sketch${visualID}`);
  const existed = await pathExists(outDir);
  if (existed && !options.overwrite) {
    console.error(chalk.red(`❌ ${t('fetch.directoryExists', { dir: outDir })}`));
    console.error(chalk.yellow(`   ${t('fetch.useOverwrite')}`));
    process.exit(1);
  }

  // 取得内容の検証はファイルシステムに触れる前に済ませる (#167)。
  //   p5js: 各タブを .js に揃え、テンプレートの index.html から <script src> で参照する
  //   html: タブ構成がそのままファイル構成なので原形で書き出す (index タブ → index.html)。
  //         タブが実ファイルになるため、viewer 版のようなインライン展開や fetch shim は不要
  const sorted = [...codeTabs].sort((a, b) => (a.orderID ?? 0) - (b.orderID ?? 0));
  let htmlPlan = null;
  if (meta.mode === 'html') {
    try {
      htmlPlan = planHtmlModeLocalFiles({ codeTabs: sorted });
    } catch {
      console.error(chalk.red(`❌ ${t('fetch.noIndexTab')}`));
      process.exit(1);
    }
    for (const { from, to } of htmlPlan.renames) {
      console.log(chalk.yellow(`⚠ ${t('fetch.tabRenamed', { from, to })}`));
    }
  }

  // 新しい中身は兄弟の staging ディレクトリに組み立て、完成してから既存の作品と差し替える。
  // 途中で失敗しても既存の作品はそのまま残り、staging は消える (#167)。
  // --overwrite では、アセットを 1 件でも同梱できなければ差し替えない (旧版が同梱していたアセットを
  // CDN の参照に戻さないため)。新規の fetch は従来どおり、警告して CDN の URL のまま残す。
  let result;
  try {
    await mkdir(sketchesDir, { recursive: true });
    result = await replaceDirectory(outDir, (stagingDir) => writeSketch(stagingDir, {
      finalDir: outDir, visualID, meta, sortedTabs: sorted, htmlPlan, options,
      requireAllAssets: Boolean(options.overwrite),
    }));
  } catch (error) {
    if (error instanceof AssetDownloadError) {
      console.error(chalk.red(`❌ ${t('fetch.assetsFailed', { count: error.failures.length, dir: outDir })}`));
      for (const { url, error: cause } of error.failures) console.error(chalk.red(`   - ${url}: ${cause}`));
    } else {
      console.error(chalk.red(`❌ ${t('fetch.writeFailed', { dir: outDir, error: error?.message ?? String(error) })}`));
    }
    if (error instanceof PreviousNotRestoredError) {
      console.error(chalk.yellow(`   ${t('fetch.previousAt', { path: error.previousPath, dir: outDir, marker: REPLACEMENT_MARKER_FILE })}`));
    } else {
      console.error(chalk.yellow(`   ${t(existed ? 'fetch.existingKept' : 'fetch.nothingCreated')}`));
    }
    process.exit(1);
  }
  const { writtenFiles, assetCount } = result.value;
  if (result.leftover) {
    console.warn(chalk.yellow(`⚠ ${t('fetch.previousNotRemoved', {
      path: result.leftover.path,
      error: result.leftover.error?.message ?? String(result.leftover.error),
    })}`));
  }

  console.log();
  console.log(chalk.green(t('fetch.completed', { dir: `sketches/sketch${visualID}/` })));
  console.log(chalk.dim(`   ${writtenFiles.length} file(s) (incl. index.html), ${assetCount} asset(s), _op-meta.json`));
  console.log();
  console.log(chalk.cyan(t('fetch.nextSteps')));
  console.log(chalk.cyan(t('fetch.scanHint')));
  console.log(chalk.cyan(t('fetch.devHint')));
}

/**
 * 取得済み・検証済みの作品を、空のディレクトリ outDir (staging) に書き出す。
 * 失敗は例外で返す (呼び出し側の replaceDirectory が outDir を片付けるので、ここで process.exit しない)。
 * 表示するパスは staging ではなく、差し替え後の finalDir に読み替える。
 * @param {string} outDir
 * @param {{ finalDir: string, visualID: string, meta: any, sortedTabs: any[], htmlPlan: { files: { name: string, content: string }[] } | null, options: any, requireAllAssets: boolean }} input
 * @returns {Promise<{ writtenFiles: string[], assetCount: number }>}
 */
async function writeSketch(outDir, { finalDir, ...input }) {
  /** @param {string} text */
  const toFinalPath = (text) => String(text).split(outDir).join(finalDir);
  try {
    return await writeSketchFiles(outDir, { ...input, toFinalPath });
  } catch (error) {
    if (error instanceof Error) error.message = toFinalPath(error.message);
    throw error;
  }
}

/**
 * @param {string} outDir
 * @param {{ visualID: string, meta: any, sortedTabs: any[], htmlPlan: { files: { name: string, content: string }[] } | null, options: any, requireAllAssets: boolean, toFinalPath: (text: string) => string }} input
 * @returns {Promise<{ writtenFiles: string[], assetCount: number }>}
 */
async function writeSketchFiles(outDir, { visualID, meta, sortedTabs, htmlPlan, options, requireAllAssets, toFinalPath }) {
  // アセット同梱 (既定 ON、--no-assets で OFF)
  let assetMap = new Map();
  const assetUrls = extractDeckardUrls(sortedTabs);
  if (assetUrls.length > 0 && options.assets !== false) {
    const spin = ora(`Downloading ${assetUrls.length} external asset(s)...`).start();
    let okCount = 0;
    /** @type {{ url: string, error: string }[]} */
    const failures = [];
    assetMap = await downloadAssets(assetUrls, outDir, {
      onProgress: ({ url, size, error }) => {
        if (error) {
          const cause = toFinalPath(error);
          failures.push({ url, error: cause });
          spin.warn(`  ✗ ${url}: ${cause}`);
        } else { okCount++; spin.text = `Downloading external assets... (${okCount}/${assetUrls.length}, latest: ${humanSize(size)})`; }
      },
    });
    if (failures.length > 0 && requireAllAssets) {
      spin.fail(`Downloaded ${okCount}/${assetUrls.length} asset(s)`);
      throw new AssetDownloadError(failures);
    }
    spin.succeed(`Downloaded ${okCount}/${assetUrls.length} asset(s)`);
  } else if (assetUrls.length > 0 && options.assets === false) {
    console.log(chalk.yellow(`⚠ Skipping ${assetUrls.length} external asset(s) (--no-assets). The sketch will require network access to OpenProcessing CDN.`));
  }

  // code タブをファイルに書き出す。orderID 昇順。
  let writtenFiles;
  if (htmlPlan) {
    for (const file of htmlPlan.files) {
      const rewritten = rewriteCodeWithAssetMap(file.content, assetMap);
      await writeFile(join(outDir, file.name), rewritten, 'utf-8');
      if (options.verbose) console.log(chalk.green(`  ✓ ${file.name}`));
    }
    writtenFiles = htmlPlan.files.map(f => f.name);
  } else {
    const scriptFiles = [];
    const usedNames = new Set();
    for (const tab of sortedTabs) {
      // OP のタブ名は "mySketch.js" のように拡張子付きのことがあるので、
      // .js を二重に付けない（mySketch.js.js になっていた）
      const base = sanitizeFilename(tab.title || `tab${tab.orderID ?? scriptFiles.length}`)
        .replace(/\.js$/i, '') || 'untitled';
      let name = `${base}.js`;
      // 衝突回避 (同名タブが OP 上にあった場合に備える)
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${base}_${suffix}.js`;
        suffix++;
      }
      usedNames.add(name);
      const rewritten = rewriteCodeWithAssetMap(tab.code || '', assetMap);
      await writeFile(join(outDir, name), rewritten, 'utf-8');
      scriptFiles.push(name);
      if (options.verbose) console.log(chalk.green(`  ✓ ${name}`));
    }

    // index.html を書く (既存ローカル sketch と同じ形式)
    const html = assembleLocalOpSketchHtml({
      engineURL: meta.engineURL,
      libraries: meta.libraries,
      scriptFiles,
    });
    await writeFile(join(outDir, 'index.html'), html, 'utf-8');
    writtenFiles = [...scriptFiles, 'index.html'];
  }

  // _op-meta.json: scan が userData に流用できる、また再 fetch / 更新検出用
  const opMeta = {
    visualID,
    title: meta.title || '',
    description: meta.description || '',
    instructions: meta.instructions || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    license: meta.license || '',
    mode: meta.mode || '',
    engineURL: meta.engineURL || '',
    libraries: meta.libraries || [],
    fileBase: meta.fileBase || '',
    userID: meta.userID ?? '',
    username: meta.username || '',
    createdOn: meta.createdOn || '',
    updatedOn: meta.updatedOn || '',
    fetchedAt: new Date().toISOString(),
    sketchUrl: `https://openprocessing.org/sketch/${visualID}`,
    assetsBundled: assetMap.size,
  };
  await writeFile(join(outDir, '_op-meta.json'), JSON.stringify(opMeta, null, 2), 'utf-8');

  // 書き出したものが staging に揃っているか確かめる。書き出し中に staging が消されると
  // (並行する別の fetch の掃除など)、後の書き込みが作り直した staging に、消える前に書いた分が無い
  const expected = [
    ...[...assetMap.keys()].map((url) => assetPathsForUrl(url)?.filePath).filter(Boolean),
    ...writtenFiles,
    '_op-meta.json',
  ];
  const missing = [];
  for (const relativePath of expected) {
    if (!(await isFile(join(outDir, relativePath)))) missing.push(relativePath);
  }
  if (missing.length > 0) {
    throw new Error(`${missing.length} written file(s) disappeared before the sketch was put in place `
      + `(was the work directory removed by another fetch?): ${missing.join(', ')}`);
  }

  return { writtenFiles, assetCount: assetMap.size };
}

/** @param {string} path */
async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/**
 * sketches/ 直下の差し替えの作業用ディレクトリ (replaceDirectory の残骸) を片付ける。
 * - staging: 長く更新されていないもの (中断した fetch の残骸) だけを消す。新しいものは並行して走る
 *   別の fetch が書き出し中かもしれない。
 * - 退避した旧版 (.dc-previous-*): 印で「差し替えは済み、削除だけ失敗した」と確かめられたものだけを消す。
 *   戻せなかった旧版や印の無い旧版 (差し替えの途中で止まった) は作品の唯一の版かもしれないので、
 *   残して場所を伝える。
 * 消せなければ警告して続ける (次の fetch がまた試す)。
 * @param {string} sketchesDir
 */
async function removeLeftoverWorkDirectories(sketchesDir) {
  let entries;
  try {
    entries = await readdir(sketchesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!isReplacementResidue(entry.name)) continue;
    const path = join(sketchesDir, entry.name);
    try {
      if (entry.name.startsWith('.dc-staging-')) {
        if (Date.now() - (await getLatestMtime(path)).getTime() < STALE_STAGING_MS) continue;
        await rm(path, { recursive: true, force: true });
        continue;
      }
      const marker = await readPreviousMarker(path);
      if (marker?.reason === 'replaced') {
        await removeReplacedPrevious(path);
      } else if (marker?.reason === 'not-restored') {
        console.warn(chalk.yellow(`⚠ ${t('fetch.previousNotRestoredKept', {
          path, target: join(sketchesDir, marker.target), marker: REPLACEMENT_MARKER_FILE,
        })}`));
      } else {
        console.warn(chalk.yellow(`⚠ ${t('fetch.previousKeptForRecovery', { path })}`));
      }
    } catch (error) {
      console.warn(chalk.yellow(`⚠ ${t('fetch.leftoverNotRemoved', { path, error: error?.message ?? String(error) })}`));
    }
  }
}

function normalizeId(value) {
  return String(value ?? '').trim().replace(/^sketch/i, '');
}

function sanitizeFilename(s) {
  return String(s).trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}
