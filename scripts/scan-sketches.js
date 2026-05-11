#!/usr/bin/env node

import { readdir, writeFile, stat, readFile } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { fetchUserDataForSketches } from './fetch-op-userdata.js';
import { analyzeSketch } from './modules/sketch-analyzer.js';
import { cleanupRemovedSketches, copySketchToPublic, ensureDirectoryExists } from './modules/file-manager.js';
import { generateSketchPreview } from './modules/preview-generator.js';

// __filenameと__dirnameをローカルスコープで定義
const getDirectories = () => {
  const currentFilename = fileURLToPath(import.meta.url);
  const currentDirname = resolve(currentFilename, '..');

  // CLIから呼ばれた場合は環境変数からプロジェクトルートを取得
  const projectRoot = process.env.DROPCASTER_PROJECT_ROOT || resolve(currentDirname, '..');

  return {
    __dirname: currentDirname,
    projectRoot,
    sketchesDir: resolve(projectRoot, 'sketches'),
    publicSketchesDir: resolve(projectRoot, 'public/sketches'),
    previewsDir: resolve(projectRoot, 'public/previews')
  };
};

const { sketchesDir, publicSketchesDir, previewsDir } = getDirectories();
const MANUAL_METADATA_FILE = 'dropcaster.meta.json';
const MANUAL_METADATA_TEMPLATE_FILE = 'dropcaster.meta.example.json';

/**
 * スケッチディレクトリをスキャンしてメタデータを生成
 */
