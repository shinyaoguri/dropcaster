#!/usr/bin/env node

import { readdir, writeFile, stat, readFile, rm } from 'fs/promises';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { fetchUserDataForSketches } from './modules/op-api-client.js';
import { analyzeSketch } from './modules/sketch-analyzer.js';
import { cleanupRemovedSketches, copySketchToPublic, ensureDirectoryExists, fileExists } from './modules/file-manager.js';
import { generateSketchPreview } from './modules/preview-generator.js';
import { checkPreviewTools } from './check-env.js';
import { MANUAL_METADATA_FILE, MANUAL_METADATA_TEMPLATE_FILE } from './modules/constants.js';

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
    // 既存の sketches.json を読み込む（userData / title / previewGif を保持するため）
    let existingSketchList = [];
    const existingSketchData = {};
    const existingPreviewData = {};
    try {
      existingSketchList = JSON.parse(await readFile(sketchesJsonPath, 'utf-8'));
      existingSketchList.forEach(sketch => {
        existingSketchData[sketch.id] = {
          userData: sketch.userData,
          title: sketch.title,
          sketchUrl: sketch.sketchUrl,
          previewGif: sketch.previewGif,
        };
        if (sketch.previewGif) existingPreviewData[sketch.id] = sketch.previewGif;
      });
    } catch {
      // 無ければ新規作成
    }
    const existingSketches = new Set(existingSketchList.map(s => s.id));

    // プレビュー生成に必要なツール（FFmpeg / Chromium）が無ければスキップ（メタデータ収集は続行）
    let previewToolsOk = true;
    if (generatePreviews || watchMode) {
      const { ok, missing } = await checkPreviewTools();
      if (!ok) {
        previewToolsOk = false;
        console.error('\n⚠️  プレビュー GIF の生成に必要なツールが見つからないため、プレビュー生成をスキップします:');
        for (const item of missing) {
          console.error(`   ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
          if (item.hint) console.error(`     インストール方法: ${item.hint}`);
        }
        console.error('   （メタデータのスキャンとスケッチのコピーは続行します。状態は `dropcaster doctor` で確認できます）\n');
      }
    }

    // --reset: public/sketches と public/previews を一度まるごと削除してから作り直す
    // （userData / title を保持したいので public/sketches.json は残す。--sketch との併用時は全消ししない）
    if (reset && !targetSketch) {
      console.error('🧹 --reset: public/sketches と public/previews を削除して作り直します');
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
    const newSketches = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (targetSketch && entry.name !== targetSketch) continue;

      currentSketchNames.add(entry.name);
      const sketchPath = resolve(sketchesDir, entry.name);
      const sketchInfo = await analyzeSketch(entry.name, sketchPath);
      if (!sketchInfo) continue;

      // 既存の情報を復元（手動メタデータで明示指定されていないフィールドのみ）
      const existing = existingSketchData[entry.name];
      if (existing) {
        const manual = sketchInfo.__manualMetadataFields || new Set();
        if (existing.userData && !manual.has('userData')) sketchInfo.userData = existing.userData;
        if (existing.title && existing.title !== entry.name && !manual.has('title')) sketchInfo.title = existing.title;
        if (existing.sketchUrl && !manual.has('sketchUrl')) sketchInfo.sketchUrl = existing.sketchUrl;
        if (existing.previewGif && !manual.has('previewGif')) sketchInfo.previewGif = existing.previewGif;
      }

      sketches.push(sketchInfo);

      if (watchMode && !existingSketches.has(entry.name)) {
        newSketches.push(entry.name);
        console.error(`🆕 新しいスケッチを検出: ${entry.name}`);
      }

      // 数値（または "sketch" + 数値）のディレクトリ名は OpenProcessing のスケッチ ID とみなす
      if (/^\d+$/.test(entry.name)) sketchIds.push(entry.name);
      else if (entry.name.startsWith('sketch') && /^\d+$/.test(entry.name.slice('sketch'.length))) {
        sketchIds.push(entry.name.slice('sketch'.length));
      }

      await copySketchToPublic(entry.name, sketchPath, publicSketchesDir, forceRegenerate);

      const shouldGeneratePreview = previewToolsOk && (generatePreviews || (watchMode && newSketches.includes(entry.name)));
      if (shouldGeneratePreview) {
        try {
          const previewPath = await generateSketchPreview(entry.name, sketchPath, previewsDir, forceRegenerate);
          if (previewPath) sketchInfo.previewGif = previewPath;
        } catch (error) {
          console.warn(`Warning: ${entry.name} のプレビュー生成に失敗: ${error.message}`);
        }
      }
    }

    // 不要になった public ディレクトリのスケッチを削除する（全件走査したときだけ。--sketch では消さない）
    if (!targetSketch) {
      await cleanupRemovedSketches(currentSketchNames, publicSketchesDir, previewsDir);
    }

    // OpenProcessing Public API からタイトル・ユーザー情報を取得して統合
    if (fetchUserData && sketchIds.length > 0) {
      console.error(`🔍 OpenProcessing Public API からメタデータを取得中... (${sketchIds.length}件)`);
      try {
        const userDataResults = await fetchUserDataForSketches(sketchIds, fetchOptions);
        let updated = 0;
        let errors = 0;
        for (const userData of userDataResults) {
          if (userData.error) {
            await writeManualMetadataTemplate(userData.sketchId, userData.error);
            errors++;
            continue;
          }
          // 数値ID と "sketch" プレフィックス付きID の両方で照合
          const idx = sketches.findIndex(s => s.id === userData.sketchId || s.id === `sketch${userData.sketchId}`);
          if (idx === -1) continue;
          const manual = sketches[idx].__manualMetadataFields || new Set();
          if (!manual.has('title') && userData.sketchTitle && userData.sketchTitle !== 'Unknown Title') {
            sketches[idx].title = userData.sketchTitle;
          }
          if (!manual.has('userData')) {
            sketches[idx].userData = { userId: userData.userId, userName: userData.userName, userUrl: userData.userUrl };
          }
          if (!manual.has('sketchUrl')) {
            sketches[idx].sketchUrl = `https://openprocessing.org/sketch/${userData.sketchId.replace('sketch', '')}`;
          }
          updated++;
        }
        console.error(`   メタデータ統合: 成功 ${updated} / 失敗 ${errors} / 合計 ${userDataResults.length}`);
      } catch (error) {
        console.error(`❌ メタデータの取得に失敗しました: ${error.message}`);
      }
    }

    if (watchMode && newSketches.length > 0) {
      console.error(`📝 新規スケッチ ${newSketches.length} 件: ${newSketches.join(', ')}`);
    }

    // --sketch で 1 件だけ走査したときは、その 1 件を既存リストにマージする（他のスケッチを消さない）
    let outputSketches = sketches;
    if (targetSketch && existingSketchList.length > 0) {
      const scannedById = new Map(sketches.map(s => [s.id, s]));
      outputSketches = existingSketchList.map(s => scannedById.get(s.id) ?? s);
      const knownIds = new Set(existingSketchList.map(s => s.id));
      for (const s of sketches) if (!knownIds.has(s.id)) outputSketches.push(s);
    }

    const withUserData = outputSketches.filter(s => s.userData).length;
    console.error(`📋 ${outputSketches.length} 個のスケッチをスキャン（うち ${withUserData} 件にメタデータ）`);

    if (fetchUserData || writeFileOutput) {
      try {
        await writeFile(sketchesJsonPath, JSON.stringify(outputSketches, null, 2), 'utf-8');
        console.error(`💾 ${sketchesJsonPath} を生成`);
      } catch (error) {
        console.error(`❌ public/sketches.json の書き込みに失敗: ${error.message}`);
        process.exitCode = 1;
      }
    } else {
      // ファイル出力しない場合は stdout に JSON（パイプ用途）
      console.log(JSON.stringify(outputSketches, null, 2));
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
  console.error(`📝 OpenProcessing 取得失敗（${reason}）。手動メタデータ雛形を作成: ${sketchName}/${MANUAL_METADATA_TEMPLATE_FILE}`);
  console.error(`   ${MANUAL_METADATA_FILE} にリネームして値を埋めると次回 scan で反映されます`);
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
