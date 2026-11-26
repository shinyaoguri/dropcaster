#!/usr/bin/env node

import { readdir, writeFile, stat, rm } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { fetchUserDataForSketches } from './modules/op-api-client.js';
import { analyzeSketch } from './modules/sketch-analyzer.js';
import { cleanupRemovedSketches, copySketchToPublic, ensureDirectoryExists, fileExists, isServableSketchCopy, readOptionalTextFile } from './modules/file-manager.js';
import { isReplacementResidue } from './modules/directory-replacement.js';
import { generateSketchPreview } from './modules/preview-generator.js';
import { checkPreviewTools } from './check-env.js';
import { DEFAULT_DESCRIPTION_SUFFIX, MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE } from './modules/constants.js';
import { t } from '../cli/i18n/index.js';

// プロジェクトルートの解決:
//   1. DROPCASTER_PROJECT_ROOT 環境変数（dropcaster CLI から呼ばれた場合に設定される）
//   2. それ以外（npm run scan / 直接実行）はカレントディレクトリ
// ※スクリプト自身の位置に依存させない（src/core/ に移動しても壊れないように）
const getDirectories = () => {
  const projectRoot = process.env.DROPCASTER_PROJECT_ROOT || process.cwd();
  return {
    projectRoot,
    sketchesDir: resolve(projectRoot, 'sketches'),
    publicSketchesDir: resolve(projectRoot, 'public/sketches'),
    previewsDir: resolve(projectRoot, 'public/previews'),
    sketchesJsonPath: resolve(projectRoot, 'public/sketches.json'),
  };
};

const { sketchesDir, publicSketchesDir, previewsDir, sketchesJsonPath } = getDirectories();

/**
 * sketches/ をスキャンして public/sketches/ にコピー、public/sketches.json を生成する。
 * オプション:
 *   generatePreviews   プレビュー GIF を生成する
 *   forceRegenerate    最新でも再コピー / 再生成する
 *   reset              public/sketches と public/previews を一度消してから作り直す
 *   fetchUserData      OpenProcessing Public API からタイトル・ユーザー情報を取得する
 *   targetSketch       指定したスケッチ 1 件だけ走査する（sketches.json は既存にマージ）
 *   watchMode          新規スケッチだけ検出してプレビュー生成（nodemon から）
 *   writeFileOutput    public/sketches.json に書き出す（指定しないと stdout に JSON）
 *   fetchOptions       { apiToken, apiRequestIntervalMs } を op-api-client へ渡す
 */
