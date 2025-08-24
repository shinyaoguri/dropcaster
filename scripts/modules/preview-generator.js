import { chromium } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { PREVIEW_OPTIONS, PREVIEW_PATH_PREFIX } from './config.js';

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
        stat(indexPath)
      ]);
      
      if (!forceRegenerate && previewStats.mtime >= indexStats.mtime) {
        console.error(`✓ ${sketchName} preview is up to date`);
        return `${PREVIEW_PATH_PREFIX}${sketchName}.gif`;
      }
    } catch (error) {
      // プレビューファイルが存在しない場合は生成する
    }
    
    console.error(`🎬 Generating animated preview for ${sketchName}...`);
    
    // 一時ディレクトリを作成
    await mkdir(tempDir, { recursive: true });
    
    // Playwrightでブラウザを起動
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--use-angle=vulkan',
        '--disable-vulkan-fallback-to-gl-for-testing'
      ]
    });
    
    const page = await browser.newPage();
    
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
    try {
      canvasBounds = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          return {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        }
        return null;
      });
    } catch (error) {
      console.warn(`Warning: Could not find canvas element for ${sketchName}, using full viewport`);
    }
    
    // フレームを連続キャプチャしてPNGファイルとして保存
    // 高速化版：フレーム数を削減して処理時間を短縮
    const frameCount = Math.floor((PREVIEW_OPTIONS.duration / 1000) * PREVIEW_OPTIONS.fps);
    const interval = 1000 / PREVIEW_OPTIONS.fps; // 正確なフレーム間隔（ミリ秒）
    
    for (let i = 0; i < frameCount; i++) {
      const screenshot = await page.screenshot({
        type: 'png',
        clip: canvasBounds || {
          x: 0,
          y: 0,
          width: PREVIEW_OPTIONS.width,
          height: PREVIEW_OPTIONS.height
        }
      });
      
      // フレームをファイルに保存（ゼロパディングで命名）
      const frameNumber = String(i).padStart(3, '0');
      const framePath = join(tempDir, `frame_${frameNumber}.png`);
      await writeFile(framePath, screenshot);
      
      await page.waitForTimeout(interval);
    }
    
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

async function generateAnimatedGIF(tempDir, outputPath, frameCount) {
  try {
    // FFmpegの存在確認
    try {
      await execAsync('ffmpeg -version');
    } catch (error) {
      throw new Error('FFmpeg is not installed or not available in PATH');
    }
    
    const gifPlaybackFps = 60;
    
    // GIF出力サイズ
    const outputWidth = 400;
    const outputHeight = Math.round((outputWidth / PREVIEW_OPTIONS.width) * PREVIEW_OPTIONS.height);
    
    // 高速化版：1段階処理でGIFを生成
    const scaleFilter = PREVIEW_OPTIONS.scaleFilter || 'fast_bilinear';
    const maxColors = PREVIEW_OPTIONS.maxColors || 128;
    
    const gifGenCmd = `ffmpeg -y -framerate ${PREVIEW_OPTIONS.fps} -i "${tempDir}/frame_%03d.png" -vf "scale=${outputWidth}:${outputHeight}:flags=${scaleFilter},fps=${gifPlaybackFps},split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=single[p];[s1][p]paletteuse=new=1" "${outputPath}"`;
    await execAsync(gifGenCmd);
    
    console.error(`✅ Generated animated GIF with ${frameCount} frames`);
    
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