async function scanSketches(options = {}) {
  const {
    generatePreviews = false,
    forceRegenerate = false,
    fetchUserData: shouldFetchUserData = false,
    targetSketch = null,
    watchMode = false,
    incremental = false,
    writeFileOutput = false,
    fetchOptions = {}
  } = options;
  let fetchUserData = shouldFetchUserData;

  try {
    // 既存のスケッチリストを読み込む（ユーザー情報やプレビュー情報を保持するため）
    let existingSketches = new Set();
    let existingSketchData = {};
    let existingPreviewData = {};
    try {
      const { projectRoot } = getDirectories();
      const sketchesJsonPath = resolve(projectRoot, 'public/sketches.json');
      const existingData = await readFile(sketchesJsonPath, 'utf-8');
      const existingSketchList = JSON.parse(existingData);
      existingSketches = new Set(existingSketchList.map(s => s.id));
      // 既存のスケッチのユーザー情報とプレビュー情報を保存
      existingSketchList.forEach(sketch => {
        existingSketchData[sketch.id] = {
          userData: sketch.userData,
          title: sketch.title,
          sketchUrl: sketch.sketchUrl,
          previewGif: sketch.previewGif
        };
        if (sketch.previewGif) {
          existingPreviewData[sketch.id] = sketch.previewGif;
        }
      });
    } catch (error) {
      // ファイルが存在しない場合は空のセットのまま
      console.error(`ℹ️ sketches.jsonが存在しません。新規作成します。`);
    }

    // 必要なディレクトリを作成
    await ensureDirectoryExists(sketchesDir, 'sketches directory');
    await ensureDirectoryExists(publicSketchesDir, 'public/sketches directory');

    if (generatePreviews || watchMode) {
      await ensureDirectoryExists(previewsDir, 'public/previews directory');
    }

    const entries = await readdir(sketchesDir, { withFileTypes: true });
    const sketches = [];
    const currentSketchNames = new Set();
    let sketchIds = []; // ユーザー情報取得用のスケッチIDリスト
    const newSketches = []; // 新規検出されたスケッチ

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // targetSketchが指定されている場合、それ以外はスキップ
        if (targetSketch && entry.name !== targetSketch) {
          continue;
        }
        currentSketchNames.add(entry.name);
        const sketchPath = resolve(sketchesDir, entry.name);
        const sketchInfo = await analyzeSketch(entry.name, sketchPath);
        if (sketchInfo) {
          // 既存の情報を復元
          if (existingSketchData[entry.name]) {
            const existingData = existingSketchData[entry.name];
            const manualMetadataFields = sketchInfo.__manualMetadataFields || new Set();
            if (existingData.userData && !manualMetadataFields.has('userData')) {
              sketchInfo.userData = existingData.userData;
            }
            if (existingData.title && existingData.title !== entry.name && !manualMetadataFields.has('title')) {
              sketchInfo.title = existingData.title;
            }
            if (existingData.sketchUrl && !manualMetadataFields.has('sketchUrl')) {
              sketchInfo.sketchUrl = existingData.sketchUrl;
            }
            // 既存のプレビューがあれば使用
            if (existingData.previewGif && !manualMetadataFields.has('previewGif')) {
              sketchInfo.previewGif = existingData.previewGif;
            }
          }

          sketches.push(sketchInfo);

          // watchModeで新規スケッチを検出
          if (watchMode && !existingSketches.has(entry.name)) {
            newSketches.push(entry.name);
            console.error(`🆕 新しいスケッチを検出: ${entry.name}`);
          }

          // スケッチIDをリストに追加（数値の場合のみ）
          if (/^\d+$/.test(entry.name)) {
            sketchIds.push(entry.name);
            console.error(`🔢 数値スケッチIDを検出: ${entry.name}`);
          } else if (entry.name.startsWith('sketch') && /^\d+$/.test(entry.name.replace('sketch', ''))) {
            // "sketch"プレフィックスを除去して数値部分を抽出
            const numericId = entry.name.replace('sketch', '');
            sketchIds.push(numericId);
            console.error(`🔢 スケッチIDを検出: ${entry.name} -> ${numericId}`);
          } else {
            console.error(`ℹ️ 数値以外のスケッチ名: ${entry.name}`);
          }

          // スケッチをpublicディレクトリにコピー
          await copySketchToPublic(entry.name, sketchPath, publicSketchesDir, forceRegenerate);

          // プレビューGIFを生成（オプション指定時、watchModeで新規、またはincrementalでプレビューがない場合）
          const needsPreview = incremental && !existingPreviewData[entry.name];
          const shouldGeneratePreview = generatePreviews || (watchMode && newSketches.includes(entry.name)) || needsPreview;
          if (shouldGeneratePreview) {
            try {
              const previewPath = await generateSketchPreview(entry.name, sketchPath, previewsDir, forceRegenerate);
              if (previewPath) {
                sketchInfo.previewGif = previewPath;
                console.error(`🎬 Generated preview for ${entry.name}`);
              }
            } catch (error) {
              console.warn(`Warning: Failed to generate preview for ${entry.name}:`, error.message);
            }
          }
        }
      }
    }

    // 不要になったpublicディレクトリのスケッチを削除
    if (!forceRegenerate) {
      await cleanupRemovedSketches(currentSketchNames, publicSketchesDir, previewsDir);
    }

    // incrementalモードでユーザー情報がないスケッチのIDを収集
    let needsUserData = [];
    if (incremental) {
      needsUserData = sketchIds.filter(id => {
        const sketchName = `sketch${id}`;
        return !existingSketchData[sketchName] || !existingSketchData[sketchName].userData;
      });
      if (needsUserData.length > 0) {
        console.error(`🆕 ユーザー情報がないスケッチ: ${needsUserData.length}件`);
        fetchUserData = true;
        sketchIds = needsUserData;
      }
    }

    // スケッチ情報を取得（オプション指定時またはincrementalで必要な場合）
    if (fetchUserData && sketchIds.length > 0) {
      console.error(`\n🔍 スケッチIDからスケッチ情報を取得中... (${sketchIds.length}件)`);
      console.error(`📋 検出されたスケッチID: ${JSON.stringify(sketchIds)}`);

      try {
        console.error(`🚀 fetchUserDataForSketches関数を呼び出し中...`);
        const userDataResults = await fetchUserDataForSketches(sketchIds, fetchOptions);
        console.error(`📊 取得結果: ${userDataResults.length}件`);
        console.error(`📄 結果の詳細:`, JSON.stringify(userDataResults, null, 2));

        // スケッチ情報にユーザーデータを統合
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const [index, userData] of userDataResults.entries()) {
          console.error(`\n🔄 [${index + 1}/${userDataResults.length}] スケッチデータ処理中: ${userData.sketchId}`);
          console.error(`📋 スケッチデータ詳細:`, JSON.stringify(userData, null, 2));

          if (!userData.error) {
            // 数値IDとsketchプレフィックス付きIDの両方で検索
            let sketchIndex = sketches.findIndex(s => s.id === userData.sketchId);
            if (sketchIndex === -1) {
              // 数値IDで見つからない場合は、sketchプレフィックス付きで検索
              sketchIndex = sketches.findIndex(s => s.id === `sketch${userData.sketchId}`);
            }

            console.error(`🔍 スケッチ検索結果: ${userData.sketchId} -> index: ${sketchIndex}`);

            if (sketchIndex !== -1) {
              console.error(`✅ スケッチ情報を更新中: ${userData.sketchId}`);

              // 更新前の状態をログ出力
              console.error(`📝 更新前:`, JSON.stringify(sketches[sketchIndex], null, 2));
              const manualMetadataFields = sketches[sketchIndex].__manualMetadataFields || new Set();

              // スケッチのタイトルを更新（HTMLから取得したタイトルがある場合）
              if (!manualMetadataFields.has('title') && userData.sketchTitle && userData.sketchTitle !== 'Unknown Title') {
                sketches[sketchIndex].title = userData.sketchTitle;
                console.error(`📝 スケッチタイトルを更新: "${userData.sketchTitle}"`);
              }

              // 重複を避けるため、authorとuserDataを統合
              // authorフィールドは削除し、userDataのみを使用
              delete sketches[sketchIndex].author;
              delete sketches[sketchIndex].author_icon;
              delete sketches[sketchIndex].author_icon_local;

              // userDataオブジェクトを設定
              if (!manualMetadataFields.has('userData')) {
                sketches[sketchIndex].userData = {
                  userId: userData.userId,
                  userName: userData.userName,
                  userUrl: userData.userUrl
                };
              }

              // オリジナルスケッチのURLを設定
              const sketchNumId = userData.sketchId.replace('sketch', '');
              if (!manualMetadataFields.has('sketchUrl')) {
                sketches[sketchIndex].sketchUrl = `https://openprocessing.org/sketch/${sketchNumId}`;
              }

              // 更新後の状態をログ出力
              console.error(`📝 更新後:`, JSON.stringify(sketches[sketchIndex], null, 2));

              updatedCount++;
              console.error(`✅ 更新完了: ${userData.sketchId}`);
            } else {
              console.error(`❌ スケッチが見つかりません: ${userData.sketchId} (数値IDとsketchプレフィックス付きIDの両方で検索失敗)`);
              console.error(`🔍 利用可能なスケッチID:`, sketches.map(s => s.id));
              skippedCount++;
            }
          } else {
            console.error(`❌ スケッチデータエラー: ${userData.sketchId} - ${userData.error}`);
            await writeManualMetadataTemplate(userData.sketchId, userData.error);
            errorCount++;
          }
        }

        console.error(`\n📊 スケッチデータ統合結果:`);
        console.error(`   - 成功: ${updatedCount}件`);
        console.error(`   - スキップ: ${skippedCount}件`);
        console.error(`   - エラー: ${errorCount}件`);
        console.error(`   - 合計: ${userDataResults.length}件`);

        console.error(`✅ スケッチ情報の取得と統合が完了しました`);

        // 統合後のスケッチ情報を確認
        const sketchesWithUserData = sketches.filter(s => s.userData);
        console.error(`🔍 スケッチデータが統合されたスケッチ: ${sketchesWithUserData.length}件`);
        sketchesWithUserData.forEach(sketch => {
          console.error(`   - ${sketch.id}: "${sketch.title}" by ${sketch.userData.userName} (${sketch.userData.userId})`);
        });

      } catch (error) {
        console.error(`❌ スケッチ情報の取得に失敗しました:`, error.message);
        console.error(`📚 エラーの詳細:`, error.stack);
      }
    } else {
      if (!fetchUserData) {
        console.error(`ℹ️ スケッチ情報取得オプションが無効です`);
      }
      if (sketchIds.length === 0) {
        console.error(`ℹ️ 数値のスケッチIDが見つかりませんでした`);
      }
    }

    // 最終的なスケッチ情報の確認
    console.error(`\n📋 最終的なスケッチ情報確認:`);
    console.error(`   - 総スケッチ数: ${sketches.length}件`);
    console.error(`   - スケッチデータ統合済み: ${sketches.filter(s => s.userData).length}件`);

    // watchModeの場合は新規スケッチ情報を出力
    if (watchMode && newSketches.length > 0) {
      console.error(`\n📝 新規スケッチ ${newSketches.length} 件のプレビューを生成しました`);
      console.error(`   スケッチ: ${newSketches.join(', ')}`);
    }

    // CLI / npm scripts から呼ばれた場合（--write-file または --fetch-userdata）は
    // public/sketches.json を書き出す。それ以外（フィルタとして使う場合）は stdout に JSON を出す。
    if (fetchUserData || writeFileOutput) {
      try {
        const { projectRoot } = getDirectories();
        const sketchesJsonPath = resolve(projectRoot, 'public/sketches.json');
        await writeFile(sketchesJsonPath, JSON.stringify(sketches, null, 2), 'utf-8');
        console.error(`💾 sketches.jsonファイルを生成: ${sketchesJsonPath}`);

        // ファイルの内容確認
        const fileStats = await stat(sketchesJsonPath);
        console.error(`📊 ファイルサイズ: ${fileStats.size} bytes`);

        // 生成されたファイルの内容を確認
        const generatedContent = await readFile(sketchesJsonPath, 'utf-8');
        const parsedContent = JSON.parse(generatedContent);
        const userDataCount = parsedContent.filter(s => s.userData).length;
        const titleCount = parsedContent.filter(s => s.title && s.title !== s.id).length;

        console.error(`✅ ファイル内容確認: スケッチ${parsedContent.length}件, スケッチデータ${userDataCount}件, タイトル更新${titleCount}件`);
      } catch (error) {
        console.error(`❌ sketches.jsonファイルの生成に失敗:`, error.message);
        process.exitCode = 1;
      }
    } else {
      // ファイル出力しない場合のみ stdout に JSON を出す（フィルタ用途）
      console.log(JSON.stringify(sketches, null, 2));
    }

    return sketches;
  } catch (error) {
    console.error('Error scanning sketches:', error);
    process.exit(1);
  }
}

