// Exercise the shipped UI (not a replacement harness) through both viewer entries.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { venueFixture } from '../fixtures/venue-glb.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifactDir = process.env.PRACTICE_ARTIFACT_DIR;
const entryButton = '#open-windows-btn, #mapping-btn';
const observedRequests = new WeakMap();
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
function sketchHtml(width = 640, color = '#dc9030', webgl = false, delay = 0) {
  return `<!doctype html><body><script>
    let frame; window.createCanvas = () => {
      cancelAnimationFrame(frame); document.querySelector('canvas')?.remove();
      const c = document.createElement('canvas'); c.width=${width};c.height=${width * 9 / 16};document.body.append(c);
      const x=c.getContext('${webgl ? 'webgl' : '2d'}');window.gl=${webgl ? 'x' : 'null'};
      function draw(){${webgl ? 'x.clearColor(0,1,0,1);x.clear(x.COLOR_BUFFER_BIT);'
        : `x.fillStyle='${color}';x.fillRect(0,0,c.width,c.height);x.fillStyle='#2262ad';for(let i=0;i<8;i++)x.fillRect(i*c.width/8,0,c.width/16,c.height);`}
        frame=requestAnimationFrame(draw)}draw();
    };addEventListener('load',()=>setTimeout(createCanvas,${delay}));
  </script>`;
}
const catalog = [
  { id: 'a', title: 'Striped wall', path: 'sketches/a/index.html' },
  { id: 'b', title: 'Blue srcdoc', path: '', srcdoc: sketchHtml(1280, '#33c4ec') },
  { id: 'w', title: 'WebGL', path: 'sketches/w/index.html' },
].map(s => ({ description: '', type: 'html', tags: [], interactiveElements: [], lastModified: '2026-11-11', ...s }));
async function setup(context, base, route = '/a', observePreview = true) {
  await context.route('**/sketches.json', r => r.fulfill({ json: catalog }));
  await context.route('**/sketches/a/index.html', r => r.fulfill({ contentType: 'text/html', body: sketchHtml() }));
  await context.route('**/sketches/w/index.html', r => r.fulfill({ contentType: 'text/html', body: sketchHtml(320, '', true, 100) }));
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const requests = []; page.on('request', r => requests.push(r.url()));
  await page.goto(base.url + route); await page.waitForSelector(entryButton);
  assert.ok(!requests.some(url => /three(?:\.js|\.module|_addons)|PracticePanel/.test(url)), '3D dependencies are lazy');
  observedRequests.set(page, requests);
  await observeControllers(page, base, observePreview);
  return page;
}
async function observeControllers(page, base, observePreview = true) {
  // Observe real controller/renderer instances through prototype instrumentation only in the test.
  await page.evaluate(async ({ moduleBase, observePreview }) => {
    const { WindowController } = await import(`${moduleBase}/components/WindowController.ts`);
    const acquire = WindowController.prototype.acquireStreamConsumer;
    WindowController.prototype.acquireStreamConsumer = function (...args) { window.practiceWC = this; return acquire.apply(this, args); };
    if (!observePreview) return;
    const { ProjectionPreview } = await import(`${moduleBase}/practice/ProjectionPreview.ts`);
    const setState = ProjectionPreview.prototype.setState;
    ProjectionPreview.prototype.setState = function (...args) { window.practicePreview = this; return setState.apply(this, args); };
  }, { moduleBase: base.modules, observePreview });
}
async function start(page, width = 640) {
  await page.locator(entryButton).click(); await page.locator('#preview-tab').click();
  await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(w => document.querySelector('#source-video')?.videoWidth === w && window.practicePreview?.diagnostics().memory.textures > 0, width);
  await page.waitForFunction(() => !document.querySelector('#dc-practice-status')?.textContent.includes('Preparing'));
}
async function change(page, selector, value) { await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab'); }
async function menuAction(page, id) {
  if (!await page.locator('#practice-menu').evaluate(e => e.open)) await page.locator('#practice-menu > summary').click();
  await page.locator(id).click();
}
async function projectControls(page) { await menuAction(page, '#practice-project'); }
async function addObject(page, kind) { await page.locator('#practice-object-kind').selectOption(kind); await page.locator('#practice-add-object').click(); }
async function exportProject(page) {
  await projectControls(page);
  const promise = page.waitForEvent('download'); await page.locator('#practice-export').click();
  const stream = await (await promise).createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function importProject(page, value) {
  await projectControls(page);
  await page.locator('#practice-project-file').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.waitForFunction(() => !document.querySelector('#dc-practice-status').textContent.includes('Loading venue'));
}
async function snapshot(page, name) { if (artifactDir) await page.screenshot({ path: resolve(artifactDir, name + '.png') }); }
async function state(page) { return page.evaluate(() => structuredClone(window.practiceWC.events.state.get())); }
async function workspace(page, base) {
  const isSlideshow = new URL(page.url()).pathname.endsWith('/slideshow');
  if (isSlideshow) await page.locator('#play-pause-btn').click();
  assert.equal(await page.locator('#practice-btn').count(), 0, 'one mapping entry');
  assert.equal(await page.locator(entryButton).locator('svg g rect').count(), 4, 'four mapping corners in both entry icons');
  await page.evaluate(() => {
    window.webglAttempts = 0; window.originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/.test(type)) { window.webglAttempts++; return null; }
      return window.originalGetContext.call(this, type, ...args);
    };
  });
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  assert.equal(await page.locator('#practice-venue').isVisible(), false, 'infrequent venue tools start inside the menu');
  await page.locator('#practice-menu > summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#practice-venue').isVisible(), true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#practice-venue').isVisible(), false);
  assert.equal(await page.locator('#practice-menu > summary').evaluate(e=>e===document.activeElement), true);
  await page.locator('#practice-menu > summary').click(); await page.locator('.source-column .column-header').click();
  assert.equal(await page.locator('#practice-venue').isVisible(), false, 'outside click dismisses settings');
  assert.equal(await page.locator('#mapping-tab').getAttribute('aria-selected'), 'true');
  await page.locator('#add-output-btn').click(); await page.locator('#add-mapping-btn').click();
  assert.equal(page.context().pages().length, 1, 'entering and adding outputs never opens a popup');
  assert.equal(await page.evaluate(() => window.webglAttempts), 0, '2D does not initialize WebGL');
  assert.ok(!observedRequests.get(page).some(url => /three(?:\.js|\.module|_addons)|PracticePanel/.test(url)), '2D does not load Three');
  assert.equal(await page.locator('#dc-practice-canvas').count(), 0);
  await page.evaluate(() => { window.workspaceTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; });
  const popupPromise = page.waitForEvent('popup'); await page.locator('#outputs-list .open-btn').first().click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth === 640));
  await popup.close(); await page.waitForTimeout(1200);
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true);
  assert.equal(await page.evaluate(() => window.workspaceTrack.readyState), 'live');
  const nextPopup = page.waitForEvent('popup'); await page.locator('#outputs-list .open-btn').first().click();
  const output = await nextPopup;
  await output.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth === 640));
  await page.locator('#practice-stop').click();
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
  assert.equal(await page.evaluate(() => window.workspaceTrack.readyState), 'live');
  const width = isSlideshow ? 1280 : 640;
  if (isSlideshow) await page.locator('#next-btn').click();
  await output.waitForFunction(w => [...document.querySelectorAll('video')].some(v => v.videoWidth === w && v.srcObject.getVideoTracks()[0].readyState === 'live'), width);
  await page.locator(entryButton).click();
  await page.waitForFunction(w => document.querySelector('#source-video')?.videoWidth === w, width);
  assert.equal(page.context().pages().length, 2, 'reopening editor does not open another output');
  await output.close(); await page.waitForTimeout(1200);
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true);
  await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.originalGetContext; });
  await observeControllers(page, base);
  const sourceBox = await page.locator('.source-column').boundingBox();
  let releasePanel, panelRequested;
  const pendingRequest = new Promise(resolve => { panelRequested = resolve; });
  await page.route('**/practice/PracticePanel.ts', async route => {
    panelRequested(); await new Promise(resolve => { releasePanel = resolve; }); await route.continue();
  });
  await page.locator('#preview-tab').click(); await pendingRequest;
  await page.locator('#mapping-tab').click(); releasePanel();
  await page.waitForSelector('#dc-practice-canvas', { state: 'attached' });
  assert.equal(await page.locator('#mapping-tab').getAttribute('aria-selected'), 'true', 'late 3D load preserves the selected tab');
  assert.equal(await page.locator('#dc-practice-canvas').isVisible(), false);
  await page.locator('#preview-tab').click(); await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(() => window.practicePreview?.diagnostics().memory.textures > 0);
  assert.equal(await page.locator('#preview-stage #dc-practice-canvas').count(), 1);
  assert.equal(await page.locator('.source-column #dc-practice-canvas').count(), 0);
  assert.equal((await page.locator('.source-column').boundingBox()).height, sourceBox.height);
  await page.locator('#practice-audience').click();
  await page.evaluate(() => {
    const preview = window.practicePreview;
    window.renderCount = 0; const render = preview.render.bind(preview);
    preview.render = () => { window.renderCount++; render(); };
  });
  await page.locator('#mapping-tab').click();
  const paused = await page.evaluate(() => window.renderCount);
  const camera = await page.evaluate(() => window.practicePreview.observer.position.toArray());
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.renderCount), paused, 'hidden preview stops rendering');
  const before = await state(page);
  await page.locator('#output-stage [data-corner]').first().click(); await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await state(page)).mappings, before.mappings, 'mapping still edits after visiting 3D');
  const edited = await state(page);
  await page.locator('#mapping-tab').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#layout-tab').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.locator('#preview-tab').getAttribute('aria-selected'), 'true');
  assert.deepEqual(await state(page), edited, 'tab navigation never nudges mappings');
  await page.waitForFunction(n => window.renderCount > n, paused);
  assert.deepEqual(await page.evaluate(() => window.practicePreview.observer.position.toArray()), camera, 'tab changes preserve the observer');
  assert.equal(await page.locator('.dc-tab-pane.is-active').count(), 1);
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('ja'), base.modules);
  assert.equal(await page.locator('#outputs-list .open-btn').first().innerText(), '開く');
  await snapshot(page, `${base.name}-workspace${isSlideshow ? '-slideshow' : ''}-desktop-ja`);
  await page.setViewportSize({ width:900, height:800 });
  await snapshot(page, `${base.name}-workspace${isSlideshow ? '-slideshow' : ''}-narrow-ja`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => { window.finalTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; });
  await page.locator('#practice-stop').click();
  assert.equal(await page.evaluate(() => window.finalTrack.readyState), 'ended');
}
async function lifecycle(page, base) {
  await start(page); assert.equal(page.context().pages().length, 1, 'practice needs no popup');
  const initial = await state(page);
  await page.evaluate(() => { window.firstPreview = window.practicePreview; window.firstTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; });
  const initialBackground = await page.locator('.dc-practice-background').getAttribute('src');
  const matrix = await page.evaluate(() => window.practicePreview.diagnostics().projectorMatrix);
  await page.locator('#practice-audience').click();
  const box = await page.locator('#dc-practice-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  await page.mouse.wheel(0, -100);
  assert.deepEqual(await page.evaluate(() => window.practicePreview.diagnostics().projectorMatrix), matrix);
  assert.equal(await page.locator('.dc-practice-background').getAttribute('src'), initialBackground, 'observer cannot move fixed background');
  assert.deepEqual(await state(page), initial, 'observer cannot alter mappings');
  await change(page, '#practice-p-position-0', 1.25); await change(page, '#practice-shift-0', 12);
  assert.notEqual(await page.locator('.dc-practice-background').getAttribute('src'), initialBackground, 'optics update the fixed background');
  await page.locator('#mapping-tab').click();
  await page.locator('#add-mapping-btn').click();
  const beforeEdit = await state(page);
  const handles = page.locator('#output-stage [data-corner]');
  await handles.first().click(); await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await state(page)).mappings[0].quad, beforeEdit.mappings[0].quad);
  const crop = await page.locator('#selection-box [data-handle="nw"]').boundingBox();
  await page.mouse.move(crop.x + crop.width / 2, crop.y + crop.height / 2); await page.mouse.down();
  await page.mouse.move(crop.x + 30, crop.y + 20, { steps: 3 }); await page.mouse.up();
  assert.ok((await state(page)).mappings[0].source.x > 0, 'existing crop handles still edit the source');
  const beforeMask = await page.evaluate(() => { const p=window.practicePreview; p.render(); return [...p.compositor.readPixels()].reduce((a,b)=>a+b,0); });
  await page.locator('#add-mask-btn').click();
  const stage = await page.locator('#output-stage .dc-canvas-host').boundingBox();
  for (const [x,y] of [[.35,.35],[.65,.35],[.5,.65]]) await page.mouse.click(stage.x + stage.width*x, stage.y + stage.height*y);
  await page.keyboard.press('Enter');
  const mask = (await state(page)).mappings.find(m => m.kind === 'mask');
  assert.equal(mask.points.length, 3); assert.ok(!mask.drafting);
  const afterMask = await page.evaluate(() => { const p=window.practicePreview; p.render(); return [...p.compositor.readPixels()].reduce((a,b)=>a+b,0); });
  assert.ok(afterMask < beforeMask, 'existing mask editing updates the real GPU composite');
  await page.evaluate(async base => (await import(`${base}/i18n/index.ts`)).setLang('ja'), base.modules);
  assert.equal(await page.locator('#practice-stop').getAttribute('aria-label'), '編集を閉じる');
  await menuAction(page, '#practice-settings'); await snapshot(page, base.name + '-desktop-ja');
  await page.setViewportSize({ width: 900, height: 800 }); await snapshot(page, base.name + '-narrow-ja');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  const popupPromise = page.waitForEvent('popup'); await page.locator('#outputs-list .open-btn').first().click(); const popup = await popupPromise;
  await popup.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth === 640));
  assert.equal(await popup.locator('.dc-practice-background, #dc-practice-canvas').count(), 0, 'editor background never appears in real output');
  await popup.close(); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.firstTrack.readyState), 'live', 'closing last output preserves practice');
  const popupPromise2 = page.waitForEvent('popup'); await page.locator('#outputs-list .open-btn').first().click(); const popup2 = await popupPromise2;
  await page.locator('#practice-stop').click();
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => ({ track: window.firstTrack.readyState, disposed: window.firstPreview.diagnostics().disposed })), { track: 'live', disposed: true });
  await popup2.close(); await page.waitForFunction(() => window.firstTrack.readyState === 'ended');
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
  for (let i = 0; i < 3; i++) {
    await start(page);
    assert.equal(await page.locator('#practice-p-position-0').inputValue(), '1.25');
    await page.evaluate(() => { window.lastTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; window.lastPreview = window.practicePreview; });
    await page.locator('#practice-stop').click();
    assert.deepEqual(await page.evaluate(() => ({ track: window.lastTrack.readyState, disposed: window.lastPreview.diagnostics().disposed })), { track: 'ended', disposed: true });
  }
}
async function projects(page, base) {
  await start(page); await projectControls(page); await change(page, '#practice-project-name', 'Tour wall');
  await change(page, '#practice-fov', 50); await change(page, '#practice-shift-1', -7);
  await page.locator('#practice-glb-file').setInputFiles({ name: 'wall.glb', mimeType: 'model/gltf-binary', buffer: venueFixture() });
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.startsWith('Venue loaded'));
  assert.equal(await page.locator('#practice-dimensions').textContent(), 'Venue size: 6.00 × 4.00 × 0.00 m');
  assert.equal(await page.evaluate(() => window.practicePreview.diagnostics().venueTriangles), 2);
  await page.evaluate(() => {
    const p = window.practicePreview;
    window.importedMaterials = [];
    p.scene.traverse(o => { if (o.isMesh && o.material.uniforms?.baseMap) window.importedMaterials.push(o.material); });
  });
  assert.equal(await page.evaluate(() => window.importedMaterials.length), 1, 'embedded image reaches the venue shader');
  assert.deepEqual(await page.evaluate(() => window.importedMaterials[0].uniforms.baseColor.value.toArray()), [0.7, 0.8, 0.9]);
  await page.locator('details:has(#practice-venue-form) > summary').click();
  await change(page, '#practice-v-scale-0', 2);
  await projectControls(page); await page.locator('#practice-save').click();
  await page.waitForFunction(() => document.querySelector('#practice-saved-projects').options.length === 1);
  const saved = await exportProject(page); assert.equal(saved.assets.length, 1); assert.equal(saved.venue.scene.scale[0], 2);
  await page.locator('#practice-duplicate').click(); await page.waitForFunction(() => document.querySelector('#practice-saved-projects').options.length === 2);
  const baseline = await exportProject(page);
  for (const bad of [ { ...baseline, schemaVersion: 99 },
    { ...baseline, assets: [] }, { ...baseline, show: { ...baseline.show, contentIds: ['missing'] } },
    { ...baseline, assets: [{ ...baseline.assets[0], data: Buffer.from('broken').toString('base64') }] } ]) {
    await importProject(page, bad);
    assert.equal(await page.locator('#dc-practice-status').evaluate(e => e.classList.contains('is-error')), true);
    assert.deepEqual(await exportProject(page), baseline, 'failed import cannot mutate project');
  }
  // GPU/scene parse failures after JSON validation must also be transactional.
  await page.locator('#practice-glb-file').setInputFiles({ name: 'empty.glb', mimeType: 'model/gltf-binary', buffer: venueFixture(d => { d.scenes[0].nodes = []; }) });
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').classList.contains('is-error'));
  assert.deepEqual(await exportProject(page), baseline);
  const legacy = baseline.venue.layout; legacy.mappings[0].name = 'Legacy loaded';
  await importProject(page, legacy); assert.equal((await state(page)).mappings[0].name, 'Legacy loaded');
  await page.locator('#practice-undo-import').click(); await page.waitForFunction(() => document.querySelector('#practice-project-name').value === 'Tour wall');
  assert.equal((await exportProject(page)).assets[0].data, saved.assets[0].data);
  await importProject(page, saved);
  await page.evaluate(() => { window.previousWC = window.practiceWC; });
  await page.locator('#practice-open-content').click();
  await page.waitForURL('**/project'); await page.waitForSelector('#dc-practice-canvas', { state: 'attached' });
  await page.locator('#preview-tab').click();
  await page.waitForFunction(() => document.querySelector('#practice-fov')?.value === '50');
  await page.waitForFunction(() => window.practiceWC !== window.previousWC);
  assert.equal(page.context().pages().length, 1, 'opening project does not open outputs');
  assert.equal((await exportProject(page)).assets[0].data, saved.assets[0].data);
  await snapshot(page, base.name + '-glb');
  const missing = structuredClone(saved); missing.content[0].ref = 'missing-local-sketch';
  await importProject(page, missing);
  await page.evaluate(() => { window.previousWC = window.practiceWC; });
  await page.locator('#practice-open-content').click();
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.includes('unavailable here'));
  assert.equal(await page.evaluate(() => window.practiceWC === window.previousWC), true, 'unavailable content keeps the working view');
  await importProject(page, saved);
  // Browser-storage failure keeps edits/export available and reports the failure.
  await page.evaluate(() => { window.realTransaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (...args) { if (args[1] === 'readwrite') throw new DOMException('test quota', 'QuotaExceededError'); return window.realTransaction.apply(this, args); }; });
  await change(page, '#practice-project-name', 'Unsaved but exportable');
  await page.locator('#practice-save').click(); await page.waitForFunction(() => document.querySelector('#practice-storage').textContent.includes('Could not save'));
  assert.equal((await exportProject(page)).name, 'Unsaved but exportable');
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.realTransaction; });
  // A second browser context receives all geometry/images/optics via one package.
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  try {
    const other = await setup(second, base); await start(other); await importProject(other, saved);
    assert.equal((await exportProject(other)).assets[0].data, saved.assets[0].data);
    assert.equal(await other.locator('#practice-dimensions').textContent(), 'Venue size: 12.00 × 4.00 × 0.00 m');
  } finally { await second.close(); }
}
async function slideshow(page, base) {
  await snapshot(page, base.name + '-slideshow-entry');
  await start(page); await page.locator('#play-pause-btn').click();
  await page.locator('[data-pattern="grid"]').click(); await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 1920);
  await page.evaluate(() => { window.patternTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; });
  await page.locator('#next-btn').click(); await page.waitForFunction(() => document.querySelector('#current-sketch-number').textContent === '2');
  assert.equal(await page.evaluate(() => window.patternTrack === document.querySelector('#source-video').srcObject.getVideoTracks()[0] && window.patternTrack.readyState === 'live'), true);
  await page.locator('[data-pattern="off"]').click(); await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 1280);
  await page.locator('#prev-btn').click(); await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 640);
  await change(page, '#interval-input', 45);
  const p = await exportProject(page); assert.equal(p.show.intervalSeconds, 45); assert.equal(p.content.length, 3);
  // Venue imports must not freeze source references or roll back the receiving show's clock.
  const { portableVenue } = await import('../../src/viewer/practice/project.ts');
  const shared = portableVenue(p);
  await importProject(page, shared);
  await page.locator('#next-btn').click(); await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 1280);
  const continued = await exportProject(page); assert.equal(continued.show.currentIndex, 1); assert.equal(continued.show.intervalSeconds, 45);
  await page.evaluate(() => { window.previousWC = window.practiceWC; });
  await page.locator('#practice-open-content').click(); await page.waitForURL('**/project**');
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 1280);
  await page.waitForFunction(() => window.practiceWC !== window.previousWC);
  assert.equal(await page.locator('#interval-input').inputValue(), '45');
  assert.equal(await page.locator('#current-sketch-number').innerText(), '2');
  assert.equal(page.context().pages().length, 1);
  await snapshot(page, base.name + '-slideshow');
}
async function recovery(page) {
  await start(page, 320);
  await page.evaluate(() => { window.oldTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; document.querySelector('#sketch-iframe').contentWindow.gl.getExtension('WEBGL_lose_context').loseContext(); });
  await page.waitForFunction(() => window.practiceWC.events.webglContext.get() === 'ok' && window.oldTrack.readyState === 'ended' && document.querySelector('#source-video').videoWidth === 320);
  await page.evaluate(() => document.querySelector('#sketch-iframe').contentWindow.createCanvas());
  await page.waitForFunction(() => window.practiceWC.events.stream.get() === document.querySelector('#source-video').srcObject);
  await page.evaluate(() => window.practicePreview.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  await page.waitForSelector('#practice-retry:not([hidden])');
  assert.equal(await page.locator('#source-video').evaluate(v => v.srcObject.getVideoTracks()[0].readyState), 'live');
  await page.locator('#add-mapping-btn').click(); const mappings = (await state(page)).mappings.length;
  await page.locator('#practice-retry').click(); await page.waitForSelector('#dc-practice-canvas');
  assert.equal((await state(page)).mappings.length, mappings);
  await page.evaluate(() => { window.lastTrack = window.practiceWC.events.stream.get().getVideoTracks()[0]; });
  await page.evaluate(() => { const link = document.createElement('a'); link.href='/'; document.body.append(link); link.click();link.remove(); });
  await page.waitForFunction(() => !document.querySelector('#dc-practice-canvas'));
  assert.equal(await page.evaluate(() => window.lastTrack.readyState), 'ended', 'internal route teardown releases the capture');
  assert.equal(await page.evaluate(() => window.practicePreview.diagnostics().disposed), true);
}
async function outputs(page) {
  await start(page);
  const first = (await state(page)).outputs[0].id;
  for (let i = 0; i < 3; i++) { await page.locator('#add-output-btn').click(); await page.locator('#add-mapping-btn').click(); }
  assert.equal(await page.locator('#add-output-btn').isDisabled(), true);
  assert.equal(page.context().pages().length, 1, 'adding a practice output does not open a popup');
  const last = (await state(page)).outputs[3].id;
  await page.locator('#practice-output').selectOption(last);
  await change(page, '#practice-p-position-0', 7.5);
  const optics = (await exportProject(page)).venue.projectors.find(p => p.outputId === last);
  await page.locator(`#outputs-list [data-output-id="${first}"] .remove-output-btn`).click();
  const exported = await exportProject(page);
  assert.equal(exported.venue.projectors.length, 3);
  assert.deepEqual(exported.venue.projectors.find(p => p.outputId === last), optics);
  assert.equal(exported.venue.layout.outputs.find(o => o.id === last).position.x, 3840);
  await page.locator('#add-output-btn').click(); await page.locator('#add-mapping-btn').click();
  const pages = [];
  for (const output of (await state(page)).outputs) {
    const promise = page.waitForEvent('popup');
    await page.locator(`#outputs-list [data-output-id="${output.id}"] .open-btn`).click(); pages.push(await promise);
  }
  assert.equal(page.context().pages().length, 5);
  for (const popup of pages) { await popup.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth === 640)); await popup.close(); }
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#source-video').evaluate(v => v.srcObject.getVideoTracks()[0].readyState), 'live');
}
async function unavailable(page) {
  await page.evaluate(() => {
    window.originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : window.originalGetContext.call(this, type, ...args); };
  });
  await page.locator(entryButton).click(); await page.locator('#preview-tab').click(); await page.waitForSelector('#practice-retry:not([hidden])');
  assert.match(await page.locator('#dc-practice-status').innerText(), /3D is unavailable/);
  await page.locator('#add-mapping-btn').click(); assert.equal((await state(page)).mappings.length, 2);
  await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 640);
  await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.originalGetContext; });
  await page.locator('#practice-retry').click(); await page.waitForSelector('#dc-practice-canvas');
  assert.equal((await state(page)).mappings.length, 2);
  await page.locator('#practice-stop').click();
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
}
async function cancellation(page) {
  let release;
  await page.route('**/practice/PracticePanel.ts', async route => { await new Promise(resolve => { release = resolve; }); await route.continue(); });
  await page.locator(entryButton).click(); await page.locator('#preview-tab').click();
  await page.waitForSelector('#practice-stop');
  await page.waitForFunction(() => window.practiceWC.events.stream.get());
  await page.evaluate(() => { window.pendingTrack = window.practiceWC.events.stream.get().getVideoTracks()[0]; });
  await page.locator('#practice-stop').click();
  assert.equal(await page.evaluate(() => window.pendingTrack.readyState), 'ended');
  assert.ok(release, 'panel module is pending'); release();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#dc-practice-canvas').count(), 0);
  assert.equal(await page.evaluate(() => window.practiceWC.hasStreamConsumers()), false);
  await start(page);
  await page.evaluate(() => { window.stoppedTrack = window.practiceWC.events.stream.get().getVideoTracks()[0]; window.practiceWC.stopCanvasStreaming(); });
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true, 'explicit stop cancels the practice consumer');
  assert.equal(await page.evaluate(() => window.stoppedTrack.readyState), 'ended');
  await start(page);
}

