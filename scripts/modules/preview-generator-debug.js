import { chromium } from 'playwright';
import { resolve } from 'path';

/**
 * スケッチのパフォーマンスを分析
 */
export async function analyzeSketchPerformance(sketchPath) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const indexPath = resolve(sketchPath, 'index.html');
  const fileUrl = `file://${indexPath}`;
  
  console.log(`\n🔍 Analyzing: ${sketchPath}`);
  console.log('=' .repeat(50));
  
  // ページ読み込み時間を計測
  const loadStart = Date.now();
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  const loadTime = Date.now() - loadStart;
  console.log(`📄 Page load time: ${loadTime}ms`);
  
  // Canvas情報を取得
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    
    return {
      width: canvas.width,
      height: canvas.height,
      context: canvas.getContext ? 
        (canvas.getContext('webgl') ? 'webgl' : 
         canvas.getContext('webgl2') ? 'webgl2' : 
         canvas.getContext('2d') ? '2d' : 'unknown') : 'unknown',
      pixelCount: canvas.width * canvas.height
    };
  });
  
  if (canvasInfo) {
    console.log(`🖼️ Canvas: ${canvasInfo.width}x${canvasInfo.height} (${canvasInfo.context})`);
    console.log(`📊 Pixels: ${canvasInfo.pixelCount.toLocaleString()}`);
  }
  
  // スクリーンショット時間を計測（5フレーム）
  const screenshotTimes = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.screenshot({
      type: 'png',
      clip: canvasInfo ? {
        x: 0,
        y: 0,
        width: Math.min(canvasInfo.width, 1000),
        height: Math.min(canvasInfo.height, 1000)
      } : undefined
    });
    const time = Date.now() - start;
    screenshotTimes.push(time);
    await page.waitForTimeout(33); // 30fps
  }
  
  const avgScreenshotTime = screenshotTimes.reduce((a, b) => a + b, 0) / screenshotTimes.length;
  console.log(`📸 Avg screenshot time: ${avgScreenshotTime.toFixed(2)}ms`);
  
  // メモリ使用量を取得
  const metrics = await page.evaluate(() => {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize
      };
    }
    return null;
  });
  
  if (metrics) {
    console.log(`💾 Memory: ${(metrics.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB / ${(metrics.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
  }
  
  // p5.jsの情報を取得
  const p5Info = await page.evaluate(() => {
    if (typeof p5 !== 'undefined' && window._setupDone) {
      return {
        frameRate: frameRate(),
        frameCount: frameCount,
        renderer: window._renderer ? window._renderer.drawingContext.constructor.name : 'unknown'
      };
    }
    return null;
  });
  
  if (p5Info) {
    console.log(`🎮 p5.js: ${p5Info.frameRate.toFixed(1)}fps, frame ${p5Info.frameCount}, renderer: ${p5Info.renderer}`);
  }
  
  // パフォーマンス評価
  console.log('\n📈 Performance Assessment:');
  if (avgScreenshotTime < 50) {
    console.log('✅ Fast capture (< 50ms)');
  } else if (avgScreenshotTime < 150) {
    console.log('⚠️ Moderate capture (50-150ms)');
  } else {
    console.log('❌ Slow capture (> 150ms)');
  }
  
  if (canvasInfo?.context === 'webgl' || canvasInfo?.context === 'webgl2') {
    console.log('⚠️ WebGL detected - may be slower in headless mode');
  }
  
  if (canvasInfo?.pixelCount > 1000000) {
    console.log('⚠️ Large canvas - consider reducing resolution');
  }
  
  console.log('=' .repeat(50));
  
  await browser.close();
  
  return {
    loadTime,
    avgScreenshotTime,
    canvasInfo,
    metrics,
    p5Info
  };
}

// 使用例
if (import.meta.url === `file://${process.argv[1]}`) {
  const sketchPath = process.argv[2];
  if (!sketchPath) {
    console.error('Usage: node preview-generator-debug.js <sketch-path>');
    process.exit(1);
  }
  
  analyzeSketchPerformance(sketchPath);
}