// スクリプトが直接実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed') || process.env.DROPCASTER_HEADED === '1';
  const externalBrowser = args.includes('--external-browser') || process.env.DROPCASTER_EXTERNAL_BROWSER === '1';
  const externalBrowserIntervalMs = Math.max(
    Number(getArgValue(args, '--external-browser-interval-ms') || process.env.DROPCASTER_EXTERNAL_BROWSER_INTERVAL_MS || 1000),
    1000
  );
  const apiRequestIntervalMs = Math.max(
    Number(getArgValue(args, '--api-request-interval-ms') || process.env.DROPCASTER_API_REQUEST_INTERVAL_MS || 1500),
    0
  );
  const apiToken = getArgValue(args, '--api-token') ||
    getArgValue(args, '--openprocessing-api-token') ||
    process.env.OPENPROCESSING_API_TOKEN ||
    process.env.OP_API_TOKEN ||
    process.env.DROPCASTER_OPENPROCESSING_API_TOKEN ||
    null;
  const browserProfile = getArgValue(args, '--browser-profile') || process.env.DROPCASTER_BROWSER_PROFILE || (headed ? '.dropcaster/browser-profile' : null);

  // コマンドライン引数を解析（新旧両方のオプション名をサポート）
  const options = {
    // 新しいオプション名
    generatePreviews: args.includes('--force-preview') || args.includes('--generate-previews'),
    forceRegenerate: args.includes('--reset') || args.includes('--force-regenerate'),
    fetchUserData: args.includes('--fetch-userdata') || args.includes('--fetch-user-data'),
    watchMode: args.includes('--watch-mode'),
    incremental: args.includes('--incremental'),
    writeFileOutput: args.includes('--write-file'),
    fetchOptions: {
      headed,
      externalBrowser,
      externalBrowserIntervalMs,
      apiRequestIntervalMs,
      apiToken,
      browserProfile,
      manualChallenge: args.includes('--manual-challenge') || headed || process.env.DROPCASTER_MANUAL_CHALLENGE === '1',
      challengeTimeoutMs: Number(getArgValue(args, '--challenge-timeout-ms') || process.env.DROPCASTER_CHALLENGE_TIMEOUT_MS || 180000)
    },

    // 特定のスケッチのみ処理
    targetSketch: null
  };

  // --sketch オプションの処理
  const sketchIndex = args.indexOf('--sketch');
  if (sketchIndex !== -1 && args[sketchIndex + 1]) {
    options.targetSketch = args[sketchIndex + 1];
  }

  scanSketches(options);
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