async function loading(page) {
  let release;
  await page.route('**/sketches/w/index.html', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ contentType: 'text/html', body: sketchHtml(320, '', true, 5500) });
  });
  await page.evaluate(() => { const link=document.createElement('a');link.href='/w';document.body.append(link);link.click();link.remove(); });
  await page.locator(entryButton).click(); await page.locator('#preview-tab').click();
  await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.includes('Waiting'));
  await page.locator('#practice-stop').click();
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true, 'stop works while the iframe is loading');
  assert.ok(release); release();
  await start(page, 320); // Canvas arrives later than the previous five-second readiness timeout.
  await page.locator('#practice-stop').click();
}

async function sample(page, base) {
  await page.goto(base.url + '/practice');
  await page.locator('#preview-tab').click();
  await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 1920);
  const project = await exportProject(page);
  assert.equal(project.content[0].kind, 'builtin'); assert.equal(project.content[0].ref, 'checkerboard');
  await page.locator('#practice-open-content').click(); await page.waitForURL('**/project');
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 1920);
  assert.equal(page.context().pages().length, 1);
  await snapshot(page, base.name + '-sample');
}

async function venue(page, base) {
  await snapshot(page, base.name + '-practice-entry');
  await start(page);
  const layout = await state(page);
  const matrix = await page.evaluate(() => window.practicePreview.diagnostics().projectorMatrix);
  const oldBackground = await page.locator('.dc-practice-background').getAttribute('src');
  const oldProject = await exportProject(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      const value = original.call(this); File.prototype.text = original;
      return new Promise(resolve => { window.finishVenueFileRead = async () => resolve(await value); });
    };
  });
  await page.locator('#practice-project-file').setInputFiles({ name:'delayed.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(oldProject)) });
  await menuAction(page, '#practice-venue');
  await change(page, '#practice-room-width', 8); await change(page, '#practice-room-height', 3); await change(page, '#practice-room-depth', 6);
  await page.locator('#practice-create-room').click();
  await page.waitForFunction(() => document.querySelector('#practice-object')?.options.length === 4);
  await page.evaluate(() => window.finishVenueFileRead());
  assert.equal((await exportProject(page)).venue.scene.kind, 'objects', 'a late file read cannot replace the newly authored room');
  await menuAction(page, '#practice-venue');
  const dimensions = await page.evaluate(() => window.practicePreview.venueDimensions());
  for (const [i, expected] of [8.3, 3.1, 6.15].entries()) assert.ok(Math.abs(dimensions[i] - expected) < 0.00001, 'rendered room uses measured dimensions');
  assert.deepEqual(await state(page), layout, 'building a room keeps calibrated mappings');
  assert.deepEqual(await page.evaluate(() => window.practicePreview.diagnostics().projectorMatrix), matrix);
  assert.notEqual(await page.locator('.dc-practice-background').getAttribute('src'), oldBackground);
  await change(page, '#practice-object-name', 'Projection wall');
  await change(page, '#practice-object-size-0', 5.5);
  await change(page, '#practice-object-position-0', 1.2);
  await change(page, '#practice-object-rotation-1', 20);
  await page.locator('#practice-object-color').evaluate(el => { el.value = '#b8c4d8'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await addObject(page, 'box');
  await change(page, '#practice-object-name', 'Stage'); await change(page, '#practice-object-size-0', 2);
  await change(page, '#practice-object-position-2', -1);
  await page.locator('#practice-copy-object').click();
  assert.equal(await page.locator('#practice-object option').count(), 6);
  await page.locator('#practice-delete-object').click();
  assert.equal(await page.locator('#practice-object option').count(), 5);
  const authored = await exportProject(page); assert.equal(authored.schemaVersion, 3);
  assert.equal(authored.venue.scene.kind, 'objects'); assert.equal(authored.venue.scene.objects.length, 5);
  const wall = authored.venue.scene.objects.find(o => o.name === 'Projection wall');
  assert.equal(wall.size[0], 5.5); assert.equal(wall.position[0], 1.2); assert.equal(wall.color, '#b8c4d8');
  assert.ok(Math.abs(wall.quaternion[1] - Math.sin(Math.PI / 18)) < 0.00001);
  assert.equal(page.context().pages().length, 1);
  const sharing = page.waitForEvent('download'); await page.locator('#practice-export-venue').click();
  const chunks = []; for await (const chunk of await (await sharing).createReadStream()) chunks.push(chunk);
  const shared = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(shared.format, 'dropcaster-venue'); assert.equal('content' in shared, false); assert.equal('show' in shared, false);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const errors = []; context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  try {
    const recipient = await setup(context, base, '/b'); await start(recipient, 1280);
    const before = await exportProject(recipient);
    await recipient.evaluate(() => { window.recipientTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; });
    await importProject(recipient, shared);
    await recipient.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.includes('Your sketch'));
    const received = await exportProject(recipient);
    assert.deepEqual(received.venue.scene.objects, authored.venue.scene.objects);
    assert.deepEqual(received.content, before.content); assert.deepEqual(received.show, before.show); assert.equal(received.id, before.id);
    assert.equal(await recipient.evaluate(() => document.querySelector('#source-video').srcObject.getVideoTracks()[0] === window.recipientTrack), true);
    assert.equal(context.pages().length, 1);
    const bad = structuredClone(shared); bad.venue.scene.objects[0].size[0] = 0;
    await importProject(recipient, bad);
    assert.deepEqual((await exportProject(recipient)).venue.scene.objects, received.venue.scene.objects, 'invalid geometry keeps the live venue');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  await menuAction(page, '#practice-venue');
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('ja'), base.modules);
  await snapshot(page, base.name + '-venue-desktop-ja');
  await page.setViewportSize({ width: 900, height: 800 }); await snapshot(page, base.name + '-venue-narrow-ja');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width:1440, height:900 });
  await page.locator('#practice-undo-venue').click();
  await page.waitForFunction(() => document.querySelector('#practice-object')?.options.length === 6);
  await menuAction(page, '#practice-project');
  await page.waitForFunction(() => document.querySelector('#practice-storage').textContent.includes('保存済み'));
  await page.locator('#practice-stop').click(); await page.reload(); await observeControllers(page, base); await start(page);
  const restored = await exportProject(page); assert.equal(restored.venue.scene.objects.length, 6);
  assert.deepEqual(restored.venue.projectors, authored.venue.projectors);
  assert.ok(await page.evaluate(() => window.practicePreview.diagnostics().memory.geometries < 15));
}

