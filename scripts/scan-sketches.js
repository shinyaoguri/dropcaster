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

/**
 * スケッチディレクトリをスキャンしてメタデータを生成
 */
async function scanSketches(options = {}) {
  const { 
    generatePreviews = false, 
    forceRegenerate = false, 
    fetchUserData = false,
    targetSketch = null,
    watchMode = false,
    incremental = false
  } = options;
  
  try {
    // watchModeまたはincrementalの場合、既存のスケッチリストを読み込む（ユーザー情報も含む）
    let existingSketches = new Set();
    let existingSketchData = {};
    let existingPreviewData = {};
    if (watchMode || incremental) {
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
    const sketchIds = []; // ユーザー情報取得用のスケッチIDリスト
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
          // watchModeまたはincrementalで既存の情報を復元
          if ((watchMode || incremental) && existingSketchData[entry.name]) {
            const existingData = existingSketchData[entry.name];
            if (existingData.userData) {
              sketchInfo.userData = existingData.userData;
            }
            if (existingData.title && existingData.title !== entry.name) {
              sketchInfo.title = existingData.title;
            }
            if (existingData.sketchUrl) {
              sketchInfo.sketchUrl = existingData.sketchUrl;
            }
            // 既存のプレビューがあれば使用
            if (existingData.previewGif) {
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
        const userDataResults = await fetchUserDataForSketches(sketchIds);
        console.error(`📊 取得結果: ${userDataResults.length}件`);
        console.error(`📄 結果の詳細:`, JSON.stringify(userDataResults, null, 2));
        
        // スケッチ情報にユーザーデータを統合
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        userDataResults.forEach((userData, index) => {
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
              
              // スケッチのタイトルを更新（HTMLから取得したタイトルがある場合）
              if (userData.sketchTitle && userData.sketchTitle !== 'Unknown Title') {
                sketches[sketchIndex].title = userData.sketchTitle;
                console.error(`📝 スケッチタイトルを更新: "${userData.sketchTitle}"`);
              }
              
              // 重複を避けるため、authorとuserDataを統合
              // authorフィールドは削除し、userDataのみを使用
              delete sketches[sketchIndex].author;
              delete sketches[sketchIndex].author_icon;
              delete sketches[sketchIndex].author_icon_local;
              
              // userDataオブジェクトを設定
              sketches[sketchIndex].userData = {
                userId: userData.userId,
                userName: userData.userName,
                userUrl: userData.userUrl,
                avatarUrl: userData.avatarUrl,
                avatarFile: userData.avatarFile
              };
              
              // オリジナルスケッチのURLを設定
              const sketchNumId = userData.sketchId.replace('sketch', '');
              sketches[sketchIndex].sketchUrl = `https://openprocessing.org/sketch/${sketchNumId}`;
              
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
            errorCount++;
          }
        });
        
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
    console.error(`   - アバター画像付き: ${sketches.filter(s => s.userData && s.userData.avatarFile).length}件`);
    
    // watchModeの場合は新規スケッチ情報を出力
    if (watchMode && newSketches.length > 0) {
      console.error(`\n📝 新規スケッチ ${newSketches.length} 件のプレビューを生成しました`);
      console.error(`   スケッチ: ${newSketches.join(', ')}`);
    }
    
    // 結果を出力（stdoutにJSONのみ）
    console.log(JSON.stringify(sketches, null, 2));
    
    // スケッチデータ取得オプションが有効な場合は、sketches.jsonファイルも生成
    if (fetchUserData) {
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
        const avatarCount = parsedContent.filter(s => s.userData && s.userData.avatarFile).length;
        const titleCount = parsedContent.filter(s => s.title && s.title !== s.id).length;
        
        console.error(`✅ ファイル内容確認: スケッチ${parsedContent.length}件, スケッチデータ${userDataCount}件, アバター画像${avatarCount}件, タイトル更新${titleCount}件`);
        
      } catch (error) {
        console.error(`❌ sketches.jsonファイルの生成に失敗:`, error.message);
      }
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
  
  // コマンドライン引数を解析（新旧両方のオプション名をサポート）
  const options = {
    // 新しいオプション名
    generatePreviews: args.includes('--force-preview') || args.includes('--generate-previews'),
    forceRegenerate: args.includes('--reset') || args.includes('--force-regenerate'),
    fetchUserData: args.includes('--fetch-userdata') || args.includes('--fetch-user-data'),
    watchMode: args.includes('--watch-mode'),
    incremental: args.includes('--incremental'),
    
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

export { scanSketches };