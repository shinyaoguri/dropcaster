import { chromium } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, rm, stat, copyFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PREVIEW_OPTIONS, PREVIEW_PATH_PREFIX } from './config.js';
import { detectGraphicsMode, getBrowserArgs } from './webgpu-detector.js';

const execAsync = promisify(exec);

/**
 * スケッチのプレビューGIFを生成（FFmpeg方式）
 */
export async function generateSketchPreview(sketchName, sketchPath, previewsDir, forceRegenerate = false) {
  const previewPath = join(previewsDir, `${sketchName}.gif`);
  const indexPath = join(sketchPath, 'index.html');
  const tempDir = join(previewsDir, `temp_${sketchName}`);
  
  try {
    // 既存のプレビューと更新日時を比較
    try {
      const [previewStats, indexStats] = await Promise.all([
        stat(previewPath),
        getLatestMtime(sketchPath)
      ]);
      
      if (!forceRegenerate && previewStats.mtime >= indexStats) {
        console.error(`✓ ${sketchName} preview is up to date`);
        return `${PREVIEW_PATH_PREFIX}${sketchName}.gif`;
      }
    } catch (error) {
      // プレビューファイルが存在しない場合は生成する
    }
    
    console.error(`🎬 Generating animated preview for ${sketchName}...`);
    
    // グラフィックスモードを検出
    const graphicsMode = await detectGraphicsMode(sketchPath);
    if (graphicsMode === 'standard') {
      console.error(`   ⚡ Standard rendering mode (faster)`);
    }
    
    // 一時ディレクトリを作成
    await mkdir(tempDir, { recursive: true });
    
    // グラフィックスモードに応じてブラウザを起動
    const browser = await chromium.launch({
      headless: true,
      args: getBrowserArgs(graphicsMode)
    });
    
    const page = await browser.newPage();

    // p5.sound は AudioWorklet を addModule() で読み込もうとするが、file:// 配信だと
    // 解決に失敗し、p5 内部の _preloadCount が 1 のまま残って setup() が永久に走らない
    // （preview は "Loading..." 画面のまま固まる）。preview は GIF で音は使わないので、
    // worklet load を no-op に置き換えて即 resolve させる。
    await page.addInitScript(() => {
      try {
        if (typeof AudioWorklet !== 'undefined' && AudioWorklet.prototype) {
          AudioWorklet.prototype.addModule = function () { return Promise.resolve(); };
        }
      } catch (_) { /* noop */ }
    });

    // ビューポートサイズを設定
    await page.setViewportSize({
      width: PREVIEW_OPTIONS.width,
      height: PREVIEW_OPTIONS.height
    });

    // スケッチページを読み込み
    const fileUrl = `file://${resolve(indexPath)}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle' });

    // CSS注入：余分なpadding/marginを除去
    await page.addStyleTag({
      content: `
        body { 
          margin: 0 !important; 
          padding: 0 !important; 
          background: transparent !important;
        }
        canvas {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
        }
      `
    });
    
    // スケッチの初期化を待つ
    await page.waitForTimeout(1000); // CSS適用のため少し長めに待機
    
    // Canvas要素を探してその位置とサイズを取得
    let canvasBounds = null;
    let isLargeCanvas = false;
    try {
      const canvasInfo = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          return {
            bounds: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            canvasWidth: canvas.width,
            canvasHeight: canvas.height
          };
        }
        return null;
      });
      
      if (canvasInfo) {
        canvasBounds = canvasInfo.bounds;
        // 600px以上のキャンバスは大きいと判定
        isLargeCanvas = canvasInfo.canvasWidth > 600 || canvasInfo.canvasHeight > 600;
        if (isLargeCanvas) {
          console.error(`   ⚠️ Large canvas detected (${canvasInfo.canvasWidth}x${canvasInfo.canvasHeight}px) - this may take longer`);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not find canvas element for ${sketchName}, using full viewport`);
    }
    
    // フレームを連続キャプチャしてPNGファイルとして保存
    // 高速化版：フレーム数を削減して処理時間を短縮
    const frameCount = Math.floor((PREVIEW_OPTIONS.duration / 1000) * PREVIEW_OPTIONS.fps);
    const interval = 1000 / PREVIEW_OPTIONS.fps; // 正確なフレーム間隔（ミリ秒）
    
    console.error(`📸 Capturing ${frameCount} frames for ${sketchName}...`);
    
    // タイムアウト対策とパフォーマンス監視を追加
    let skippedFrames = 0;
    const captureStartTime = Date.now();
    
    for (let i = 0; i < frameCount; i++) {
      const frameStartTime = Date.now();
      
      // 進捗状況を同じ行に表示（キャリッジリターンで上書き）
      const progress = Math.round(((i + 1) / frameCount) * 100);
      const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
      const elapsedSec = ((Date.now() - captureStartTime) / 1000).toFixed(1);
      process.stderr.write(`\r   Frame ${(i + 1).toString().padStart(3)}/${frameCount} [${progressBar}] ${progress.toString().padStart(3)}% (${elapsedSec}s)`);
      
      // スクリーンショットをタイムアウト付きで取得（最大2秒）
      const screenshotPromise = page.screenshot({
        type: 'png',
        clip: canvasBounds || {
          x: 0,
          y: 0,
          width: PREVIEW_OPTIONS.width,
          height: PREVIEW_OPTIONS.height
        }
      });
      
      // 大きなキャンバスの場合はタイムアウトを延長
      const timeoutDuration = isLargeCanvas ? 10000 : 5000;
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(null), timeoutDuration);
      });
      
      const screenshot = await Promise.race([screenshotPromise, timeoutPromise]);
      
      if (screenshot) {
        // フレームをファイルに保存（ゼロパディングで命名）
        const frameNumber = String(i).padStart(3, '0');
        const framePath = join(tempDir, `frame_${frameNumber}.png`);
        await writeFile(framePath, screenshot);
      } else {
        // タイムアウトした場合
        skippedFrames++;
        console.error(`\n⚠️ Frame ${i + 1} timed out after ${timeoutDuration/1000}s (skipped)`);
        // 前のフレームをコピー（連続性を保つ）
        if (i > 0) {
          const prevFrameNumber = String(i - 1).padStart(3, '0');
          const currFrameNumber = String(i).padStart(3, '0');
          const prevFramePath = join(tempDir, `frame_${prevFrameNumber}.png`);
          const currFramePath = join(tempDir, `frame_${currFrameNumber}.png`);
          try {
            await copyFile(prevFramePath, currFramePath);
          } catch (e) {
            // 最初のフレームがない場合は空のファイルを作成
            const emptyFrame = Buffer.from('');
            await writeFile(currFramePath, emptyFrame);
          }
        }
      }
      
      // 次のフレームまでの待機時間を計算
      const frameTime = Date.now() - frameStartTime;
      if (frameTime < interval) {
        await page.waitForTimeout(Math.max(10, interval - frameTime));
      }
      
      // 全体が30秒以上かかっている場合は警告
      if (Date.now() - captureStartTime > 30000 && i === Math.floor(frameCount / 2)) {
        console.error(`\n⚠️ Slow capture detected - ${sketchName} is taking too long`);
      }
    }
    
    // スキップされたフレームがある場合は警告
    if (skippedFrames > 0) {
      console.error(`\n⚠️ ${skippedFrames} frames were skipped due to timeout`);
    }
    
    // 最後に改行を出力して次の出力を正しく表示
    console.error();
    
    await browser.close();
    
    // FFmpegでアニメーションGIFを生成
    if (frameCount > 0) {
      await generateAnimatedGIF(tempDir, previewPath, frameCount);
      
      // 一時ディレクトリをクリーンアップ
      await rm(tempDir, { recursive: true, force: true });
      
      return `${PREVIEW_PATH_PREFIX}${sketchName}.gif`;
    }
    
    return null;
    
  } catch (error) {
    console.warn(`Warning: Failed to generate preview for ${sketchName}:`, error.message);
    
    // エラー時も一時ディレクトリをクリーンアップ
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      // クリーンアップエラーは無視
    }
    
    return null;
  }
}