async function writeManualMetadataTemplate(sketchId, reason) {
  const sketchName = await findSketchDirectoryName(sketchId);
  if (!sketchName) {
    return;
  }

  const manualMetadataPath = resolve(sketchesDir, sketchName, MANUAL_METADATA_FILE);
  const templatePath = resolve(sketchesDir, sketchName, MANUAL_METADATA_TEMPLATE_FILE);

  if (await fileExists(manualMetadataPath) || await fileExists(templatePath)) {
    return;
  }

  const normalizedSketchId = String(sketchId || '').replace(/^sketch/, '');
  const template = {
    title: '',
    description: '',
    sketchUrl: normalizedSketchId ? `https://openprocessing.org/sketch/${normalizedSketchId}` : '',
    tags: [],
    interactiveElements: [],
    userData: {
      userId: '',
      userName: '',
      userUrl: ''
    }
  };

  await writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, 'utf-8');
  console.error(`📝 OpenProcessing取得失敗のため手動メタデータ雛形を作成: ${sketchName}/${MANUAL_METADATA_TEMPLATE_FILE}`);
  console.error(`   ${MANUAL_METADATA_FILE} にリネームして必要な値を埋めると、次回scanで反映されます`);
  console.error(`   取得エラー: ${reason}`);
}

async function findSketchDirectoryName(sketchId) {
  const normalizedSketchId = String(sketchId || '').trim();
  if (!normalizedSketchId) {
    return null;
  }

  const numericId = normalizedSketchId.replace(/^sketch/, '');
  const candidates = normalizedSketchId.startsWith('sketch')
    ? [normalizedSketchId, numericId]
    : [`sketch${normalizedSketchId}`, normalizedSketchId];

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      const stats = await stat(resolve(sketchesDir, candidate));
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch (error) {
      // 次の候補を確認する
    }
  }

  return null;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    return false;
  }
}

export { scanSketches };
