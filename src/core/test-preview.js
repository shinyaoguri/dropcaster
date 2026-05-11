#!/usr/bin/env node

import { chromium } from 'playwright';
import { resolve } from 'path';

const sketchName = process.argv[2] || 'sketch2257553';
const sketchPath = resolve(`./sketches/${sketchName}/index.html`);

console.log(`Testing preview generation for ${sketchName}...`);
console.log(`Path: ${sketchPath}`);

async function testPreview() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU,UseSkiaRenderer',
      '--use-angle=swiftshader',
      '--disable-vulkan-fallback-to-gl-for-testing',
      '--enable-webgpu-developer-features'
    ]
  });
  
  const page = await browser.newPage();
  
  // ビューポートサイズを設定
  await page.setViewportSize({
    width: 900,
    height: 900
  });
  
  // スケッチページを読み込み
  const fileUrl = `file://${sketchPath}`;
  console.log(`Loading: ${fileUrl}`);
  
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  
  // CSS注入
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
  
  // 初期化を待つ
  await page.waitForTimeout(1000);
  
  // Canvas情報を取得
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        exists: true
      };
    }
    return { exists: false };
  });
  
  console.log('Canvas info:', canvasInfo);
  
  // パフォーマンス測定
  console.log('\nMeasuring screenshot performance...');
  
  for (let i = 0; i < 5; i++) {
    const startTime = Date.now();
    
    try {
      await page.screenshot({
        type: 'png',
        clip: {
          x: 0,
          y: 0,
          width: 900,
          height: 900
        }
      });
      
      const elapsed = Date.now() - startTime;
      console.log(`Frame ${i + 1}: ${elapsed}ms`);
      
      await page.waitForTimeout(33); // ~30fps
    } catch (error) {
      console.error(`Frame ${i + 1} error:`, error.message);
    }
  }
  
  // レンダリング負荷を調査
  const renderingMetrics = await page.evaluate(() => {
    // スケッチの状態を確認
    if (typeof Obj !== 'undefined' && Array.isArray(Obj)) {
      return {
        objectCount: Obj.length,
        canvasSize: document.querySelector('canvas')?.width || 0
      };
    }
    return { objectCount: 0, canvasSize: 0 };
  });
  
  console.log('\nRendering metrics:', renderingMetrics);
  
  await browser.close();
}

testPreview().catch(console.error);