async function solids(page, base) {
  await start(page);
  await page.waitForFunction(()=>document.querySelector('#dc-practice-status').textContent.includes('Open an output'));
  const guides = await page.evaluate(() => {
    const p=window.practicePreview, group=p.scene.getObjectByName('projector-guide');
    const snapshot=()=>{p.depthDirty=true;p.render();return {background:p.backgroundImage(), composite:[...p.compositor.readPixels()], lit:p.probe([2,2,-3],[0,0,1]), shadow:p.probe([-.2,1,-3],[0,0,1])}};
    const before=snapshot();p.setGuidesVisible(false);const after=snapshot();p.setGuidesVisible(true);
    return {before,after,position:group.position.toArray(),projector:p.projector.position.toArray(),layers:group.children.map(o=>p.projector.layers.test(o.layers))};
  });
  assert.deepEqual(guides.before,guides.after,'guides cannot alter background, composite or occlusion');
  assert.deepEqual(guides.position,guides.projector);assert.ok(guides.layers.every(v=>!v));
  await page.locator('#practice-guides').uncheck();
  assert.equal(await page.evaluate(()=>window.practicePreview.scene.getObjectByName('projector-guide').visible),false);
  await page.locator('#practice-guides').check();
  await change(page,'#practice-p-position-0',1.5);await change(page,'#practice-shift-0',10);
  assert.equal(await page.evaluate(()=>window.practicePreview.scene.getObjectByName('projector-guide').position.x),1.5);
  await menuAction(page,'#practice-venue');await page.locator('#practice-start-objects').click();
  await page.waitForFunction(()=>document.querySelector('#practice-object')?.options.length===1);
  await addObject(page,'tetrahedron');await change(page,'#practice-object-size-0',2);await change(page,'#practice-object-size-1',3);
  await change(page,'#practice-object-position-0',2);await change(page,'#practice-object-position-1',1.5);
  await change(page,'#practice-object-rotation-1',25);
  await addObject(page,'prism');await change(page,'#practice-object-position-0',-2);await change(page,'#practice-object-size-2',2.5);
  assert.equal(await page.evaluate(()=>window.practicePreview.diagnostics().venueTriangles),24);
  const pending=page.waitForEvent('download');await page.locator('#practice-share-venue').click();
  const chunks=[];for await(const chunk of await(await pending).createReadStream())chunks.push(chunk);
  const shared=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(shared.schemaVersion,2);assert.deepEqual(shared.venue.scene.objects.map(o=>o.kind),['box','tetrahedron','prism']);
  assert.equal('content' in shared,false);assert.equal(page.context().pages().length,1);
  await page.locator('#practice-overview').click();
  await page.evaluate(async modules=>(await import(`${modules}/i18n/index.ts`)).setLang('ja'),base.modules);
  assert.equal(await page.locator('#practice-object-kind option[value="tetrahedron"]').innerText(),'四面体');
  await snapshot(page,base.name+'-solids-desktop-ja');
  await page.setViewportSize({width:900,height:800});await snapshot(page,base.name+'-solids-narrow-ja');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const recipientContext=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  try {
    const other=await setup(recipientContext,base,'/b');await start(other,1280);
    const before=await exportProject(other);
    await menuAction(other,'#practice-venue');
    const chooser=other.waitForEvent('filechooser');await other.locator('#practice-receive-venue').click();
    await(await chooser).setFiles({name:'solids.venue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(shared))});
    await other.waitForFunction(()=>document.querySelector('#dc-practice-status').textContent.includes('Your sketch'));
    const received=await exportProject(other);
    assert.deepEqual(received.venue.scene.objects,shared.venue.scene.objects);
    assert.deepEqual(received.venue.projectors,shared.venue.projectors);
    assert.deepEqual(received.content,before.content);assert.deepEqual(received.show,before.show);
    assert.equal(await other.locator('#source-video').evaluate(v=>v.videoWidth),1280);
    await menuAction(other,'#practice-venue');await other.locator('#practice-copy-object').click();
    assert.equal(await other.locator('#practice-object option').count(),4,'shared solids remain editable');
  } finally {await recipientContext.close()}
}

try {
  for (const config of ['vite.config.ts', 'apps/web/vite.config.ts']) {
    const hosted = config.startsWith('apps/'), name = hosted ? 'hosted' : 'gallery';
    if (process.env.PRACTICE_ENTRY && name !== process.env.PRACTICE_ENTRY) continue;
    const server = await createServer({ configFile: resolve(root, config), root: hosted ? resolve(root, 'apps/web') : root,
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: null, hmr: false }, logLevel: 'error' });
    try {
      await server.listen();
      const base = { name, url: `http://127.0.0.1:${server.httpServer.address().port}`, modules: hosted ? `/@fs${root.slice(0,-1)}/src/viewer` : '/src/viewer' };
      for (const [testName, run] of Object.entries({ workspace, workspaceSlideshow: workspace, lifecycle, projects, slideshow, recovery, outputs, unavailable, cancellation, loading, sample, venue, solids })) {
        if (process.env.PRACTICE_CASE && process.env.PRACTICE_CASE !== testName) continue;
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
        const errors = []; context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
        try {
          const page = await setup(context, base, testName.toLowerCase().includes('slideshow') ? '/slideshow' : testName === 'recovery' ? '/w' : '/a', !testName.startsWith('workspace'));
          await run(page, base); assert.deepEqual(errors, [], `${name}/${testName}: browser errors`);
          console.log(`${name}/${testName}: PASS`);
        } finally { await context.close(); }
      }
    } finally { await server.close(); }
  }
} finally { await browser.close(); }
