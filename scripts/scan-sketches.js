#!/usr/bin/env node

import { readdir, writeFile, stat, readFile } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { fetchUserDataForSketches } from './fetch-op-userdata.js';
import { analyzeSketch } from './modules/sketch-analyzer.js';
import { cleanupRemovedSketches, copySketchToPublic, ensureDirectoryExists } from './modules/file-manager.js';
import { generateSketchPreview } from './modules/preview-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const sketchesDir = resolve(__dirname, '../sketches');
const publicSketchesDir = resolve(__dirname, '../public/sketches');
const previewsDir = resolve(__dirname, '../public/previews');

/**
 * スケッチディレクトリをスキャンしてメタデータを生成
 */
async function scanSketches(options = {}) {
  const { generatePreviews = false, forceRegenerate = false, fetchUserData = false } = options;
  
  try {
    // 必要なディレクトリを作成
    await ensureDirectoryExists(sketchesDir, 'sketches directory');
    await ensureDirectoryExists(publicSketchesDir, 'public/sketches directory');
    
    if (generatePreviews) {
      await ensureDirectoryExists(previewsDir, 'public/previews directory');
    }
    
    const entries = await readdir(sketchesDir, { withFileTypes: true });
    const sketches = [];
    const currentSketchNames = new Set();
    const sketchIds = []; // ユーザー情報取得用のスケッチIDリスト
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        currentSketchNames.add(entry.name);
        const sketchPath = resolve(sketchesDir, entry.name);
        const sketchInfo = await analyzeSketch(entry.name, sketchPath);
        if (sketchInfo) {
          sketches.push(sketchInfo);
          
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
          
          // プレビューGIFを生成（オプション指定時のみ）
          if (generatePreviews) {
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
    
    // スケッチ情報を取得（オプション指定時のみ）
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
    
    // 結果を出力（stdoutにJSONのみ）
    console.log(JSON.stringify(sketches, null, 2));
    
    // スケッチデータ取得オプションが有効な場合は、sketches.jsonファイルも生成
    if (fetchUserData) {
      try {
        const sketchesJsonPath = resolve(__dirname, '../public/sketches.json');
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
  const generatePreviews = args.includes('--generate-previews');
  const forceRegenerate = args.includes('--force-regenerate');
  const fetchUserData = args.includes('--fetch-user-data');
  
  scanSketches({ generatePreviews, forceRegenerate, fetchUserData });
}

export { scanSketches };