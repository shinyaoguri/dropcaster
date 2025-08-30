import { chromium } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { PREVIEW_OPTIONS, PREVIEW_PATH_PREFIX } from './config.js';

const execAsync = promisify(exec);

/**
 * 高速版：スケッチのプレビューGIFを生成
 */
export async function generateSketchPreviewFast(sketchName, sketchPath, previewsDir, forceRegenerate = false) {
  const previewPath = join(previewsDir, `${sketchName}.gif`);
  const indexPath = join(sketchPath, 'index.html');
  const tempDir = join(previewsDir, `temp_${sketchName}`);
  
  try {
    // 既存のプレビューチェック（省略）
    try {
      const [previewStats, indexStats] = await Promise.all([
        stat(previewPath),
        stat(indexPath)
      ]);
      
      if (!forceRegenerate && previewStats.mtime >= indexStats.mtime) {
        console.error(`✓ ${sketchName} preview is up to date`);
        return `${PREVIEW_PATH_PREFIX}${sketchName}.gif`;
      }
    } catch (error) {
      // プレビューファイルが存在しない
    }
    
    console.error(`🎬 Generating preview for ${sketchName}...`);
    
    // 一時ディレクトリを作成
    await mkdir(tempDir, { recursive: true });
    
    // Playwrightでブラウザを起動（最適化オプション）
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        // メモリ制限を緩和
        '--max_old_space_size=4096',
        '--js-flags=--max_old_space_size=4096'
      ]
    });
    
    const context = await browser.newContext({
      // ビューポートを固定
      viewport: {
        width: PREVIEW_OPTIONS.width,
        height: PREVIEW_OPTIONS.height
      },
      // デバイススケールを1に固定（高DPIを無効化）
      deviceScaleFactor: 1
    });
    
    const page = await context.newPage();
    
    // パフォーマンス計測開始
    const startTime = Date.now();
    
    // スケッチページを読み込み
    const fileUrl = `file://${resolve(indexPath)}`;
    await page.goto(fileUrl, { 
      waitUntil: 'domcontentloaded',  // networkidleを待たない
      timeout: 10000
    });
    
    // p5.jsの初期化を待つ（より効率的な方法）
    await page.waitForFunction(() => {
      return typeof p5 !== 'undefined' && 
             window._setupDone === true;
    }, { timeout: 5000 }).catch(() => {
      console.warn(`Warning: p5.js setup timeout for ${sketchName}`);
    });
    
    // 初期フレームを少し待つ
    await page.waitForTimeout(500);
    
    // Canvas要素の位置とサイズを取得
    const canvasBounds = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        return {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.min(Math.round(rect.width), 1000),  // 最大1000pxに制限
          height: Math.min(Math.round(rect.height), 1000)
        };
      }
      return null;
    });
    
    // フレーム数とインターバルを計算
    const targetDuration = 2000;  // 2秒に短縮
    const targetFps = 20;  // 20fpsに削減
    const frameCount = Math.floor((targetDuration / 1000) * targetFps);
    const interval = 1000 / targetFps;
    
    console.error(`📸 Capturing ${frameCount} frames...`);
    
    // スクリーンショットをバッチで処理
    const screenshots = [];
    let lastProgressUpdate = Date.now();
    
    for (let i = 0; i < frameCount; i++) {
      const frameStart = Date.now();
      
      // 進捗表示（100ms以上経過時のみ更新）
      if (Date.now() - lastProgressUpdate > 100) {
        const progress = Math.round(((i + 1) / frameCount) * 100);
        const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        process.stderr.write(`\r   Frame ${(i + 1).toString().padStart(3)}/${frameCount} [${progressBar}] ${progress.toString().padStart(3)}%`);
        lastProgressUpdate = Date.now();
      }
      
      // スクリーンショット取得（タイムアウト付き）
      const screenshotPromise = page.screenshot({
        type: 'jpeg',  // PNGよりJPEGの方が高速
        quality: 80,
        clip: canvasBounds || {
          x: 0,
          y: 0,
          width: PREVIEW_OPTIONS.width,
          height: PREVIEW_OPTIONS.height
        }
      });
      
      // タイムアウト処理（1秒以上かかったらスキップ）
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(null), 1000);
      });
      
      const screenshot = await Promise.race([screenshotPromise, timeoutPromise]);
      
      if (screenshot) {
        screenshots.push({ index: i, data: screenshot });
      } else {
        console.warn(`\n⚠️ Frame ${i} timeout (skipped)`);
      }
      
      // 次のフレームまで待機（ただし最小限）
      const frameTime = Date.now() - frameStart;
      if (frameTime < interval) {
        await page.waitForTimeout(Math.max(10, interval - frameTime));
      }
      
      // メモリ使用量をチェック（10フレームごと）
      if (i % 10 === 0) {
        const metrics = await page.metrics();
        if (metrics.JSHeapUsedSize > 500 * 1024 * 1024) {  // 500MB以上
          console.warn(`\n⚠️ High memory usage: ${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(0)}MB`);
        }
      }
    }
    
    console.error();  // 改行
    
    // スクリーンショットを並列で保存
    console.error(`💾 Saving ${screenshots.length} frames...`);
    await Promise.all(screenshots.map(async ({ index, data }) => {
      const frameNumber = String(index).padStart(3, '0');
      const framePath = join(tempDir, `frame_${frameNumber}.jpg`);
      await writeFile(framePath, data);
    }));
    
    await browser.close();
    
    const totalTime = Date.now() - startTime;
    console.error(`⏱️ Capture completed in ${(totalTime / 1000).toFixed(1)}s`);
    
    // FFmpegでアニメーションGIFを生成
    if (screenshots.length > 0) {
      await generateAnimatedGIF(tempDir, previewPath, screenshots.length);
      
      // 一時ディレクトリをクリーンアップ
      await rm(tempDir, { recursive: true, force: true });
      
      return `${PREVIEW_PATH_PREFIX}${sketchName}.gif`;
    }
    
    return null;
    
  } catch (error) {
    console.error(`❌ Failed to generate preview for ${sketchName}:`, error.message);
    
    // エラー時も一時ディレクトリをクリーンアップ
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // クリーンアップエラーは無視
    }
    
    return null;
  }
}

async function generateAnimatedGIF(tempDir, outputPath, frameCount) {
  try {
    // FFmpegの存在確認
    try {
      await execAsync('ffmpeg -version');
    } catch (error) {
      throw new Error('FFmpeg is not installed');
    }
    
    process.stderr.write(`🎬 Converting to GIF...`);
    
    // 高速化版：より軽量なGIF生成
    const gifGenCmd = `ffmpeg -y -framerate 20 -i "${tempDir}/frame_%03d.jpg" -vf "scale=400:-1:flags=fast_bilinear,fps=20" -f gif "${outputPath}" 2>/dev/null`;
    
    await execAsync(gifGenCmd);
    process.stderr.write(` ✅\n`);
    
  } catch (error) {
    console.error(`\n❌ FFmpeg failed: ${error.message}`);
    throw error;
  }
}