// `dropcaster fetch <id>` — OpenProcessing 作品 ID からローカルの sketches/sketch<id>/
// 配下に既存のローカル sketch と同じ形式で書き出す。
// アセットは既定で同梱 (--no-assets で抑止)。
// `npm run scan` がそのまま処理できる形を吐く。

import { resolve, join } from 'path';
import { mkdir, writeFile, access, rm } from 'fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { OpenProcessingApiClient } from '../../core/modules/op-api-client.js';
import { assembleLocalOpSketchHtml } from '../../core/modules/op-sketch-builder.js';
import {
  extractDeckardUrls,
  downloadAssets,
  rewriteCodeWithAssetMap,
} from '../../core/modules/asset-downloader.js';
import { t } from '../i18n/index.js';

const SUPPORTED_MODES = ['p5js'];

export async function fetchCommand(idArg, options = {}) {
  const projectRoot = process.cwd();
  const sketchesDir = resolve(projectRoot, options.output || 'sketches');

  const visualID = normalizeId(idArg);
  if (!/^\d+$/.test(visualID)) {
    console.error(chalk.red(`❌ Invalid sketch ID: "${idArg}"`));
    process.exit(1);
  }

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
    console.error(chalk.yellow(`⚠ Mode "${meta.mode}" is not yet supported by dropcaster fetch (supported: ${SUPPORTED_MODES.join(', ')}).`));
    process.exit(1);
  }

  const outDir = resolve(sketchesDir, `sketch${visualID}`);
  if (await pathExists(outDir)) {
    if (!options.overwrite) {
      console.error(chalk.red(`❌ Directory already exists: ${outDir}`));
      console.error(chalk.yellow('   Use --overwrite to replace it.'));
      process.exit(1);
    }
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  // アセット同梱 (既定 ON、--no-assets で OFF)
  let assetMap = new Map();
  const assetUrls = extractDeckardUrls(codeTabs);
  if (assetUrls.length > 0 && options.assets !== false) {
    const spin = ora(`Downloading ${assetUrls.length} external asset(s)...`).start();
    let okCount = 0;
    assetMap = await downloadAssets(assetUrls, outDir, {
      onProgress: ({ url, size, error }) => {
        if (error) spin.warn(`  ✗ ${url}: ${error}`);
        else { okCount++; spin.text = `Downloading external assets... (${okCount}/${assetUrls.length}, latest: ${humanSize(size)})`; }
      },
    });
    spin.succeed(`Downloaded ${okCount}/${assetUrls.length} asset(s)`);
  } else if (assetUrls.length > 0 && options.assets === false) {
    console.log(chalk.yellow(`⚠ Skipping ${assetUrls.length} external asset(s) (--no-assets). The sketch will require network access to OpenProcessing CDN.`));
  }

  // code タブを別ファイルに書き出す。orderID 昇順。
  const sorted = [...codeTabs].sort((a, b) => (a.orderID ?? 0) - (b.orderID ?? 0));
  const scriptFiles = [];
  const usedNames = new Set();
  for (const tab of sorted) {
    const base = sanitizeFilename(tab.title || `tab${tab.orderID ?? scriptFiles.length}`);
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

  console.log();
  console.log(chalk.green(t('fetch.completed', { dir: `sketches/sketch${visualID}/` })));
  console.log(chalk.dim(`   ${scriptFiles.length} code file(s), ${assetMap.size} asset(s), index.html, _op-meta.json`));
  console.log();
  console.log(chalk.cyan(t('fetch.nextSteps')));
  console.log(chalk.cyan(t('fetch.scanHint')));
  console.log(chalk.cyan(t('fetch.devHint')));
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