async function scanSketches(options = {}) {
  const {
    generatePreviews = false,
    forceRegenerate = false,
    reset = false,
    fetchUserData = false,
    targetSketch = null,
    watchMode = false,
    writeFileOutput = false,
    fetchOptions = {},
  } = options;

  try {
    // 既存の sketches.json を読み込む（userData / title / previewGif を保持するため）。
    // 無ければ新規作成。読めない・壊れているときは、何も変えずに失敗で止める (空として扱って書き出すと、
    // 前回の項目と userData などが黙って消えるため。--sketch では、ほかの作品の項目がすべて消える。#275)
    let existingSketchList;
    try {
      existingSketchList = await readExistingCatalog(sketchesJsonPath);
    } catch (error) {
      console.error(t('scan.catalogUnreadable', { error: error.message }));
      console.error(t('scan.catalogUnreadableHint'));
      process.exitCode = 1;
      return null;
    }
    const existingSketchData = {};
    const existingPreviewData = {};
    existingSketchList.forEach(sketch => {
      existingSketchData[sketch.id] = {
        userData: sketch.userData,
        title: sketch.title,
        description: sketch.description,
        sketchUrl: sketch.sketchUrl,
        previewGif: sketch.previewGif,
      };
      if (sketch.previewGif) existingPreviewData[sketch.id] = sketch.previewGif;
    });
    const existingSketches = new Set(existingSketchList.map(s => s.id));

    // プレビュー生成に必要なツール（FFmpeg / Chromium）が無ければスキップ（メタデータ収集は続行）
    let previewToolsOk = true;
    if (generatePreviews || watchMode) {
      const { ok, missing } = await checkPreviewTools();
      if (!ok) {
        previewToolsOk = false;
        console.error(t('scan.missingPreviewTools'));
        for (const item of missing) {
          console.error(`   ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
          if (item.hint) console.error(t('scan.missingPreviewToolsInstall', { hint: item.hint }));
        }
        console.error(t('scan.continueWithoutPreviews'));
      }
    }

    // --reset: public/sketches と public/previews を一度まるごと削除してから作り直す
    // （userData / title を保持したいので public/sketches.json は残す。--sketch との併用時は全消ししない）
    if (reset && !targetSketch) {
      console.error(t('scan.resetting'));
      await rm(publicSketchesDir, { recursive: true, force: true });
      await rm(previewsDir, { recursive: true, force: true });
    }

    await ensureDirectoryExists(sketchesDir, 'sketches directory');
    await ensureDirectoryExists(publicSketchesDir, 'public/sketches directory');
    if (previewToolsOk && (generatePreviews || watchMode)) {
      await ensureDirectoryExists(previewsDir, 'public/previews directory');
    }

    const entries = await readdir(sketchesDir, { withFileTypes: true });
    const sketches = [];
    const currentSketchNames = new Set();
    const sketchIds = []; // ユーザー情報取得用の数値スケッチID
    /** @type {string[]} sketchIds に載せた作品のディレクトリ名 */
    const fetchTargetNames = [];
    const newSketches = [];
    /** @type {string[]} index.html を読めない・解析できない作品 */
    const analysisFailures = [];
    /** @type {string[]} public へのコピーに失敗した作品 */
    const copyFailures = [];
    /** @type {Set<string>} 解析かコピーに失敗し、前回のカタログ項目も残せない作品 */
    const droppedSketchIds = new Set();

    /**
     * 解析かコピーに失敗した作品は、今回の内容でカタログに載せない（配信できる内容を確かめられないため）。
     * 前回配信できていた作品は、public に残っている前回のコピーと前回のカタログ項目を残す。
     * @param {string} name
     */
    const keepPreviousEntryOrDrop = async (name) => {
      const previous = existingSketchList.find(s => s.id === name);
      const keepPrevious = Boolean(previous) && await isServableSketchCopy(resolve(publicSketchesDir, name));
      if (keepPrevious) {
        sketches.push(previous);
        console.error(t('scan.failedKeptPrevious', { name }));
      } else {
        droppedSketchIds.add(name);
        console.error(t('scan.failedNotCataloged', { name }));
      }
    };

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 差し替えの作業用ディレクトリ (replaceDirectory の staging / 旧版) は作品ではない。
      // fetch が sketches/ に作り、異常終了や失敗で残ることがある (掃除は次の fetch の開始時)
      if (isReplacementResidue(entry.name)) continue;
      if (targetSketch && entry.name !== targetSketch) continue;

      const sketchPath = resolve(sketchesDir, entry.name);
      // index.html があるのに読めない・解析できない作品は、失敗として数える（黙って飛ばすと、
      // 前回の項目がカタログから消えたまま成功終了する）。失敗した作品は前回のコピーを残すので、
      // 下の cleanupRemovedSketches の対象から外す (currentSketchNames に入れる)。
      // index.html が無いディレクトリ (null) は作品ではないので、analyzeSketch の警告だけで飛ばす。
      // カタログに載らないので、全件走査では public の前回のコピーも消す (#275)
      let sketchInfo;
      try {
        sketchInfo = await analyzeSketch(entry.name, sketchPath);
      } catch (error) {
        currentSketchNames.add(entry.name);
        console.error(t('scan.analyzeFailed', { name: entry.name, error: error.message }));
        await keepPreviousEntryOrDrop(entry.name);
        analysisFailures.push(entry.name);
        continue;
      }
      if (!sketchInfo) continue;
      currentSketchNames.add(entry.name);

      // 既存の情報を復元（手動メタデータで明示指定されていないフィールドのみ）。
      // title / description は、作品のディレクトリの情報源 (手動メタデータ・_op-meta.json・HTML) の
      // どれにも値が無いときだけ戻す。今回の --fetch-userdata の値は後で上書きする (#115)
      const existing = existingSketchData[entry.name];
      if (existing) {
        const manual = sketchInfo.__manualMetadataFields || new Set();
        const explicit = sketchInfo.__explicitMetadataFields || new Set();
        if (existing.userData && !manual.has('userData')) sketchInfo.userData = existing.userData;
        restoreCatalogText(sketchInfo, existing, explicit);
        if (existing.sketchUrl && !manual.has('sketchUrl')) sketchInfo.sketchUrl = existing.sketchUrl;
        if (existing.previewGif && !manual.has('previewGif')) sketchInfo.previewGif = existing.previewGif;
      }

      const isNewInWatch = watchMode && !existingSketches.has(entry.name);
      if (isNewInWatch) {
        console.error(t('scan.newSketchDetected', { name: entry.name }));
      }

      // コピーできなかった作品も、解析の失敗と同じ扱いにする（今回の内容では載せず、前回のものを残す）
      try {
        await copySketchToPublic(entry.name, sketchPath, publicSketchesDir, forceRegenerate);
      } catch (error) {
        console.error(t('scan.copyFailed', { name: entry.name, error: error.message }));
        await keepPreviousEntryOrDrop(entry.name);
        copyFailures.push(entry.name);
        continue;
      }

      sketches.push(sketchInfo);
      if (isNewInWatch) newSketches.push(entry.name);

      // 数値（または "sketch" + 数値）のディレクトリ名は OpenProcessing のスケッチ ID とみなす
      if (/^\d+$/.test(entry.name)) {
        sketchIds.push(entry.name);
        fetchTargetNames.push(entry.name);
      } else if (entry.name.startsWith('sketch') && /^\d+$/.test(entry.name.slice('sketch'.length))) {
        sketchIds.push(entry.name.slice('sketch'.length));
        fetchTargetNames.push(entry.name);
      }

      const shouldGeneratePreview = previewToolsOk && (generatePreviews || (watchMode && newSketches.includes(entry.name)));
      if (shouldGeneratePreview) {
        try {
          const previewPath = await generateSketchPreview(entry.name, sketchPath, previewsDir, forceRegenerate);
          if (previewPath) sketchInfo.previewGif = previewPath;
        } catch (error) {
          console.warn(t('scan.previewFailed', { name: entry.name, error: error.message }));
        }
      }
    }

    // 不要になった public ディレクトリのスケッチを削除する（全件走査したときだけ。--sketch では消さない）
    if (!targetSketch) {
      await cleanupRemovedSketches(currentSketchNames, publicSketchesDir, previewsDir);
    }

    // OpenProcessing Public API からタイトル・ユーザー情報を取得して統合
    if (fetchUserData && sketchIds.length > 0) {
      console.error(t('scan.fetchingMetadata', { count: sketchIds.length }));
      const padTotal = String(sketchIds.length).length;
      /** @type {Set<string>} API から値を取れた作品 */
      const fetchedNames = new Set();
      try {
        const userDataResults = await fetchUserDataForSketches(sketchIds, {
          ...fetchOptions,
          onProgress: ({ index, total, sketchId, result }) => {
            const counter = `[${String(index).padStart(padTotal, ' ')}/${total}]`;
            if ('error' in result) {
              console.error(`   ${counter} sketch${sketchId} → ❌ ${result.error}`);
            } else {
              const author = result.userName || '(unknown)';
              const title = result.sketchTitle || '(untitled)';
              const desc = result.sketchDescription ? ' 📝' : '';
              console.error(`   ${counter} sketch${sketchId} → ${title} / ${author}${desc}`);
            }
          },
        });
        let updated = 0;
        let errors = 0;
        for (const userData of userDataResults) {
          if ('error' in userData) {
            await writeManualMetadataTemplate(userData.sketchId, userData.error);
            errors++;
            continue;
          }
          // 数値ID と "sketch" プレフィックス付きID の両方で照合
          const idx = sketches.findIndex(s => s.id === userData.sketchId || s.id === `sketch${userData.sketchId}`);
          if (idx === -1) continue;
          fetchedNames.add(sketches[idx].id);
          const manual = sketches[idx].__manualMetadataFields || new Set();
          if (!manual.has('title') && userData.sketchTitle && userData.sketchTitle !== 'Unknown Title') {
            sketches[idx].title = userData.sketchTitle;
          }
          if (!manual.has('description') && userData.sketchDescription) {
            sketches[idx].description = userData.sketchDescription;
          }
          if (!manual.has('userData')) {
            sketches[idx].userData = { userId: userData.userId, userName: userData.userName, userUrl: userData.userUrl };
          }
          if (!manual.has('sketchUrl')) {
            sketches[idx].sketchUrl = `https://openprocessing.org/sketch/${userData.sketchId.replace('sketch', '')}`;
          }
          updated++;
        }
        console.error(t('scan.metadataResult', { ok: updated, ng: errors, total: userDataResults.length }));
      } catch (error) {
        console.error(t('scan.metadataFetchFailed', { error: error.message }));
      }

      // 取得に失敗した作品 (404・通信の失敗・レート制限など) は、前回のカタログの title / description を
      // 保つ。前回 API から取った値を、汎用の <title> などで落とさないため (手動メタデータは除く)
      for (const name of fetchTargetNames) {
        if (fetchedNames.has(name)) continue;
        const sketchInfo = sketches.find(s => s.id === name);
        const existing = existingSketchData[name];
        if (!sketchInfo || !existing) continue;
        restoreCatalogText(sketchInfo, existing, sketchInfo.__manualMetadataFields || new Set());
      }
    }

    if (watchMode && newSketches.length > 0) {
      console.error(t('scan.newCount', { count: newSketches.length, names: newSketches.join(', ') }));
    }

    // --sketch で 1 件だけ走査したときは、その 1 件を既存リストにマージする（他のスケッチを消さない）
    let outputSketches = sketches;
    if (targetSketch && existingSketchList.length > 0) {
      const scannedById = new Map(sketches.map(s => [s.id, s]));
      outputSketches = existingSketchList
        .filter(s => !droppedSketchIds.has(s.id))
        .map(s => scannedById.get(s.id) ?? s);
      const knownIds = new Set(existingSketchList.map(s => s.id));
      for (const s of sketches) if (!knownIds.has(s.id)) outputSketches.push(s);
    }

    const withUserData = outputSketches.filter(s => s.userData).length;
    console.error(t('scan.scannedCount', { count: outputSketches.length, withMeta: withUserData }));

    if (fetchUserData || writeFileOutput) {
      try {
        await writeFile(sketchesJsonPath, JSON.stringify(outputSketches, null, 2), 'utf-8');
        console.error(t('scan.wroteJson', { path: sketchesJsonPath }));
      } catch (error) {
        console.error(t('scan.writeJsonFailed', { error: error.message }));
        process.exitCode = 1;
      }
    } else {
      // ファイル出力しない場合は stdout に JSON（パイプ用途）
      console.log(JSON.stringify(outputSketches, null, 2));
    }

    if (analysisFailures.length > 0) {
      console.error(t('scan.analyzeFailedSummary', { count: analysisFailures.length, names: analysisFailures.join(', ') }));
      process.exitCode = 1;
    }
    if (copyFailures.length > 0) {
      console.error(t('scan.copyFailedSummary', { count: copyFailures.length, names: copyFailures.join(', ') }));
      process.exitCode = 1;
    }

    return outputSketches;
  } catch (error) {
    console.error('Error scanning sketches:', error);
    process.exit(1);
  }
}

