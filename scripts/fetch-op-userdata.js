import { OpenProcessingScraper } from './modules/scraper.js';
import { AvatarManager } from './modules/avatar-manager.js';
import { SCRAPING_CONFIG } from './modules/config.js';

/**
 * スケッチIDのリストからユーザー情報を取得
 * @param {string[]} sketchIds - スケッチIDの配列
 * @returns {Promise<Object[]>} ユーザー情報の配列
 */
export async function fetchUserDataForSketches(sketchIds) {
  console.error(`🚀 fetchUserDataForSketches関数が呼び出されました`);
  console.error(`📋 受け取ったスケッチID: ${JSON.stringify(sketchIds)}`);
  
  const scraper = new OpenProcessingScraper();
  const avatarManager = new AvatarManager();
  
  try {
    console.error(`🔧 ブラウザを初期化中...`);
    await scraper.init();
    console.error(`✅ ブラウザ初期化完了`);
    console.error(`🚀 OpenProcessingから${sketchIds.length}件のスケッチのユーザー情報を取得中...`);
    
    const results = await scrapeMultipleSketches(sketchIds, scraper, avatarManager);
    
    console.error(`✅ 完了: ${results.length}件のスケッチを処理しました`);
    
    // アバター画像の統計情報を出力
    const stats = avatarManager.getDownloadStats();
    const uniqueUsers = new Set(results.filter(r => !r.error && r.userId).map(r => r.userId)).size;
    console.error(`📊 ユーザー統計:`);
    console.error(`   - 処理したスケッチ数: ${results.length}`);
    console.error(`   - ユニークユーザー数: ${uniqueUsers}`);
    console.error(`   - ダウンロードしたアバター画像数: ${stats.totalDownloaded}`);
    console.error(`   - 重複回避による節約: ${results.length - stats.totalDownloaded}件`);
    
    // 結果をコンソールに出力
    console.log('\n=== 取得したスケッチ情報 ===');
    results.forEach((result, index) => {
      if (result.error) {
        console.log(`${index + 1}. スケッチID ${result.sketchId}: エラー - ${result.error}`);
      } else {
        console.log(`${index + 1}. スケッチID ${result.sketchId}:`);
        console.log(`   スケッチタイトル: ${result.sketchTitle}`);
        console.log(`   ユーザーID: ${result.userId}`);
        console.log(`   ユーザー名: ${result.userName}`);
        console.log(`   ユーザーURL: ${result.userUrl}`);
        console.log(`   アイコンURL: ${result.avatarUrl}`);
        if (result.avatarFile) {
          console.log(`   アイコンファイル: ${result.avatarFile}`);
        }
        console.log('');
      }
    });
    
    return results;
    
  } catch (error) {
    console.error('❌ メインエラー:', error);
    console.error('📚 エラーの詳細:', error.stack);
    return [];
  } finally {
    console.error(`🔧 ブラウザを終了中...`);
    await scraper.close();
    console.error(`✅ ブラウザ終了完了`);
  }
}

/**
 * 複数のスケッチを処理
 */
async function scrapeMultipleSketches(sketchIds, scraper, avatarManager) {
  const results = [];
  
  for (const sketchId of sketchIds) {
    console.error(`\n--- スケッチ ${sketchId} を処理中 ---`);
    
    try {
      const sketchInfo = await scraper.getSketchUserInfo(sketchId);
      
      if (!sketchInfo.error) {
        // アイコンをダウンロード（ユーザーIDベースで管理）
        const avatarFile = await avatarManager.downloadAvatar(
          sketchInfo.avatarUrl, 
          sketchInfo.userId, 
          sketchId
        );
        sketchInfo.avatarFile = avatarFile;
        
        // ダウンロード状況をログ出力
        if (avatarFile) {
          const avatarKey = sketchInfo.userId || `sketch_${sketchId}`;
          if (avatarManager.isAlreadyDownloaded(avatarKey)) {
            console.error(`♻️ [${sketchId}] アバター画像を再利用: ${avatarFile}`);
          } else {
            console.error(`✅ [${sketchId}] アバター画像を新規ダウンロード: ${avatarFile}`);
          }
        }
      }
      
      results.push(sketchInfo);
      
      // リクエスト間隔を空ける
      console.error(`⏱️ [${sketchId}] 次のリクエストまで待機中...`);
      await new Promise(resolve => setTimeout(resolve, SCRAPING_CONFIG.requestInterval));
      
    } catch (error) {
      console.error(`❌ [${sketchId}] 処理中にエラーが発生:`, error.message);
      results.push({ error: error.message, sketchId });
    }
  }
  
  // ダウンロード統計を出力
  const stats = avatarManager.getDownloadStats();
  console.error(`\n📊 アバター画像ダウンロード統計:`);
  console.error(`   - 総ダウンロード数: ${stats.totalDownloaded}`);
  console.error(`   - 重複回避による節約: ${sketchIds.length - stats.totalDownloaded}件`);
  
  return results;
}

// 使用例
async function main() {
  const scraper = new OpenProcessingScraper();
  const avatarManager = new AvatarManager();
  
  try {
    await scraper.init();
    
    // 単一のスケッチを処理
    const sketchId = '123456'; // 実際のスケッチIDに変更してください
    const sketchInfo = await scraper.getSketchUserInfo(sketchId);
    
    if (!sketchInfo.error) {
      console.log('取得した情報:');
      console.log('- スケッチタイトル:', sketchInfo.sketchTitle);
      console.log('- ユーザーID:', sketchInfo.userId);
      console.log('- ユーザー名:', sketchInfo.userName);
      console.log('- ユーザーURL:', sketchInfo.userUrl);
      console.log('- アイコンURL:', sketchInfo.avatarUrl);
      
      // アイコンをダウンロード
      await avatarManager.downloadAvatar(sketchInfo.avatarUrl, sketchInfo.userId, sketchId);
    } else {
      console.error('エラー:', sketchInfo.error);
    }
    
  } catch (error) {
    console.error('メインエラー:', error);
  } finally {
    await scraper.close();
  }
}

// スクリプトが直接実行された場合
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}

export default { fetchUserDataForSketches };
