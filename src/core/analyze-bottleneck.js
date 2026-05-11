#!/usr/bin/env node

import { chromium } from 'playwright';
import { resolve } from 'path';

const sketchName = process.argv[2] || 'sketch2257553';
const sketchPath = resolve(`./sketches/${sketchName}/index.html`);

console.log(`Analyzing bottleneck for ${sketchName}...`);

async function analyzeBottleneck() {
  // 複数の起動設定でテスト
  const configs = [
    {
      name: 'Default',
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
    },
    {
      name: 'Minimal GPU',
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    },
    {
      name: 'Force Software',
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ]
    }
  ];
  
  for (const config of configs) {
    console.log(`\n=== Testing with ${config.name} configuration ===`);
    
    const browser = await chromium.launch({
      headless: true,
      args: config.args
    });
    
    const page = await browser.newPage();
    await page.setViewportSize({ width: 900, height: 900 });
    
    const fileUrl = `file://${sketchPath}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    // 異なるスクリーンショット設定でテスト
    const screenshotOptions = [
      { name: 'PNG', type: 'png' },
      { name: 'JPEG', type: 'jpeg', quality: 80 },
      { name: 'PNG no clip', type: 'png', fullPage: true }
    ];
    
    for (const option of screenshotOptions) {
      const times = [];
      
      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();
        
        if (option.fullPage) {
          await page.screenshot({ type: option.type, fullPage: true });
        } else {
          await page.screenshot({
            type: option.type,
            quality: option.quality,
            clip: { x: 0, y: 0, width: 900, height: 900 }
          });
        }
        
        const elapsed = Date.now() - startTime;
        times.push(elapsed);
        await page.waitForTimeout(100);
      }
      
      const avg = Math.round(times.reduce((a, b) => a + b) / times.length);
      console.log(`  ${option.name}: ${times.join('ms, ')}ms (avg: ${avg}ms)`);
    }
    
    await browser.close();
  }
  
  // CDP直接アクセステスト
  console.log('\n=== Testing with CDP Protocol ===');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 900 });
  
  const fileUrl = `file://${sketchPath}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  // CDPセッションを取得
  const client = await page.context().newCDPSession(page);
  
  const times = [];
  for (let i = 0; i < 3; i++) {
    const startTime = Date.now();
    
    // CDP経由でスクリーンショット
    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: 0,
        y: 0,
        width: 900,
        height: 900,
        scale: 1
      }
    });
    
    const elapsed = Date.now() - startTime;
    times.push(elapsed);
    await page.waitForTimeout(100);
  }
  
  const avg = Math.round(times.reduce((a, b) => a + b) / times.length);
  console.log(`  CDP Direct: ${times.join('ms, ')}ms (avg: ${avg}ms)`);
  
  await browser.close();
}

analyzeBottleneck().catch(console.error);