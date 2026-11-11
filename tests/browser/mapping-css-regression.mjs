// Explicit browser check; npm test remains runnable without a Chromium install.
// Compare the actual OutputWindow with frozen pre-refactor CSS, on both Vite entries.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { fixtures } = JSON.parse(await readFile(new URL('../fixtures/mapping-css-baseline.json', import.meta.url), 'utf8'));
const artifactDir = process.env.MAPPING_ARTIFACT_DIR;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
});
let comparisons = 0;
// Decoding a frame does not mean Chrome's compositor has finished rasterizing
// the new CSS transform. Require stable painted pixels on both sides of the comparison.
async function paintedScreenshot(page) {
  let previous;
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const next = await page.screenshot({ animations: 'disabled' });
    if (previous?.equals(next)) return next;
    previous = next;
  }
  throw new Error('Output pixels did not stabilize');
}
try {
  for (const config of ['vite.config.ts', 'apps/web/vite.config.ts']) {
    const hosted = config.startsWith('apps/');
    const name = hosted ? 'hosted' : 'gallery';
    const server = await createServer({
      configFile: resolve(root, config),
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
      logLevel: 'error',
    });
    const context = await browser.newContext({ viewport: { width: 640, height: 480 }, serviceWorkers: 'block' });
    try {
      await server.listen();
      const address = server.httpServer.address();
      const page = await context.newPage();
      const errors = [];
      context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
      page.on('pageerror', error => errors.push(error.message));
      // Keep the entry smoke test independent of local catalogs and remote services.
      await context.route('**/sketches.json', route => route.fulfill({ json: [] }));
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.waitForSelector('input');
      const moduleUrl = hosted
        ? `/@fs${root}src/viewer/windows/output/OutputWindow.ts`
        : '/src/viewer/windows/output/OutputWindow.ts';
      const popupPromise = page.waitForEvent('popup');
      await page.evaluate(async url => {
        const { OutputWindow } = await import(url);
        const popup = window.open('', 'mapping-css-regression');
        const output = new OutputWindow('test-output');
        output.setWindow(popup);
        const style = popup.document.createElement('style');
        style.textContent = '.dc-output-ui { display: none !important; }';
        popup.document.head.appendChild(style);
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        const draw = () => {
          ctx.clearRect(0, 0, 320, 180);
          ctx.fillStyle = '#e02050'; ctx.fillRect(0, 0, 160, 90);
          ctx.fillStyle = '#20c080'; ctx.fillRect(160, 0, 160, 90);
          ctx.fillStyle = '#3060e0'; ctx.fillRect(0, 90, 160, 90);
          ctx.fillStyle = '#e0c030'; ctx.fillRect(160, 90, 160, 90);
          ctx.clearRect(90, 50, 40, 40);
          ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(180, 110, 60, 30);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          for (let x = 0; x < 320; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 180); ctx.stroke(); }
          for (let y = 0; y < 180; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(320, y); ctx.stroke(); }
          ctx.fillStyle = '#000'; ctx.font = 'bold 20px sans-serif'; ctx.fillText('TOP L', 10, 28); ctx.fillText('R', 280, 165);
        };
        draw();
        const stream = canvas.captureStream(0);
        window.mappingRegression = { output, popup, stream, draw };
      }, moduleUrl);
      const popup = await popupPromise;
      await popup.setViewportSize({ width: 640, height: 480 });
      const scenarios = fixtures.map(fixture => ({ fixture, side: 0 }));
      scenarios.push({ fixture: fixtures.find(f => f.name === 'spanning-outputs'), side: 1 });
      for (const { fixture, side } of scenarios) {
        for (const mode of ['single', 'layers']) {
          const comparisonName = `${name}-${fixture.name}-${side}-${mode}`;
          await page.evaluate(async ({ fixture, side, mode, base }) => {
            const { output, popup, stream, draw } = window.mappingRegression;
            const large = fixture.name === 'large-offset';
            const mapping = { id: 'foreground', source: fixture.source, quad: fixture.quad };
            const mask = { kind: 'mask', id: 'mask', points: [{ x: 80, y: 70 }, { x: 210, y: 90 }, { x: 150, y: 170 }] };
            const state = {
              version: 2, canvas: { width: fixture.width, height: fixture.height }, activeId: mapping.id,
              outputs: [{ id: 'test-output', position: { x: large ? 1920 : side * 320, y: large ? 1080 : 0 }, size: { width: large ? 1920 : 320, height: large ? 1080 : 240 } }],
              mappings: mode === 'single' ? [mapping] : [
                mask, mapping, { id: 'background', source: base.source, quad: base.quad },
                { ...mapping, id: 'disabled', enabled: false },
                { ...mask, id: 'draft', drafting: true },
              ],
            };
            output.setMappings(state);
            // Read IDs only to pair rendered children with baseline fixtures. Do not
            // infer IDs from DOM order: an off-output item may not have a child.
            const children = [...output.children.entries()];
            window.mappingRegression.state = state;
            window.mappingRegression.currentStyles = children.map(([id, child]) => ({ id, el: child.div }));
            await Promise.all(children.map(async ([, { video }]) => {
              video.srcObject = stream;
              const frame = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('No captured video frame within 10s')), 10000);
                video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
              });
              const playback = video.play();
              draw(); stream.getVideoTracks()[0].requestFrame();
              await playback;
              await frame;
            }));
          }, { fixture, side, mode, base: fixtures[0] });

          const current = await paintedScreenshot(popup);
          // Only transform/crop styles are replaced; masks, stream, DOM ordering,
          // clipping and output layout remain the real OutputWindow implementation.
          await page.evaluate(({ fixture, base, mode }) => {
            const { currentStyles } = window.mappingRegression;
            for (const child of currentStyles) {
              const f = child.id === 'background' ? base : fixture;
              child.el.style.transform = f.containerStyle.transform;
              child.el.style.visibility = f.containerStyle.visibility;
              Object.assign(child.el.querySelector('video').style, f.videoStyle);
            }
          }, { fixture, base: fixtures[0], mode });
          const baseline = await paintedScreenshot(popup);
          if (artifactDir && (!current.equals(baseline) || fixture.name === 'perspective')) {
            await writeFile(resolve(artifactDir, `${comparisonName}-current.png`), current);
            await writeFile(resolve(artifactDir, `${comparisonName}-baseline.png`), baseline);
          }
          assert.ok(current.equals(baseline), `${comparisonName}: rendered PNG differs from frozen CSS`);
          comparisons++;
        }
      }
      assert.deepEqual(errors, [], `${name}: browser errors`);
      await page.evaluate(() => {
        const { output, stream } = window.mappingRegression;
        output.close();
        stream.getTracks().forEach(track => track.stop());
      });
      console.log(`${name}: entry loaded; 32 output image comparisons passed`);
    } finally {
      await context.close();
      await server.close();
    }
  }
  console.log(`Chromium ${browser.version()}: ${comparisons} exact PNG comparisons passed`);
} finally {
  await browser.close();
}
