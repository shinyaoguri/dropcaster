import { OpenProcessingScraper } from './modules/scraper.js';
import { SCRAPING_CONFIG } from './modules/config.js';

/**
 * スケッチIDのリストからユーザー情報を取得
 * @param {string[]} sketchIds - スケッチIDの配列
 * @returns {Promise<Object[]>} ユーザー情報の配列
 */
export async function fetchUserDataForSketches(sketchIds, options = {}) {
  console.error(`🚀 fetchUserDataForSketches関数が呼び出されました`);
  console.error(`📋 受け取ったスケッチID: ${JSON.stringify(sketchIds)}`);
  
  const scraper = new OpenProcessingScraper(options);
  
  try {
    console.error(`🔧 OpenProcessing取得クライアントを初期化中...`);
    await scraper.init();
    console.error(`✅ OpenProcessing取得クライアント初期化完了`);
    console.error(`🚀 OpenProcessingから${sketchIds.length}件のスケッチのユーザー情報を取得中...`);
    
    const results = await scrapeMultipleSketches(sketchIds, scraper);
    
    console.error(`✅ 完了: ${results.length}件のスケッチを処理しました`);
    
    const uniqueUsers = new Set(results.filter(r => !r.error && r.userId).map(r => r.userId)).size;
    console.error(`📊 ユーザー統計:`);
    console.error(`   - 処理したスケッチ数: ${results.length}`);
    console.error(`   - ユニークユーザー数: ${uniqueUsers}`);
    
    // 結果をコンソールに出力
    console.error('\n=== 取得したスケッチ情報 ===');
    results.forEach((result, index) => {
      if (result.error) {
        console.error(`${index + 1}. スケッチID ${result.sketchId}: エラー - ${result.error}`);
      } else {
        console.error(`${index + 1}. スケッチID ${result.sketchId}:`);
        console.error(`   スケッチタイトル: ${result.sketchTitle}`);
        console.error(`   ユーザーID: ${result.userId}`);
        console.error(`   ユーザー名: ${result.userName}`);
        console.error(`   ユーザーURL: ${result.userUrl}`);
        console.error('');
      }
    });
    
    return results;
    
  } catch (error) {
    console.error('❌ メインエラー:', error);
    console.error('📚 エラーの詳細:', error.stack);
    return [];
  } finally {
    console.error(`🔧 OpenProcessing取得クライアントを終了中...`);
    await scraper.close();
    console.error(`✅ OpenProcessing取得クライアント終了完了`);
  }
}

/**
 * 複数のスケッチを処理
 */
async function scrapeMultipleSketches(sketchIds, scraper) {
  const results = [];
  
  for (const sketchId of sketchIds) {
    console.error(`\n--- スケッチ ${sketchId} を処理中 ---`);
    
    try {
      const sketchInfo = await scraper.getSketchUserInfo(sketchId);
      results.push(sketchInfo);
      
      // リクエスト間隔を空ける
      console.error(`⏱️ [${sketchId}] 次のリクエストまで待機中...`);
      await new Promise(resolve => setTimeout(resolve, SCRAPING_CONFIG.requestInterval));
      
    } catch (error) {
      console.error(`❌ [${sketchId}] 処理中にエラーが発生:`, error.message);
      results.push({ error: error.message, sketchId });
    }
  }
  
  return results;
}

