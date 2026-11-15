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
  assert.equal(await page.locator('#dc-practice-venue,#practice-venue-tools,#practice-projector-form').count(),0,'3D is preview-only');
  await page.waitForFunction(w => document.querySelector('#source-video')?.videoWidth === w && window.practicePreview?.diagnostics().memory.textures > 0, width);
  await page.waitForFunction(() => !document.querySelector('#dc-practice-status')?.textContent.includes('Preparing'));
}
/** × は確認ダイアログを開くだけなので、閉じるには「閉じる」まで押す。 */
async function closeEditor(page) {
  await page.locator('#practice-stop').click();
  await page.locator('#practice-stop-confirm-btn').click();
}
async function change(page, selector, value) { await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab'); }
async function menuAction(page, id) {
  if (!await page.locator('#practice-menu').evaluate(e => e.open)) await page.locator('#practice-menu > summary').click();
  await page.locator(id).click();
}
async function projectControls(page) { await menuAction(page, '#practice-project'); }
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
  await closeEditor(page);
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
  await closeEditor(page);
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
  const calibrated = await exportProject(page); calibrated.venue.projectors[0].position[0] = 1.25; calibrated.venue.projectors[0].lensShift[0] = .12; await importProject(page, calibrated);
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
  // 「設定・共有」は見出しの左にアイコンだけで置き、名前は title / aria-label で示す (#150)。
  const menuSummary = page.locator('#practice-menu > summary');
  assert.deepEqual(await page.locator('.tool-column > .column-header').evaluate(h => [...h.children].map(e => e.id || e.className || e.tagName.toLowerCase())), ['practice-menu', 'h2', 'dc-workspace-actions'], 'menu, heading, then close actions');
  assert.equal((await menuSummary.innerText()).trim(), '', 'menu button has no visible text');
  assert.equal(await menuSummary.getAttribute('aria-label'), '設定・共有'); assert.equal(await menuSummary.getAttribute('title'), '設定・共有');
  await page.evaluate(async base => (await import(`${base}/i18n/index.ts`)).setLang('en'), base.modules);
  assert.equal(await menuSummary.getAttribute('aria-label'), 'Settings & sharing'); assert.equal(await menuSummary.getAttribute('title'), 'Settings & sharing');
  await page.evaluate(async base => (await import(`${base}/i18n/index.ts`)).setLang('ja'), base.modules);
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
  await closeEditor(page);
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => ({ track: window.firstTrack.readyState, disposed: window.firstPreview.diagnostics().disposed })), { track: 'live', disposed: true });
  await popup2.close(); await page.waitForFunction(() => window.firstTrack.readyState === 'ended');
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
  for (let i = 0; i < 3; i++) {
    await start(page);
    assert.equal(await page.evaluate(() => window.practicePreview.projector.position.x), 1.25);
    await page.evaluate(() => { window.lastTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; window.lastPreview = window.practicePreview; });
    await closeEditor(page);
    assert.deepEqual(await page.evaluate(() => ({ track: window.lastTrack.readyState, disposed: window.lastPreview.diagnostics().disposed })), { track: 'ended', disposed: true });
  }
}
async function projects(page, base) {
  await start(page); await projectControls(page); await change(page, '#practice-project-name', 'Tour wall');
  const authored = await exportProject(page); authored.venue.projectors[0].verticalFovDegrees = 50; authored.venue.projectors[0].lensShift[1] = -.07;
  authored.assets = [{id:'wall-glb',name:'wall.glb',mimeType:'model/gltf-binary',data:Buffer.from(venueFixture()).toString('base64')}];
  authored.venue.scene = {...authored.venue.scene,kind:'glb',assetId:'wall-glb'}; await importProject(page,authored);
  assert.equal(await page.locator('#practice-dimensions').textContent(), 'Venue size: 6.00 × 4.00 × 0.00 m');
  assert.equal(await page.evaluate(() => window.practicePreview.diagnostics().venueTriangles), 2);
  await page.evaluate(() => {
    const p = window.practicePreview;
    window.importedMaterials = [];
    p.scene.traverse(o => { if (o.isMesh && o.material.uniforms?.baseMap) window.importedMaterials.push(o.material); });
  });
  assert.equal(await page.evaluate(() => window.importedMaterials.length), 1, 'embedded image reaches the venue shader');
  assert.deepEqual(await page.evaluate(() => window.importedMaterials[0].uniforms.baseColor.value.toArray()), [0.7, 0.8, 0.9]);
  const measured = await exportProject(page); measured.venue.scene.scale[0] = 2; await importProject(page, measured);
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
  const emptyModel = structuredClone(baseline); emptyModel.assets[0].data = Buffer.from(venueFixture(d => { d.scenes[0].nodes = []; })).toString('base64'); await importProject(page, emptyModel);
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
  await page.waitForFunction(() => window.practicePreview?.projector.fov === 50);
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
// #168: 確定した変更は保存待ちのまま再読み込みで失われない (スライドショーと単独作品ページのマッピング)。
async function draftProject(page, base) { return page.evaluate(async modules => (await import(`${modules}/practice/projectStore.ts`)).readProject(), base.modules); }
async function storageSaved(page) { await page.waitForFunction(() => document.querySelector('#practice-storage').textContent.includes('saved')); }
async function reopen(page, base) { await page.waitForSelector(entryButton); await observeControllers(page, base); await start(page); await projectControls(page); }
async function slideshowDraft(page, base) {
  let answer = 'accept'; const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void (answer === 'accept' ? dialog.accept() : dialog.dismiss()); });
  await start(page); await projectControls(page);
  await change(page, '#practice-project-name', 'First'); await storageSaved(page);
  await change(page, '#practice-project-name', 'Second'); await page.waitForTimeout(100);
  await page.reload(); await reopen(page, base);
  assert.equal(await page.inputValue('#practice-project-name'), 'Second', 'a committed name survives a reload 100 ms later');
  assert.deepEqual(dialogs, [], 'a finished save does not ask before leaving');
  // 確定と同じタスクで離脱すると保存中なので確認を出す。キャンセルすれば変更は残り、待てば保存済みになる。
  answer = 'dismiss'; await page.locator('#practice-project-name').click();
  try { await page.evaluate(() => { const name = document.querySelector('#practice-project-name'); name.value = 'Third'; name.dispatchEvent(new Event('change', { bubbles: true })); location.reload(); }); } catch { /* the page navigated away */ }
  assert.deepEqual(dialogs, ['beforeunload'], 'leaving in the same task as the commit asks first');
  assert.equal(await page.inputValue('#practice-project-name'), 'Third', 'cancelling keeps the edit');
  await storageSaved(page); assert.equal((await draftProject(page, base)).name, 'Third', 'staying finishes the save');
  // ドラッグ中は書き込まず、操作の終わりで 1 回だけ保存する。
  await page.locator('#mapping-tab').click(); await page.locator('#add-mapping-btn').click(); await page.waitForTimeout(700); await storageSaved(page);
  await page.evaluate(() => { window.draftWrites = 0; const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { window.draftWrites++; return put.apply(this, args); }; });
  const box = await page.locator('#output-stage .quad-handle[data-corner="topLeft"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2);
  assert.equal(await page.evaluate(() => window.draftWrites), 0, 'a drag does not write while it moves');
  await page.mouse.up(); await page.waitForFunction(() => window.draftWrites === 1); await storageSaved(page);
  await page.waitForTimeout(700); assert.equal(await page.evaluate(() => window.draftWrites), 1, 'the drag is saved once when it ends');
  const dragged = (await state(page)).mappings.at(-1).quad;
  // 保存済みなら新たな確認を出さない。
  answer = 'accept'; await page.reload(); await reopen(page, base);
  assert.deepEqual(dialogs, ['beforeunload'], 'a saved draft reloads without asking');
  assert.equal(await page.inputValue('#practice-project-name'), 'Third');
  assert.deepEqual((await draftProject(page, base)).venue.layout.mappings.at(-1).quad, dragged);
  // 単独作品ページは従来の離脱確認を承諾して再読み込みしても、100 ms 前の確定が残る。
  await page.goto(base.url + '/a'); await reopen(page, base);
  await change(page, '#practice-project-name', 'Fourth'); await page.waitForTimeout(100);
  await page.reload(); await reopen(page, base);
  assert.equal(await page.inputValue('#practice-project-name'), 'Fourth', 'the sketch page keeps a commit made 100 ms before reloading');
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
/** スライドショーの ← → Space F は、マッピング編集中と文字入力中には奪わない (#109)。 */
async function slideshowShortcuts(page) {
  await page.evaluate(() => {
    window.fullscreenRequests = 0;
    Element.prototype.requestFullscreen = function () { window.fullscreenRequests++; return Promise.resolve(); };
  });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('index') === '0');
  const show = () => page.evaluate(() => ({
    index: new URL(location.href).searchParams.get('index'), number: document.querySelector('#current-sketch-number').textContent,
    playing: document.querySelector('#play-pause-btn').dataset.i18nTitle === 'slideshow.pause', fullscreen: window.fullscreenRequests,
  }));
  const onPage = async key => { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(key); };
  const shortcutsWork = async (fullscreen, when) => {
    await onPage('ArrowRight'); assert.deepEqual(await show(), { index: '1', number: '2', playing: false, fullscreen }, `${when}: → moves to the next sketch`);
    await onPage('ArrowLeft'); assert.deepEqual(await show(), { index: '0', number: '1', playing: false, fullscreen }, `${when}: ← moves back`);
    await onPage('Space'); assert.equal((await show()).playing, true, `${when}: Space resumes`);
    await onPage('Space'); assert.equal((await show()).playing, false, `${when}: Space pauses`);
    await onPage('f'); assert.equal((await show()).fullscreen, fullscreen + 1, `${when}: F toggles fullscreen`);
  };
  await onPage('Space'); assert.equal((await show()).playing, false, 'Space pauses the slideshow');
  await shortcutsWork(0, 'before editing');
  const idle = await show();
  // 修飾キー付き (Ctrl/Cmd+F の検索、Alt+→ の進むなど) と、他が処理済みのキーは奪わない
  for (const key of ['Control+f', 'Meta+f', 'Control+ArrowRight', 'Alt+ArrowRight', 'Meta+ArrowRight']) {
    await onPage(key); assert.deepEqual(await show(), idle, `${key} triggers no slideshow shortcut`);
  }
  await page.evaluate(() => { window.claim109 = e => e.preventDefault(); addEventListener('keydown', window.claim109, true); });
  for (const key of ['ArrowRight', 'Space', 'f']) await onPage(key);
  assert.deepEqual(await show(), idle, 'keys already handled (defaultPrevented) trigger no slideshow shortcut');
  await page.evaluate(() => removeEventListener('keydown', window.claim109, true));
  // target が Element でない keydown (document へ直接 dispatch) でも例外を出さない
  const thrown = await page.evaluate(() => {
    const errors = [], onError = e => errors.push(e.message); addEventListener('error', onError);
    for (const key of ['ArrowRight', 'ArrowLeft']) document.dispatchEvent(new KeyboardEvent('keydown', { key }));
    removeEventListener('error', onError); return errors;
  });
  assert.deepEqual(thrown, [], 'a keydown dispatched on document does not throw');
  assert.deepEqual(await show(), idle, '→ then ← dispatched on document returns to the first sketch');
  // 入力欄 (number input・textarea・contenteditable) への文字入力はショートカットにならない
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<textarea id="t109"></textarea><div id="c109" contenteditable></div>'));
  for (const selector of ['#interval-input', '#t109', '#c109']) {
    await page.locator(selector).focus();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Space', 'f', 'F']) await page.keyboard.press(key);
    assert.deepEqual(await show(), idle, `typing in ${selector} triggers no slideshow shortcut`);
  }
  assert.equal(await page.locator('#t109').inputValue(), ' fF', 'the textarea receives the typed text');
  await page.evaluate(() => document.querySelectorAll('#t109, #c109').forEach(e => e.remove()));
  // 編集を開いている間は、隅の微調整・名前の入力・どこへのキーでも作品は切り替わらない
  await page.locator('#mapping-btn').click(); await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await page.locator('#add-mapping-btn').click();
  const before = await state(page);
  await page.locator('#output-stage [data-corner]').first().click(); await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await state(page)).mappings, before.mappings, 'ArrowRight nudges the selected corner');
  assert.deepEqual(await show(), idle, 'nudging a corner keeps the current sketch');
  for (const key of ['ArrowRight', 'Space', 'f']) await onPage(key);
  assert.deepEqual(await show(), idle, 'slideshow shortcuts stay off while the editor is open');
  await page.locator('.mapping-list-item .name').first().dblclick();
  const input = page.locator('.mapping-list-item .name-input');
  await input.press('End'); await input.pressSequentially(' Ff');
  assert.match(await input.inputValue(), / Ff$/, 'the name field receives Space and F');
  assert.deepEqual(await show(), idle, 'typing a mapping name triggers no slideshow shortcut');
  await input.press('Escape');
  await closeEditor(page);
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
  await shortcutsWork(1, 'after closing the editor');
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
  // 上限で押せない「出力を追加」も、汎用 button:disabled の明るい塗りではなく通常の地色のまま淡くする (#186)
  const addLook = () => page.locator('#add-output-btn').evaluate(el => { el.getAnimations().forEach(a => a.finish()); const s = getComputedStyle(el); return { background: s.backgroundColor, opacity: Number(s.opacity) }; });
  const disabledAdd = await addLook();
  assert.equal(disabledAdd.background, 'rgb(68, 68, 68)', 'a disabled tool button keeps its own fill');
  assert.ok(disabledAdd.opacity < 0.5, 'a disabled tool button dims itself');
  await page.locator('#add-output-btn').hover();
  assert.equal((await addLook()).background, 'rgb(68, 68, 68)', 'hovering a disabled tool button does not highlight it');
  assert.equal(page.context().pages().length, 1, 'adding a practice output does not open a popup');
  const last = (await state(page)).outputs[3].id;
  await page.locator('#practice-output').selectOption(last);
  const calibration = await exportProject(page); calibration.venue.projectors.find(p=>p.outputId===last).position[0] = 7.5; await importProject(page,calibration);
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
  await closeEditor(page);
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true);
}
async function cancellation(page) {
  let release;
  await page.route('**/practice/PracticePanel.ts', async route => { await new Promise(resolve => { release = resolve; }); await route.continue(); });
  await page.locator(entryButton).click(); await page.locator('#preview-tab').click();
  await page.waitForSelector('#practice-stop');
  await page.waitForFunction(() => window.practiceWC.events.stream.get());
  await page.evaluate(() => { window.pendingTrack = window.practiceWC.events.stream.get().getVideoTracks()[0]; });
  await closeEditor(page);
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
  await closeEditor(page);
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true, 'stop works while the iframe is loading');
  assert.ok(release); release();
  await start(page, 320); // Canvas arrives later than the previous five-second readiness timeout.
  await closeEditor(page);
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