async function getLatestMtime(path) {
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    return stats.mtime;
  }

  const { readdir } = await import('fs/promises');
  const entries = await readdir(path, { withFileTypes: true });
  const mtimes = await Promise.all(entries.map(async (entry) => {
    return getLatestMtime(join(path, entry.name));
  }));

  return mtimes.reduce((latest, current) => {
    return current > latest ? current : latest;
  }, stats.mtime);
}

async function generateAnimatedGIF(tempDir, outputPath, frameCount) {
  try {
    // FFmpegの存在確認
    try {
      await execAsync('ffmpeg -version');
    } catch (error) {
      throw new Error('FFmpeg is not installed or not available in PATH');
    }
    
    process.stderr.write(`🎬 Converting ${frameCount} frames to GIF...`);
    
    const gifPlaybackFps = 60;
    
    // GIF出力サイズ
    const outputWidth = 400;
    const outputHeight = Math.round((outputWidth / PREVIEW_OPTIONS.width) * PREVIEW_OPTIONS.height);
    
    // 高速化版：1段階処理でGIFを生成
    const scaleFilter = PREVIEW_OPTIONS.scaleFilter || 'fast_bilinear';
    const maxColors = PREVIEW_OPTIONS.maxColors || 128;
    
    const gifGenCmd = `ffmpeg -y -framerate ${PREVIEW_OPTIONS.fps} -i "${tempDir}/frame_%03d.png" -vf "scale=${outputWidth}:${outputHeight}:flags=${scaleFilter},fps=${gifPlaybackFps},split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=single[p];[s1][p]paletteuse=new=1" "${outputPath}" 2>/dev/null`;
    
    await execAsync(gifGenCmd);
    process.stderr.write(` ✅\n`);
    
  } catch (error) {
    // FFmpegが失敗した場合は最初のフレームをコピー（フォールバック）
    console.warn(`FFmpeg failed, using static image fallback: ${error.message}`);
    
    const firstFramePath = join(tempDir, 'frame_000.png');
    try {
      const firstFrame = await readFile(firstFramePath);
      await writeFile(outputPath, firstFrame);
      console.error(`📷 Generated static preview as fallback`);
    } catch (fallbackError) {
      throw new Error(`Both FFmpeg and fallback failed: ${fallbackError.message}`);
    }
  }
}