// スクリプトが直接実行された場合
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const sketchIndex = args.indexOf('--sketch');
  const options = {
    generatePreviews: args.includes('--force-preview') || args.includes('--generate-previews') || args.includes('--reset'),
    reset: args.includes('--reset'),
    forceRegenerate: args.includes('--reset') || args.includes('--force-regenerate'),
    fetchUserData: args.includes('--fetch-userdata') || args.includes('--fetch-user-data'),
    watchMode: args.includes('--watch-mode'),
    writeFileOutput: args.includes('--write-file'),
    targetSketch: sketchIndex !== -1 ? (args[sketchIndex + 1] || null) : null,
    fetchOptions: {
      apiToken: getArgValue(args, '--api-token') || getArgValue(args, '--openprocessing-api-token') || null,
      apiRequestIntervalMs: Number(getArgValue(args, '--api-request-interval-ms')) || undefined,
    },
  };
  scanSketches(options);
}

/**
 * 既存の public/sketches.json を読む。ファイルが無いときは空のリスト (新規作成)。
 * 読めない・JSON として壊れている・項目 (オブジェクト) の配列でないときは例外を投げる。
 * @param {string} path
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function readExistingCatalog(path) {
  const raw = await readOptionalTextFile(path);
  if (raw === null) return [];
  let parsed;
  try {
    // 先頭の BOM (Windows のメモ帳などが付ける) は JSON の一部ではないので除く
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`not valid JSON: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(parsed) || !parsed.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    throw new Error('expected a JSON array of sketch entries');
  }
  return parsed;
}

/**
 * 前回のカタログの title / description を戻す。前回の値が既定値 (ディレクトリ名 / 既定の説明文) なら戻さない。
 * @param {{ id: string, title: string, description: string }} sketchInfo
 * @param {{ title?: string, description?: string }} existing 前回のカタログの項目
 * @param {Set<string>} keep 今の値を保ち、戻さない項目
 */