/** 編集の Undo / Redo (#161): 1 操作 = 1 件、選択だけでは積まない、入力欄の Cmd+Z は奪わない、保存と一致する。 */
async function history(page, base) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  const undoBtn = page.locator('#dc-undo-btn'), redoBtn = page.locator('#dc-redo-btn');
  const bar = await page.locator('.dc-edit-toolbar').boundingBox();
  const columns = await page.locator('.control-container').boundingBox();
  assert.ok(bar && columns && bar.height <= 32, 'the history bar is thin');
  assert.ok(Math.abs(bar.y + bar.height - columns.y) <= 1 && Math.abs(bar.width - columns.width) <= 1, 'the bar spans the three columns right above them');
  assert.equal(await undoBtn.isDisabled(), true, 'nothing to undo on entry');
  assert.equal(await redoBtn.isDisabled(), true);
  // 押せないことはアイコンを淡くして示し、汎用の button:disabled の塗りを付けない (ホバー中も)
  const look = el => { const s = getComputedStyle(el); return { background: s.backgroundColor, opacity: Number(s.opacity) }; };
  const clear = 'rgba(0, 0, 0, 0)';
  for (const btn of [undoBtn, redoBtn]) {
    const idle = await btn.evaluate(look);
    assert.equal(idle.background, clear, 'a disabled history button has no fill');
    assert.ok(idle.opacity < 0.5, 'a disabled history button dims its icon');
    await btn.hover();
    assert.equal((await btn.evaluate(look)).background, clear, 'hovering a disabled history button adds no fill');
  }
  if (artifactDir) await page.locator('.dc-edit-toolbar').screenshot({ path: resolve(artifactDir, base.name + '-history-disabled.png') });
  // 出力設定の数値欄: Escape は取消 (欄・state・書き出し JSON が編集前のまま、履歴も積まない) (#113)
  const outputLayout = async () => { const o = (await state(page)).outputs[0]; return { x: o.position.x, y: o.position.y, w: o.size.width, h: o.size.height }; };
  const layoutBefore = await outputLayout();
  for (const [field, typed] of [['x', 174], ['y', 33], ['w', 777], ['h', 555], ['w', '']]) {
    const input = page.locator(`#output-${field}-input`);
    await input.fill(String(typed)); await input.press('Escape');
    assert.equal(await input.inputValue(), String(layoutBefore[field]), `Escape restores the ${field} field (typed "${typed}")`);
    assert.deepEqual(await outputLayout(), layoutBefore, `Escape on ${field} keeps the output layout`);
    assert.equal(await undoBtn.isDisabled(), true, `Escape on ${field} adds no history`);
  }
  const exportedLayout = (await exportProject(page)).venue.layout.outputs[0];
  assert.deepEqual({ x: exportedLayout.position.x, y: exportedLayout.position.y, w: exportedLayout.size.width, h: exportedLayout.size.height }, layoutBefore, 'the exported project keeps the pre-edit layout');
  await page.locator('#output-y-input').fill('12'); await page.locator('#output-y-input').press('Enter');
  assert.equal((await outputLayout()).y, 12, 'Enter commits the typed value');
  await undoBtn.click();
  assert.deepEqual(await outputLayout(), layoutBefore);
  assert.equal(await undoBtn.isDisabled(), true);
  const ids = async () => (await state(page)).mappings.map(m => m.id);
  const initialIds = await ids();

  // 追加 → Undo → Redo
  await page.locator('#add-mapping-btn').click();
  const addedIds = await ids();
  assert.equal(addedIds.length, initialIds.length + 1);
  await undoBtn.click();
  assert.deepEqual(await ids(), initialIds, 'undo removes the added mapping');
  assert.equal(await redoBtn.isDisabled(), false);
  await redoBtn.click();
  assert.deepEqual(await ids(), addedIds, 'redo restores it with the same id');
  assert.equal(await redoBtn.isDisabled(), true);

  // 選択の切替だけでは履歴が増えない (次の Undo は追加を取り消す)
  const activeAfterRedo = (await state(page)).activeId;
  const other = addedIds.find(id => id !== activeAfterRedo);
  await page.locator(`.mapping-list-item[data-id="${other}"] .name`).click();
  assert.equal((await state(page)).activeId, other);
  assert.equal(await redoBtn.isDisabled(), true, 'selection does not create history');

  // 四隅のドラッグ 1 回 = 1 件 (途中の毎フレームの確定は積まない)
  await page.locator('#mapping-tab').click();
  const corner = page.locator('#output-stage .quad-handle[data-corner="topLeft"]');
  const box = await corner.boundingBox();
  const beforeDrag = (await state(page)).mappings.find(m => m.id === other).quad;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2);
  await page.mouse.up();
  const afterDrag = (await state(page)).mappings.find(m => m.id === other).quad;
  assert.notDeepEqual(afterDrag, beforeDrag, 'the drag moved the corner');
  await page.keyboard.press('ControlOrMeta+z');
  assert.deepEqual((await state(page)).mappings.find(m => m.id === other).quad, beforeDrag, 'one undo reverts the whole drag');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  assert.deepEqual((await state(page)).mappings.find(m => m.id === other).quad, afterDrag, 'redo replays the whole drag');

  // 矢印キーの連続入力 = 1 件
  await corner.click();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const nudged = (await state(page)).mappings.find(m => m.id === other).quad;
  assert.ok(nudged.topLeft.x > afterDrag.topLeft.x, 'arrow keys nudged the corner');
  await page.keyboard.press('ControlOrMeta+z');
  assert.deepEqual((await state(page)).mappings.find(m => m.id === other).quad, afterDrag, 'one undo reverts the whole nudge run');

  // 削除 → Undo で同じ ID・同じ位置に戻る
  const beforeRemove = await ids();
  await page.locator(`.mapping-list-item[data-id="${other}"] .remove-btn`).click();
  assert.ok(!(await ids()).includes(other));
  await undoBtn.click();
  assert.deepEqual(await ids(), beforeRemove, 'undo restores the removed mapping in place');

  // 1 回で確定する操作 (表示切替・名前変更・出力の数値入力) はそれぞれ 1 件
  const undoRestores = async (label, act) => {
    const before = await state(page);
    await act();
    const changed = await state(page);
    assert.notDeepEqual({ m: changed.mappings, o: changed.outputs }, { m: before.mappings, o: before.outputs }, `${label} changed the state`);
    // 数値入力の後はフォーカスが次の入力欄にあり、Cmd/Ctrl+Z は文字入力の Undo になるのでボタンで戻す
    await undoBtn.click();
    const after = await state(page);
    assert.deepEqual({ m: after.mappings, o: after.outputs }, { m: before.mappings, o: before.outputs }, `one undo reverts ${label}`);
  };
  await undoRestores('toggle', () => page.locator(`.mapping-list-item[data-id="${other}"] .toggle-btn`).click());
  await undoRestores('rename', async () => {
    await page.locator(`.mapping-list-item[data-id="${other}"] .name`).dblclick();
    await page.locator('.mapping-list-item .name-input').fill('renamed'); await page.locator('.mapping-list-item .name-input').press('Enter');
  });
  await undoRestores('output x', () => change(page, '#output-x-input', 40));

  // ソースの crop ドラッグ 1 回 = 1 件
  await undoRestores('crop drag', async () => {
    const handle = await page.locator('#selection-box .handle-se').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(handle.x + handle.width / 2 - i * 6, handle.y + handle.height / 2 - i * 4);
    await page.mouse.up();
  });

  // マスクのペン描画: 描画中は Undo できず、描き終えた 1 件を Undo するとマスクごと消える
  const beforeMask = await ids();
  await page.locator('#add-mask-btn').click();
  assert.equal(await undoBtn.isDisabled(), true, 'undo is disabled while drawing a mask');
  const host = await page.locator('#output-stage .dc-canvas-host').boundingBox();
  for (const [fx, fy] of [[.2, .2], [.45, .25], [.3, .5]]) await page.mouse.click(host.x + host.width * fx, host.y + host.height * fy);
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal((await state(page)).mappings.find(m => m.drafting)?.points.length, 3, 'Cmd/Ctrl+Z does not touch a mask being drawn');
  await page.keyboard.press('Enter');
  assert.equal((await state(page)).mappings.some(m => m.drafting), false, 'the mask is closed');
  assert.equal(await undoBtn.isDisabled(), false);
  await undoBtn.click();
  assert.deepEqual(await ids(), beforeMask, 'one undo removes the whole drawn mask');
  await redoBtn.click();
  assert.equal((await ids()).length, beforeMask.length + 1, 'redo brings the closed mask back');
  await undoBtn.click();

  // 名前の入力欄では Cmd/Ctrl+Z は文字入力の Undo で、編集の履歴は動かない
  const beforeRename = await state(page);
  await page.locator(`.mapping-list-item[data-id="${other}"] .name`).dblclick();
  const input = page.locator('.mapping-list-item .name-input');
  await input.press('End'); await input.pressSequentially('xyz');
  await input.press('ControlOrMeta+z');
  assert.deepEqual(await state(page), beforeRename, 'undo inside the name field leaves the mapping history alone');
  await input.press('Escape');

  // Undo 後の状態がそのまま保存される
  await undoBtn.click();
  await page.waitForFunction(expected => {
    const raw = localStorage.getItem('dropcaster.mappings.v2');
    return !!raw && JSON.stringify(JSON.parse(raw).mappings) === expected;
  },
    JSON.stringify((await state(page)).mappings));
  await snapshot(page, 'history');
  await closeEditor(page);
}
// プレビュー上のクリックは、押した時点で前面にある項目を選ぶ。ペン描画中は切り替えない (#112)
async function maskSelect(page, base) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await page.locator('#add-mapping-btn').click();
  const host = await page.locator('#output-stage .dc-canvas-host').boundingBox();
  const at = (fx, fy) => page.mouse.click(host.x + host.width * fx, host.y + host.height * fy);
  const history = () => Promise.all(['#dc-undo-btn', '#dc-redo-btn'].map(s => page.locator(s).isDisabled()));
  const [added, initial] = (await state(page)).mappings.map(m => m.id);
  // 非 active なマッピングのプレビューを押すとそのマッピングが選ばれる
  await at(.26, .6);
  assert.equal((await state(page)).activeId, initial, 'clicking an inactive mapping on the preview selects it');
  await page.locator('#add-mask-btn').click();
  for (const [fx, fy] of [[.35, .35], [.65, .35], [.5, .65]]) await at(fx, fy);
  await page.keyboard.press('Enter');
  const mask = (await state(page)).mappings.find(m => m.kind === 'mask' && !m.drafting).id;
  await page.locator(`.mapping-list-item[data-id="${added}"] .name`).click();
  assert.equal((await state(page)).activeId, added);
  await snapshot(page, `${base.name}-mask-select-before`);
  // マスクは両方のマッピングに重なる位置で押しても、前面のマスクが選ばれる
  await at(.5, .45);
  await snapshot(page, `${base.name}-mask-select-after`);
  assert.equal((await state(page)).activeId, mask, 'clicking the committed mask on the preview selects it again');
  // 既に active なマスクを押しても選択も履歴も変わらない
  const selected = await state(page), selectedHistory = await history();
  await at(.5, .56);
  assert.deepEqual(await state(page), selected, 'clicking the active mask keeps the state');
  assert.deepEqual(await history(), selectedHistory, 'clicking the active mask keeps the history');
  // マスクが当たるのは多角形だけで、外側を押すと背面のマッピングが選ばれる
  await at(.26, .6);
  assert.equal((await state(page)).activeId, initial, 'clicking outside the mask polygon selects the mapping behind it');
  // 多角形の外なら、前面にマスクがあっても active なマッピング本体をドラッグできる
  const quadOf = async id => (await state(page)).mappings.find(m => m.id === id).quad;
  const beforeDrag = await quadOf(initial);
  await page.mouse.move(host.x + host.width * .27, host.y + host.height * .6); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(host.x + host.width * .27 - i * 4, host.y + host.height * .6 + i * 3);
  await page.mouse.up();
  assert.ok((await quadOf(initial)).topLeft.x < beforeDrag.topLeft.x, 'dragging outside the mask polygon moves the active mapping');
  assert.equal((await state(page)).activeId, initial, 'dragging the active mapping keeps the selection');
  // 右クリックでは選択を切り替えない (ソースカラムと同じく左ボタンだけ)
  for (const [fx, fy, label] of [[.5, .45, 'mask'], [.77, .77, 'mapping']]) {
    await page.mouse.click(host.x + host.width * fx, host.y + host.height * fy, { button: 'right' });
    assert.equal((await state(page)).activeId, initial, `right-clicking an inactive ${label} keeps the selection`);
  }
  // ペン描画中に既存マスクやマッピングを押しても切り替わらず、頂点が増える
  await page.locator('#add-mask-btn').click();
  const draft = (await state(page)).activeId;
  await at(.5, .45);
  await at(.26, .6);
  const drafting = await state(page);
  assert.equal(drafting.activeId, draft, 'clicks while drawing a mask keep the drafting mask active');
  assert.equal(drafting.mappings.find(m => m.id === draft).points.length, 2, 'clicks while drawing add vertices instead');
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).mappings.some(m => m.drafting), false);
}
async function confirmClose(page, base) {
  await start(page);
  await page.locator('#mapping-tab').click(); await page.locator('#add-mapping-btn').click();
  await page.locator('#output-stage [data-corner]').first().click();
  const before = await state(page);
  const dialog = page.locator('#practice-stop-confirm');
  const openDialog = async () => {
    await page.locator('#practice-stop').click();
    assert.equal(await dialog.evaluate(d => d.open && d.matches(':modal')), true, 'x opens a modal confirmation');
    assert.equal(await page.locator('#dc-inline-editor').isVisible(), true, 'one click on x never closes the editor');
  };
  await openDialog();
  assert.equal(await page.locator('#practice-stop-cancel').evaluate(e => e === document.activeElement), true, 'cancel has the initial focus');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await state(page), before, 'keys inside the dialog do not reach editor shortcuts');
  const frames = await page.evaluate(() => new Promise((resolve, reject) => {
    const video = document.querySelector('#source-video'); let count = 0;
    const timer = setTimeout(() => reject(new Error(`only ${count} frames`)), 5000);
    const tick = () => { if (++count >= 5) { clearTimeout(timer); resolve(count); } else video.requestVideoFrameCallback(tick); };
    video.requestVideoFrameCallback(tick);
  }));
  assert.equal(frames, 5, 'the sketch keeps streaming while the dialog is open');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(d => d.open), false, 'Esc dismisses the dialog');
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true, 'Esc keeps the editor open');
  await openDialog(); await page.locator('#practice-stop-cancel').click();
  assert.equal(await dialog.evaluate(d => d.open), false);
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true, 'cancel keeps the editor open');
  await openDialog();
  const box = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 2 && Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2, 'the dialog is centred');
  await page.mouse.click(4, 4);
  assert.equal(await dialog.evaluate(d => d.open), false, 'clicking the backdrop dismisses the dialog');
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true, 'backdrop click keeps the editor open');
  assert.deepEqual(await state(page), before, 'dismissing never changes mappings');
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('ja'), base.modules);
  await openDialog();
  assert.equal(await page.locator('#practice-stop-confirm-title').innerText(), '編集を閉じますか？');
  assert.equal(await page.locator('#practice-stop-confirm-btn').innerText(), '閉じる');
  await snapshot(page, base.name + '-close-confirm-ja');
  await page.evaluate(() => { window.confirmTrack = document.querySelector('#source-video').srcObject.getVideoTracks()[0]; });
  await page.locator('#practice-stop-confirm-btn').click();
  assert.equal(await page.locator('#dc-inline-editor').isHidden(), true, 'confirming closes the editor');
  assert.equal(await page.evaluate(() => window.confirmTrack.readyState), 'ended', 'confirming releases the stream as before');
}
/**
 * 単独作品ページでは、作品の全画面 (⛶) とマッピング編集を両立させない (#103)。
 * 全画面中はマッピングへ入る操作を、編集中は全画面へ入る操作を出さず、どの順でも黒一色にならない。
 * gallery の作品 (/a) と、OP / Gist と同じ srcdoc 経路の作品 (/b) で確かめる。
 */
