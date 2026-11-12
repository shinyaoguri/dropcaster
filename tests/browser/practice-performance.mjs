// Standalone measurement, deliberately not a CI frame-rate assertion.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({ configFile: resolve(root, 'apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForSelector('a[href="/mapping"]');
  await page.evaluate(async moduleBase => {
    const { ProjectionPreview } = await import(`${moduleBase}/practice/ProjectionPreview.ts`);
    const setState = ProjectionPreview.prototype.setState;
    ProjectionPreview.prototype.setState = function (...args) { window.measuredPreview = this; return setState.apply(this, args); };
  }, `/@fs${root}src/viewer`);
  await page.locator('a[href="/mapping"]').click();
  await page.locator('#preview-tab').click();
  await page.waitForSelector('#dc-practice-canvas');
  await page.locator('#mapping-tab').click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 1920);
  await page.waitForTimeout(1000); // warm up shaders and video decode before sampling
  const measures = [];
  for (const width of [640, 320]) {
    await page.locator('#practice-quality').selectOption(String(width));
    await page.evaluate(() => {
      window.samples = []; let last; window.sampling = true;
      function tick(time) {
        if (last !== undefined) window.samples.push(time - last);
        last = time; if (window.sampling) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const handle = await page.locator('[data-corner="topLeft"]').boundingBox();
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 0; i < 120; i++) await page.mouse.move(x + 30 * Math.sin(i / 12), y + 20 * Math.cos(i / 12));
    await page.mouse.up();
    measures.push(await page.evaluate(() => {
      window.sampling = false; const samples = window.samples;
      return { ...window.measuredPreview.diagnostics(), samples: samples.length,
        fps: 1000 * samples.length / samples.reduce((a, b) => a + b, 0),
        p95FrameMs: [...samples].sort((a, b) => a - b)[Math.floor(samples.length * .95)],
        source: [document.querySelector('#source-video').videoWidth, document.querySelector('#source-video').videoHeight] };
    }));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const result = { browser: browser.version(), platform: `${process.platform}/${process.arch}`, viewport: [1440, 900],
    operation: '120 pointer moves while dragging the existing top-left quad handle; static built-in 1080p source; 3D tab hidden and rendering paused', measures };
  console.log(JSON.stringify(result, null, 2));
  if (process.env.PRACTICE_PERFORMANCE_FILE) await writeFile(process.env.PRACTICE_PERFORMANCE_FILE, JSON.stringify(result, null, 2) + '\n');
  if (process.env.PRACTICE_SCREENSHOT) await page.screenshot({ path: process.env.PRACTICE_SCREENSHOT });
} finally { await browser.close(); await server.close(); }