function restoreCatalogText(sketchInfo, existing, keep) {
  if (existing.title && existing.title !== sketchInfo.id && !keep.has('title')) {
    sketchInfo.title = existing.title;
  }
  if (
    existing.description &&
    existing.description !== `${sketchInfo.id}${DEFAULT_DESCRIPTION_SUFFIX}` &&
    !keep.has('description')
  ) {
    sketchInfo.description = existing.description;
  }
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] || null);
}

// OpenProcessing API での取得に失敗したスケッチに、手で埋めるための雛形を置く（次回 scan で反映される）
async function writeManualMetadataTemplate(sketchId, reason) {
  const sketchName = await findSketchDirectoryName(sketchId);
  if (!sketchName) return;

  const manualMetadataPath = resolve(sketchesDir, sketchName, MANUAL_METADATA_FILE);
  const templatePath = resolve(sketchesDir, sketchName, MANUAL_METADATA_TEMPLATE_FILE);
  if (await fileExists(manualMetadataPath) || await fileExists(templatePath)) return;

  const numericId = String(sketchId || '').replace(/^sketch/, '');
  const template = {
    title: '',
    description: '',
    sketchUrl: numericId ? `https://openprocessing.org/sketch/${numericId}` : '',
    tags: [],
    interactiveElements: [],
    userData: { userId: '', userName: '', userUrl: '' },
  };
  await writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, 'utf-8');
  console.error(t('scan.manualTemplateCreated', { reason, path: `${sketchName}/${MANUAL_METADATA_TEMPLATE_FILE}` }));
  console.error(t('scan.manualTemplateRename', { file: MANUAL_METADATA_FILE }));
}

async function findSketchDirectoryName(sketchId) {
  const id = String(sketchId || '').trim();
  if (!id) return null;
  const numericId = id.replace(/^sketch/, '');
  const candidates = id.startsWith('sketch') ? [id, numericId] : [`sketch${id}`, id];
  for (const candidate of new Set(candidates.filter(Boolean))) {
    try {
      if ((await stat(resolve(sketchesDir, candidate))).isDirectory()) return candidate;
    } catch {
      // 次の候補を確認する
    }
  }
  return null;
}

export { scanSketches };