async function fullscreenMapping(page, base) {
  const mapping = page.locator('#open-windows-btn'), fullscreen = page.locator('#fullscreen-btn');
  // 編集か作品のどちらかが描画されているか (黒一色でないか)
  const shown = p => p.evaluate(() => {
    const rendered = el => {
      if (!el) return false;
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return { editor: rendered(document.querySelector('#dc-inline-editor')), sketch: rendered(document.querySelector('#sketch-iframe')) };
  });
  const notBlack = async (p, when) => {
    const s = await shown(p);
    assert.ok(s.editor || s.sketch, `${when}: the editor or the sketch is visible (got ${JSON.stringify(s)})`);
    return s;
  };
  // ボタンが出ていないこと、キーボード (フォーカスして Enter) でも押せないこと。
  // 結果の確認 (黒画面にならないか等) を先に行い、出ていない・フォーカスできないことは最後に確かめる
  const pressViaKeyboard = async (p, button) => {
    const shownBefore = await p.locator(button).isVisible();
    const focused = await p.evaluate(selector => { const b = document.querySelector(selector); b.focus(); return document.activeElement === b; }, button);
    if (focused) { await p.keyboard.press('Enter'); await p.waitForTimeout(500); } // 全画面の切り替えは非同期
    return () => {
      assert.equal(shownBefore, false, `${button} is not shown`);
      assert.equal(focused, false, `${button} cannot take keyboard focus`);
    };
  };
  // 全画面の出入りは非同期で、fullscreenElement が先に変わり、fullscreenchange (.fullscreen の付け外し) が後から届く。
  // 起きるべき変化は固定の待ちでなく、状態がそろうまで期限付きで待つ (遅い CI でも同じ結果になるように)。
  // 起きないことの確認 (全画面に入っていない等) だけは、固定の待ちのあとに確かめる
  const until = async (p, predicate, message, arg) => {
    try { await p.waitForFunction(predicate, arg, { timeout: 5000 }); } catch {
      const now = await p.evaluate(() => ({ fullscreen: document.fullscreenElement && (document.fullscreenElement.id || document.fullscreenElement.className),
        container: document.querySelector('.fullscreen-sketch-container').className, seen: window.fs103,
        mapping: document.querySelector('#open-windows-btn').hidden, editor: !document.querySelector('#dc-inline-editor').hidden }));
      assert.fail(`${message} (state: ${JSON.stringify(now)})`);
    }
  };
  const enterFullscreen = (p, message) => until(p, () => document.fullscreenElement !== null
    && document.querySelector('.fullscreen-sketch-container.fullscreen') && document.querySelector('#open-windows-btn').hidden, message);
  const leaveFullscreen = (p, message) => until(p, () => document.fullscreenElement === null
    && !document.querySelector('.fullscreen-sketch-container.fullscreen') && !document.querySelector('#open-windows-btn').hidden
    && !document.querySelector('#fullscreen-btn').hidden, message);
  const isFullscreen = p => p.evaluate(() => document.fullscreenElement !== null);
  const editorOpen = p => p.locator('#dc-inline-editor').isVisible();
  const layout = p => p.evaluate(() => {
    const c = document.querySelector('.fullscreen-sketch-container');
    return { classes: [...c.classList].sort().join(' '), buttons: ['#fullscreen-btn', '#open-windows-btn'].map(s => {
      const b = document.querySelector(s), style = getComputedStyle(b);
      return `${s}:${style.display}/${style.opacity}/${style.pointerEvents}/${b.disabled}/${b.hidden}`;
    }).join(' ') };
  });
  const initial = await layout(page);

  // 1) 全画面にすると、マッピングの入口は出ず、キーボードでも入れない
  await fullscreen.click(); await enterFullscreen(page, '⛶ enters fullscreen and hides the mapping entry');
  await page.mouse.move(600, 400); await page.mouse.move(620, 420); // 全画面中に隠れた UI を出す
  await snapshot(page, base.name + '-fullscreen');
  const mappingHidden = await pressViaKeyboard(page, '#open-windows-btn');
  await notBlack(page, 'fullscreen');
  assert.equal(await editorOpen(page), false, 'fullscreen: no key opens the editor');
  assert.equal(await isFullscreen(page), true);
  assert.deepEqual(await shown(page), { editor: false, sketch: true });
  mappingHidden();
  // 2) 全画面を ⛶ で抜けると、レイアウトとマッピングの入口が元に戻る
  await fullscreen.click(); await leaveFullscreen(page, '⛶ leaves fullscreen and brings both entries back');
  assert.deepEqual(await layout(page), initial, 'leaving fullscreen restores the layout');
  // 3) 編集中は全画面の入口が出ず、キーボード (⛶ へのフォーカス、F キー) でも全画面にならない
  await mapping.click(); await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth > 0);
  await snapshot(page, base.name + '-editing');
  const fullscreenHidden = await pressViaKeyboard(page, '#fullscreen-btn');
  for (const key of ['f', 'F']) { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(key); }
  await page.waitForTimeout(500);
  await notBlack(page, 'editing');
  assert.equal(await isFullscreen(page), false, 'editing: no key enters fullscreen');
  assert.deepEqual(await shown(page), { editor: true, sketch: false });
  fullscreenHidden();
  // 4) 想定外の経路で編集中に全画面へ入っても、すぐ抜けて編集を見せ続ける。コンテナでも作品の iframe でも同じ
  const settle = p => p.waitForTimeout(500); // 全画面の出入りは非同期
  const fsElement = p => p.evaluate(() => document.fullscreenElement && (document.fullscreenElement.id || document.fullscreenElement.className));
  // 編集画面の中央で実際に指している要素のカーソル (none ならカーソルが消えている)
  const editorCursor = p => p.evaluate(() => {
    const r = document.querySelector('#dc-inline-editor').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el && document.querySelector('#dc-inline-editor').contains(el) ? getComputedStyle(el).cursor : `not on the editor: ${el?.tagName}`;
  });
  const gesture = (p, action) => p.evaluate(action => {
    // Playwright のクリックをユーザー操作として、その処理の中で全画面を要求する
    document.querySelector('#fs103')?.remove();
    const b = document.createElement('button'); b.id = 'fs103'; b.textContent = 'fs';
    b.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999';
    b.onclick = new Function(action); document.body.append(b);
    window.fs103 = []; // fullscreenchange ごとの全画面要素 (入ったことの確認)
    window.fsName = el => el && (el.id || (el.classList.contains('fullscreen-sketch-container') ? 'container' : el.tagName));
    document.onfullscreenchange = () => window.fs103.push(window.fsName(document.fullscreenElement));
  }, action).then(() => p.locator('#fs103').click());
  // 全画面に一度入り (fullscreenchange で要素 name)、その後に抜けた (null) ところまで待つ
  const enteredThenLeft = name => until(page, name => window.fs103.join() === `${name},` && document.fullscreenElement === null
    && !document.querySelector('.fullscreen-sketch-container.fullscreen'), `${name} fullscreen entered while editing is exited at once`, name);
  await gesture(page, `document.querySelector('.fullscreen-sketch-container').requestFullscreen()`);
  await enteredThenLeft('container');
  assert.deepEqual(await shown(page), { editor: true, sketch: false }, 'the editor stays after the container fullscreen');
  await gesture(page, `document.querySelector('#sketch-iframe').contentDocument.documentElement.requestFullscreen()`);
  await enteredThenLeft('sketch-iframe');
  assert.deepEqual(await shown(page), { editor: true, sketch: false }, 'the editor stays after the sketch fullscreen');
  // 全画面のクラス (.fullscreen) が編集中に付いても、編集は隠れず、カーソルも消えない (黒画面の規則が戻ると赤くなる)
  await page.evaluate(() => document.querySelector('.fullscreen-sketch-container').classList.add('fullscreen'));
  await notBlack(page, 'the fullscreen class while editing');
  assert.notEqual(await editorCursor(page), 'none', 'the fullscreen class while editing keeps the cursor on the editor');
  await page.evaluate(() => { document.querySelector('.fullscreen-sketch-container').classList.remove('fullscreen'); document.querySelector('#fs103').remove(); });
  // 5) 編集を閉じると全画面の入口が戻り、全画面に入れる
  await closeEditor(page);
  assert.deepEqual(await layout(page), initial, 'closing the editor restores the layout');
  await fullscreen.click(); await enterFullscreen(page, '⛶ enters fullscreen again after the editor closes');
  await page.evaluate(() => document.exitFullscreen()); await leaveFullscreen(page, 'leaving that fullscreen brings both entries back');
  // 6) ⛶ の全画面が確定する前に (同じ操作の中で) マッピングを押しても、全画面と編集は重ならない
  await gesture(page, `document.querySelector('#fullscreen-btn').click(); document.querySelector('#open-windows-btn').click();`);
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth > 0);
  assert.equal(await editorOpen(page), true, '⛶ then mapping in one task opens the editor');
  // ⛶ の要求は編集の開始より後に確定する。入って抜けるところまで待ち、その後は全画面に戻らないことを確かめる
  await until(page, () => window.fs103.join() === 'container,' && document.fullscreenElement === null, '⛶ then mapping in one task leaves fullscreen');
  await settle(page);
  assert.equal(await fsElement(page), null, '⛶ then mapping in one task stays out of fullscreen');
  assert.notEqual(await editorCursor(page), 'none', '⛶ then mapping in one task keeps the cursor on the editor');
  await page.evaluate(() => document.querySelector('#fs103').remove());
  await closeEditor(page);
  assert.deepEqual(await layout(page), initial, 'closing that editor restores the layout');

  // 7) 作品の読み込み前に ⛶ を押しても、全画面の間はマッピングの入口が出ない
  const early = await page.context().newPage();
  let releaseSketch; const held = new Promise(resolve => { releaseSketch = resolve; });
  await early.route('**/sketches/a/index.html', async route => { await held; await route.fulfill({ contentType: 'text/html', body: sketchHtml() }); });
  await early.goto(base.url + '/a'); await early.waitForSelector('#fullscreen-btn');
  await early.locator('#fullscreen-btn').click(); await early.waitForFunction(() => document.fullscreenElement !== null);
  await enterFullscreen(early, 'fullscreen before the sketch loads is reflected and hides the mapping entry');
  await early.mouse.move(600, 400); await early.mouse.move(620, 420);
  assert.equal(await early.locator('#open-windows-btn').isVisible(), false, 'fullscreen before the sketch loads hides the mapping entry');
  releaseSketch();
  await early.waitForFunction(() => document.querySelector('#sketch-iframe')?.contentDocument?.querySelector('canvas'));
  assert.equal(await early.locator('#open-windows-btn').isVisible(), false, 'the mapping entry stays hidden after the sketch loads');
  // 読み込み後の作品の上でマウスを動かしても、自動で隠れた UI が戻る (作品の document の操作も拾う)
  await early.waitForFunction(() => document.querySelector('#fullscreen-btn').style.opacity === '0', null, { timeout: 6000 });
  await early.mouse.move(700, 450); await early.mouse.move(720, 470);
  await early.waitForFunction(() => document.querySelector('#fullscreen-btn').style.opacity === '1', null, { timeout: 2000 })
    .catch(() => assert.fail('moving over the loaded sketch shows the hidden UI again'));
  await early.evaluate(() => document.exitFullscreen());
  await leaveFullscreen(early, 'leaving fullscreen brings the mapping entry back');
  await early.close();

  // OP / Gist と同じ srcdoc 経路の作品でも、全画面中はマッピングに入れない
  const other = await page.context().newPage();
  await other.goto(base.url + '/b'); await other.waitForSelector('#sketch-iframe');
  await other.locator('#fullscreen-btn').click(); await enterFullscreen(other, 'srcdoc: ⛶ enters fullscreen and hides the mapping entry');
  await other.mouse.move(600, 400); await other.mouse.move(620, 420);
  const srcdocHidden = await pressViaKeyboard(other, '#open-windows-btn');
  await notBlack(other, 'srcdoc fullscreen');
  assert.equal(await editorOpen(other), false, 'srcdoc fullscreen: no key opens the editor');
  srcdocHidden();
  await other.close();
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
      for (const [testName, run] of Object.entries({ workspace, workspaceSlideshow: workspace, lifecycle, projects, slideshow, slideshowShortcuts, recovery, outputs, unavailable, cancellation, loading, confirmClose, history, maskSelect, sample, slideshowDraft, fullscreenMapping })) {
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
