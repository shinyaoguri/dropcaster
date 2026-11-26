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
/** 左端のアクティビティバーでツールカラムに `name` のパネルを出す。選択中で開いていれば押さない (押すと畳むため)。 */
async function showPanel(page, name) {
  const button = page.locator(`#dc-activity-${name}`);
  if (await button.getAttribute('aria-selected') !== 'true' || await button.getAttribute('aria-expanded') === 'false') await button.click();
  await page.locator(`#dc-tool-panel-${name}`).waitFor();
}
async function activePanel(page) { return page.locator('.dc-activity-btn[aria-selected="true"]').getAttribute('data-tool-panel'); }
async function projectControls(page) { await showPanel(page, 'project'); await page.locator('#dc-practice-project').waitFor(); }
/** プロジェクトパネルで操作し、終わったら元のパネルへ戻す。 */
async function inProjectPanel(page, run) {
  const previous = await activePanel(page);
  await projectControls(page);
  try { return await run(); } finally { await showPanel(page, previous); }
}
async function exportProject(page, selector = '#practice-export') {
  return inProjectPanel(page, async () => {
    const promise = page.waitForEvent('download'); await page.locator(selector).click();
    const stream = await (await promise).createReadStream(); const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  });
}
async function importProject(page, value) {
  await inProjectPanel(page, async () => {
    await page.locator('#practice-project-file').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    // 取り込みは検証だけで確定する。3D を読み込み済みなら、会場の作り直しが終わるまで待つ (#169)。
    await page.waitForFunction(() => !document.querySelector('#dc-practice-status').textContent.includes('Loading venue')
      && !document.querySelector('.dc-practice-panel[aria-busy="true"]'));
  });
}
// #198: 固定文言に置き換えた失敗でも、元の例外が console に残ることを確かめる。context ごとに全ページの出力を集める。
const consoleLines = new WeakMap();
async function logged(page, pattern, count = 1) {
  const lines = consoleLines.get(page.context()), hits = () => lines.filter(line => pattern.test(line)).length;
  for (let i = 0; i < 50 && hits() < count; i++) await page.waitForTimeout(100);
  assert.ok(hits() >= count, `console keeps the original error ${pattern} (${hits()}/${count})\n${lines.join('\n')}`);
}
function observeConsole(context) {
  const lines = []; consoleLines.set(context, lines);
  context.on('page', page => page.on('console', message => lines.push(message.text())));
}
/** 状態欄は平常時は読み上げ専用で、1px に畳んだ親に切り取られている。文字の中央がその要素に当たることで、画面に出ていることを確かめる。 */
async function statusShown(page) {
  return page.evaluate(() => {
    const status = document.querySelector('#dc-practice-status'), box = status.getBoundingClientRect();
    return box.width > 0 && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === status;
  });
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
  // マッピング・出力・確認のパネルを行き来するだけでは 3D を読み込まない (ADR 0012)。
  assert.equal(await activePanel(page), 'mappings', 'the editor opens on mappings');
  await showPanel(page, 'check'); await showPanel(page, 'outputs');
  assert.equal(await page.locator('#mapping-tab').getAttribute('aria-selected'), 'true');
  await page.locator('#add-output-btn').click(); await showPanel(page, 'mappings'); await page.locator('#add-mapping-btn').click();
  await showPanel(page, 'outputs');
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
  // 見出し行はパネル名と編集履歴だけ。閉じるはアクティビティバーの下端にある (#215)。
  assert.deepEqual(await page.locator('.tool-column > .column-header').evaluate(h => [...h.children].map(e => e.id || e.className)), ['dc-tool-panel-title', 'dc-history'], 'panel title, then history');
  assert.equal(await page.locator('.dc-activity-bar-footer #practice-stop').count(), 1, 'close sits at the bottom of the activity bar');
  await showPanel(page, 'preview3d'); await snapshot(page, base.name + '-desktop-ja');
  await page.setViewportSize({ width: 900, height: 800 }); await snapshot(page, base.name + '-narrow-ja');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 }); await showPanel(page, 'outputs');
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
  // 検証を通った GLB は取り込みを確定する。3D で会場を作れなくても取り消さず、3D の失敗として理由を知らせる (#169、ADR 0010)。
  const emptyModel = structuredClone(baseline); emptyModel.assets[0].data = Buffer.from(venueFixture(d => { d.scenes[0].nodes = []; })).toString('base64'); await importProject(page, emptyModel);
  const unbuildable = async () => {
    await page.waitForSelector('#practice-retry:not([hidden])');
    assert.match(await page.locator('#dc-practice-status').textContent(), /300,000 triangles/);
    assert.equal(await page.locator('#dc-practice-status').evaluate(e => e.classList.contains('is-error')), true);
  };
  await unbuildable();
  assert.equal(await page.locator('#mapping-tab').getAttribute('aria-selected'), 'true', '2D editing continues');
  assert.equal((await exportProject(page)).assets[0].data, emptyModel.assets[0].data, 'a validated import is kept when only the 3D build fails');
  await page.locator('#practice-retry').click(); await unbuildable(); // 再試行しても同じ会場は作れない
  // 取り込み前に戻すと、3D を裏で読み込み直して元の会場に戻る。再試行だけが残ることはない。
  await projectControls(page); await page.locator('#practice-undo-import').click();
  const restored = await exportProject(page);
  assert.deepEqual(restored.assets, baseline.assets); assert.deepEqual(restored.venue.scene, baseline.venue.scene);
  await page.locator('.dc-practice-background').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#practice-retry').isHidden(), true, 'undo leaves no stale retry');
  await page.locator('#preview-tab').click(); await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(() => document.querySelector('#practice-dimensions')?.textContent === 'Venue size: 12.00 × 4.00 × 0.00 m');
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
  await projectControls(page); // 開き直した編集は「マッピング」から始まる
  await snapshot(page, base.name + '-glb');
  const missing = structuredClone(saved); missing.content[0].ref = 'missing-local-sketch';
  await importProject(page, missing);
  await page.evaluate(() => { window.previousWC = window.practiceWC; });
  await page.locator('#practice-open-content').click();
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.includes('unavailable here'));
  assert.equal(await page.evaluate(() => window.practiceWC === window.previousWC), true, 'unavailable content keeps the working view');
  assert.equal(await statusShown(page), true, 'the unavailable-content notice is on screen, not only announced');
  await logged(page, /Missing local sketch/);
  await importProject(page, saved);
  // #198: 下書きを読み出せないときは、作品を取得できないときとは別の案内にし、作業中の画面を保つ。
  await page.evaluate(() => { window.realTransaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (...args) { if (args[1] !== 'readwrite') throw new DOMException('test draft read', 'InvalidStateError'); return window.realTransaction.apply(this, args); }; });
  await page.locator('#practice-open-content').click();
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.includes('could not be read'));
  assert.doesNotMatch(await page.locator('#dc-practice-status').textContent(), /unavailable here/, 'an unreadable draft is not reported as a missing sketch');
  assert.equal(await page.evaluate(() => window.practiceWC === window.previousWC), true, 'an unreadable draft keeps the working view');
  assert.equal(await statusShown(page), true, 'the unreadable-draft notice is on screen, not only announced');
  await logged(page, /test draft read/);
  await snapshot(page, base.name + '-project-draft-unreadable');
  // 案内は MappingWorkspace の状態文の規則を通す。言語を切り替えても、元の状態文に戻らず訳し直される
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('ja'), base.modules);
  assert.match(await page.locator('#dc-practice-status').textContent(), /読み出せませんでした/, 'the notice is translated, not dropped, when the language changes');
  assert.equal(await statusShown(page), true, 'the notice stays on screen after a language change');
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('en'), base.modules);
  // 保存済みプロジェクトの読み出しの失敗は、設定の誤りとは案内しない
  await projectControls(page); await page.locator('#practice-open-project').click();
  await page.waitForFunction(() => document.querySelector('#dc-practice-status').textContent.includes('nothing was changed'));
  assert.doesNotMatch(await page.locator('#dc-practice-status').textContent(), /Invalid settings/, 'a failed read is not reported as invalid settings');
  await logged(page, /test draft read/, 2);
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.realTransaction; });
  // Browser-storage failure keeps edits/export available and reports the failure.
  await page.evaluate(() => { window.realTransaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (...args) { if (args[1] === 'readwrite') throw new DOMException('test quota', 'QuotaExceededError'); return window.realTransaction.apply(this, args); }; });
  await change(page, '#practice-project-name', 'Unsaved but exportable');
  await logged(page, /test quota/); // 作業中の下書きの書き込み
  await page.locator('#practice-save').click(); await page.waitForFunction(() => document.querySelector('#practice-storage').textContent.includes('Could not save'));
  await logged(page, /test quota/, 2); // 名前を付けて保存も、握った例外を残す
  assert.equal((await exportProject(page)).name, 'Unsaved but exportable');
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.realTransaction; });
  // A second browser context receives all geometry/images/optics via one package.
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', locale: 'en-US' });
  try {
    const other = await setup(second, base); await start(other); await importProject(other, saved);
    assert.equal((await exportProject(other)).assets[0].data, saved.assets[0].data);
    assert.equal(await other.locator('#practice-dimensions').textContent(), 'Venue size: 12.00 × 4.00 × 0.00 m');
  } finally { await second.close(); }
  // #198: /project を直接開いたときの案内。下書きが無い・壊れている・作品を取得できない、を分ける。
  const direct = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', locale: 'en-US' });
  try {
    observeConsole(direct);
    const other = await setup(direct, base);
    const openDirect = async draft => {
      if (draft) await other.evaluate(async ({ modules, draft }) => (await import(`${modules}/practice/projectStore.ts`)).writeProject(draft), { modules: base.modules, draft });
      await other.goto(base.url + '/project'); await other.waitForSelector('.sketch-error');
      return other.locator('.sketch-error').innerText();
    };
    const none = await openDirect();
    assert.match(none, /Could not open the saved project/); assert.match(none, /No working project is saved/);
    assert.doesNotMatch(none, /unavailable here|Could not load sketch/, 'a missing draft is not reported as a missing sketch');
    assert.equal(await other.locator('.sketch-error [data-reload]').count(), 0, 'reloading cannot create a draft');
    const broken = await openDirect({ ...saved, schemaVersion: 99 });
    assert.match(broken, /could not be read/); assert.doesNotMatch(broken, /unavailable here|Could not load sketch/, 'an invalid draft is not reported as a missing sketch');
    assert.equal(await other.locator('.sketch-error [data-reload]').count(), 1);
    await logged(other, /ProjectFormatError: version/);
    await snapshot(other, base.name + '-project-open-error');
    const gone = structuredClone(saved); gone.content[0].ref = 'missing-local-sketch';
    assert.match(await openDirect(gone), /unavailable here/, 'a missing sketch is still reported as one');
    await logged(other, /Missing local sketch/);
  } finally { await direct.close(); }
  // #198: 下書きを読み出せないときも 3D は開く。読み出し (下書きの復元・保存済み一覧) の例外を両方残す。
  // 状態欄の表示は続く書き込みが成功すると保存済みに戻るので、ここでは待たない。
  const unreadable = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', locale: 'en-US' });
  try {
    observeConsole(unreadable);
    await unreadable.addInitScript(() => { const real = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (...args) { if (args[1] !== 'readwrite') throw new DOMException('test restore read', 'InvalidStateError'); return real.apply(this, args); }; });
    const other = await setup(unreadable, base); await start(other);
    await logged(other, /test restore read/, 2);
  } finally { await unreadable.close(); }
  // #198: 作品を取得できた後、開く途中の失敗も黙って捨てず、案内と元の例外を残す。この後 page の作業画面は使わない。
  await page.evaluate(async modules => {
    const { SketchPageController } = await import(`${modules}/components/SketchPageController.ts`);
    SketchPageController.prototype.openProject = async () => { throw new Error('test open failure'); };
  }, base.modules);
  await page.locator('#practice-open-content').click(); await page.waitForSelector('.sketch-error');
  const opening = await page.locator('.sketch-error').innerText();
  assert.match(opening, /Could not open the saved project/); assert.match(opening, /could not be opened/);
  assert.equal(await page.locator('.sketch-error [data-reload]').count(), 1);
  await logged(page, /test open failure/);
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
  await page.locator('#mapping-tab').click(); await showPanel(page, 'mappings'); await page.locator('#add-mapping-btn').click(); await page.waitForTimeout(700); await storageSaved(page);
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
  await showPanel(page, 'check'); await page.locator('[data-pattern="grid"]').click(); await page.waitForFunction(() => document.querySelector('#source-video').videoWidth === 1920);
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
  await projectControls(page); await page.locator('#practice-open-content').click(); await page.waitForURL('**/project**');
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
  for (let i = 0; i < 3; i++) { await showPanel(page, 'outputs'); await page.locator('#add-output-btn').click(); await showPanel(page, 'mappings'); await page.locator('#add-mapping-btn').click(); }
  await showPanel(page, 'outputs');
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
  await showPanel(page, 'preview3d'); await page.locator('#practice-output').selectOption(last);
  const calibration = await exportProject(page); calibration.venue.projectors.find(p=>p.outputId===last).position[0] = 7.5; await importProject(page,calibration);
  const optics = (await exportProject(page)).venue.projectors.find(p => p.outputId === last);
  await showPanel(page, 'outputs'); await page.locator(`#outputs-list [data-output-id="${first}"] .remove-output-btn`).click();
  const exported = await exportProject(page);
  assert.equal(exported.venue.projectors.length, 3);
  assert.deepEqual(exported.venue.projectors.find(p => p.outputId === last), optics);
  assert.equal(exported.venue.layout.outputs.find(o => o.id === last).position.x, 3840);
  await page.locator('#add-output-btn').click(); await showPanel(page, 'mappings'); await page.locator('#add-mapping-btn').click();
  await showPanel(page, 'outputs');
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
/** 出力の削除を Undo / Redo で戻すと、その出力のプロジェクタ校正値も削除前に戻る (#165)。出力ウィンドウは開き直さない (#161)。 */
async function outputUndo(page) {
  await start(page);
  const undoBtn = page.locator('#dc-undo-btn'), redoBtn = page.locator('#dc-redo-btn');
  await showPanel(page, 'outputs'); await page.locator('#add-output-btn').click();
  const [kept, target] = (await state(page)).outputs.map(o => o.id);
  const calibrated = await exportProject(page);
  Object.assign(calibrated.venue.projectors.find(p => p.outputId === target),
    { position: [7.5, 1.25, -3], quaternion: [0, 0.6, 0, 0.8], verticalFovDegrees: 31, lensShift: [0.2, -0.4], near: 0.5, far: 80 });
  Object.assign(calibrated.venue.projectors.find(p => p.outputId === kept), { position: [-2, 3, 6], lensShift: [0, 0.3] });
  await importProject(page, calibrated);
  const projectors = async () => (await exportProject(page)).venue.projectors;
  const before = await projectors();
  assert.deepEqual(before.map(p => [p.outputId, p.position]), [[kept, [-2, 3, 6]], [target, [7.5, 1.25, -3]]], 'the calibration was imported');
  assert.equal(await undoBtn.isDisabled(), true, 'loading a project starts a new edit history');
  await showPanel(page, 'outputs');
  const remove = id => page.locator(`#outputs-list [data-output-id="${id}"] .remove-output-btn`).click();
  const promise = page.waitForEvent('popup');
  await page.locator(`#outputs-list [data-output-id="${target}"] .open-btn`).click();
  const popup = await promise, closed = popup.waitForEvent('close');

  await remove(target); await closed;
  assert.deepEqual(await projectors(), [before[0]], 'removing an output leaves the other projector alone');
  await undoBtn.click();
  assert.deepEqual((await state(page)).outputs.map(o => o.id), [kept, target]);
  assert.deepEqual(await projectors(), before, 'undoing the removal restores the whole calibration');
  await redoBtn.click();
  assert.deepEqual(await projectors(), [before[0]]);
  await undoBtn.click();
  assert.deepEqual(await projectors(), before, 'redo then undo restores it again');
  // 先頭の出力を消して残りが詰められても、戻せば両方とも元の値になる。
  await remove(kept);
  assert.deepEqual(await projectors(), [before[1]], 'compaction does not move the remaining projector');
  await undoBtn.click();
  assert.deepEqual(await projectors(), before, 'undo restores the first output without touching the other');
  // 2D の設定の読込で出力がすべて入れ替わっても、戻せば元の出力は元の値になる。
  const settings = await state(page);
  settings.outputs = [{ ...settings.outputs[0], id: 'replacement' }]; settings.activeOutputId = 'replacement';
  await inProjectPanel(page, async () => {
    const chooser = page.waitForEvent('filechooser'); await page.locator('#import-settings-btn').click();
    await (await chooser).setFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(settings)) });
    await page.waitForFunction(() => window.practiceWC.events.state.get().outputs[0].id === 'replacement');
  });
  assert.deepEqual((await projectors()).map(p => [p.outputId, p.position]), [['replacement', [0, 2.5, 4.5]]], 'an output never seen starts from the default projector');
  await undoBtn.click();
  assert.deepEqual(await projectors(), before, 'undoing a settings import restores every projector');
  await page.waitForTimeout(300);
  assert.equal(page.context().pages().length, 1, 'undo does not reopen the output window');
  await closeEditor(page);
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
// #169: WebGL が使えなくても、プロジェクトの節 (名前・保存・複製・開く・書き出し・取り込み・会場の書き出し・取り込み前に戻す) を
// すべて使える。節を開く・名前・保存・書き出しでは Three.js を読み込まず、WebGL も初期化しない。形のある会場を取り込む・開くときだけ
// 3D を裏で読み込み (#169 の (b))、その失敗は知らせるが取り込みは確定したまま。
async function projectWithoutWebgl(page, base) {
  await page.evaluate(() => {
    window.webglAttempts = 0; window.originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/.test(type)) { window.webglAttempts++; return null; }
      return window.originalGetContext.call(this, type, ...args);
    };
  });
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await projectControls(page);
  const status = page.locator('#dc-practice-status'), failed = () => status.evaluate(e => e.classList.contains('is-error'));
  const name = () => page.locator('#practice-project-name').inputValue();
  const attempts = () => page.evaluate(() => window.webglAttempts);
  const threeLoaded = () => observedRequests.get(page).some(url => /three(?:\.js|\.module|_addons)|PracticePanel|ProjectionPreview|loadVenue/.test(url));
  const saved = page.locator('#practice-saved-projects');
  const openSaved = async label => {
    await saved.selectOption({ label }); await page.locator('#practice-open-project').click();
    await page.waitForFunction(label => document.querySelector('#practice-project-name').value === label, label);
  };
  /** 取り込み・開くの後の裏の読み込みが、WebGL を作れずに 3D の失敗として終わるのを待つ。 */
  const backgroundLoadFails = async before => {
    await page.waitForFunction(before => window.webglAttempts > before, before);
    await page.waitForSelector('#practice-retry:not([hidden])');
    assert.match(await status.textContent(), /3D is unavailable/); assert.equal(await failed(), true);
    assert.equal(await page.locator('#mapping-tab').getAttribute('aria-selected'), 'true', '2D editing continues');
  };
  // 名前・書き出し・名前を付けて保存・複製・保存済みを開く・会場の書き出し・形の無い会場の取り込みと戻すは、3D を読み込まない。
  await change(page, '#practice-project-name', 'No GPU show');
  const first = await exportProject(page);
  assert.equal(first.format, 'dropcaster-project'); assert.equal(first.name, 'No GPU show'); assert.equal(first.venue.scene.kind, 'sample');
  await page.locator('#practice-save').click(); await page.waitForFunction(() => document.querySelector('#practice-saved-projects').options.length === 1);
  await change(page, '#practice-project-name', 'No GPU copy');
  await page.locator('#practice-duplicate').click(); await page.waitForFunction(() => document.querySelector('#practice-saved-projects').options.length === 2);
  assert.deepEqual((await saved.locator('option').allTextContents()).sort(), ['No GPU copy', 'No GPU show']);
  await openSaved('No GPU show');
  assert.equal((await exportProject(page)).id, first.id);
  const sampleVenue = await exportProject(page, '#practice-export-venue');
  assert.equal(sampleVenue.format, 'dropcaster-venue'); assert.equal(sampleVenue.venue.scene.kind, 'sample');
  const x = first.venue.projectors[0].position[0]; sampleVenue.venue.projectors[0].position[0] = x + 1;
  await importProject(page, sampleVenue);
  assert.match(await status.textContent(), /Venue loaded/); assert.equal(await failed(), false);
  assert.equal((await exportProject(page)).venue.projectors[0].position[0], x + 1);
  await page.locator('#practice-undo-import').click();
  assert.equal((await exportProject(page)).venue.projectors[0].position[0], x);
  assert.equal(await attempts(), 0, 'project operations without a venue shape do not initialize WebGL');
  assert.equal(threeLoaded(), false, 'project operations without a venue shape do not load Three');
  assert.equal(await page.locator('#practice-retry').isHidden(), true, 'no 3D failure is reported before 3D is needed');
  // 会場 (GLB) とプロジェクタ付きのプロジェクトを取り込むと 3D を裏で読み込む。WebGL が無いのでその失敗を知らせるが、
  // 取り込みは確定し、書き出し直しても会場・プロジェクタ・資産が保たれる。
  const withVenue = structuredClone(first);
  withVenue.assets = [{ id: 'wall-glb', name: 'wall.glb', mimeType: 'model/gltf-binary', data: Buffer.from(venueFixture()).toString('base64') }];
  withVenue.venue.scene = { ...withVenue.venue.scene, kind: 'glb', assetId: 'wall-glb' };
  Object.assign(withVenue.venue.projectors[0], { verticalFovDegrees: 50, lensShift: [0, -.07], position: [1.25, 2, 4] });
  await importProject(page, withVenue); await backgroundLoadFails(0);
  assert.equal(threeLoaded(), true, 'importing a venue shape loads 3D in the background');
  const round = await exportProject(page);
  assert.deepEqual(round.assets, withVenue.assets); assert.deepEqual(round.venue.scene, withVenue.venue.scene);
  assert.deepEqual(round.venue.projectors, withVenue.venue.projectors);
  // 3D を読み込んだ後も、名前・保存・書き出しは 3D を読み込み直さない。壊れた GLB は WebGL が無くても拒否し、作業中のプロジェクトを変えない。
  const tried = await attempts();
  await change(page, '#practice-project-name', 'No GPU venue');
  await page.locator('#practice-save').click(); await page.waitForFunction(() => [...document.querySelector('#practice-saved-projects').options].some(o => o.text === 'No GPU venue'));
  const named = await exportProject(page); assert.equal(named.name, 'No GPU venue');
  const venueFile = await exportProject(page, '#practice-export-venue');
  assert.equal(venueFile.format, 'dropcaster-venue'); assert.deepEqual(venueFile.assets, withVenue.assets);
  assert.deepEqual(venueFile.venue.projectors, withVenue.venue.projectors); assert.equal('content' in venueFile, false);
  await importProject(page, { ...named, assets: [{ ...named.assets[0], data: Buffer.from('broken').toString('base64') }] });
  assert.match(await status.textContent(), /missing or damaged/); assert.equal(await failed(), true);
  assert.deepEqual(await exportProject(page), named, 'a rejected import does not change the project');
  assert.equal(await attempts(), tried, 'naming, saving, exporting and a rejected import do not load 3D again');
  // 保存済みを開く: 形の無い会場は読み込まず、形のある会場は裏で読み込む (失敗しても開いた内容は残る)。
  await openSaved('No GPU copy'); assert.equal((await exportProject(page)).venue.scene.kind, 'sample');
  assert.equal(await attempts(), tried, 'opening a saved project without a venue shape does not load 3D');
  await openSaved('No GPU venue'); await backgroundLoadFails(tried);
  const reopened = await exportProject(page);
  assert.equal(reopened.id, first.id); assert.deepEqual(reopened.assets, withVenue.assets); assert.deepEqual(reopened.venue.projectors, withVenue.venue.projectors);
  // 会場ファイルを取り込み、取り込み前に戻す。
  venueFile.venue.projectors[0].position[0] = 2.5;
  const beforeVenue = await attempts();
  await importProject(page, venueFile); await backgroundLoadFails(beforeVenue);
  const received = await exportProject(page);
  assert.equal(received.venue.projectors[0].position[0], 2.5); assert.equal(received.name, 'No GPU venue'); assert.deepEqual(received.assets, withVenue.assets);
  assert.equal(await page.locator('#practice-undo-import').isEnabled(), true);
  const beforeUndo = await attempts();
  await page.locator('#practice-undo-import').click(); await backgroundLoadFails(beforeUndo); // 戻した先も形のある会場
  assert.equal((await exportProject(page)).venue.projectors[0].position[0], 1.25, 'undo restores the project before the import');
  // 3D を開いても失敗を知らせるだけで、プロジェクトの節はそのまま残る。
  await page.locator('#preview-tab').click(); await page.waitForSelector('#practice-retry:not([hidden])');
  assert.match(await status.innerText(), /3D is unavailable/);
  assert.equal(await page.locator('#practice-export').count(), 1); assert.equal(await page.locator('#practice-export').isVisible(), true);
  assert.equal(await name(), 'No GPU venue');
  await change(page, '#practice-project-name', 'Still editable');
  assert.equal((await exportProject(page)).name, 'Still editable');
  // 「保存した作品を開く」(/project) も、3D の失敗を知らせるだけでプロジェクトの節を残す。
  await page.locator('#practice-open-content').click(); await page.waitForURL('**/project');
  await page.waitForSelector('#practice-retry:not([hidden])'); await projectControls(page);
  assert.equal(await name(), 'Still editable');
  assert.deepEqual((await exportProject(page)).assets, withVenue.assets);
  // WebGL が使えるようになったら、再試行で取り込み済みの会場が 3D に出る。
  await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.originalGetContext; });
  await observeControllers(page, base);
  await page.locator('#practice-retry').click(); await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(() => document.querySelector('#practice-dimensions')?.textContent === 'Venue size: 6.00 × 4.00 × 0.00 m');
  assert.equal(await page.evaluate(() => window.practicePreview.diagnostics().venueTriangles), 2);
  assert.equal(await page.evaluate(() => window.practicePreview.projector.fov), 50);
  await closeEditor(page);
}
// #169 の (b): WebGL が使える環境で、「プロジェクト」パネルから形のある会場を取り込む・保存済みを開くと、3D のタブを開かなくても
// 確定の後に 3D を裏で読み込み、2D 編集の背景 (プロジェクタ視点の会場) がすぐ出る。作れない会場の失敗は、取り込み前に戻せるうちに分かる。
async function projectImport3d(page, base) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await projectControls(page);
  const status = page.locator('#dc-practice-status'), failed = () => status.evaluate(e => e.classList.contains('is-error'));
  const background = page.locator('.dc-practice-background');
  const loaded = () => observedRequests.get(page).some(url => /PracticePanel/.test(url));
  const onMapping = async () => assert.equal(await page.locator('#mapping-tab').getAttribute('aria-selected'), 'true', 'the mapping tab stays selected');
  await change(page, '#practice-project-name', 'Background');
  const first = await exportProject(page);
  await page.locator('#practice-save').click(); await page.waitForFunction(() => document.querySelector('#practice-saved-projects').options.length === 1);
  assert.equal(loaded(), false, 'opening the project panel, naming, saving and exporting do not load 3D');
  const glb = (data, from = first) => {
    const project = structuredClone(from);
    project.assets = [{ id: 'wall-glb', name: 'wall.glb', mimeType: 'model/gltf-binary', data: Buffer.from(data).toString('base64') }];
    project.venue.scene = { ...project.venue.scene, kind: 'glb', assetId: 'wall-glb' };
    return project;
  };
  // 3D で作れない会場 (三角形 0) は、3D を開いていなくても取り込みの直後に理由と再試行が出る。取り込み前に戻せる。
  const empty = glb(venueFixture(d => { d.scenes[0].nodes = []; }));
  await importProject(page, empty);
  await page.waitForSelector('#practice-retry:not([hidden])');
  const committed = /300,000 triangles/;
  assert.match(await status.textContent(), committed); assert.equal(await failed(), true);
  assert.equal(await statusShown(page), true, 'the failure is on screen right after the import');
  assert.equal(loaded(), true, 'importing a venue shape loads 3D in the background'); await onMapping();
  assert.equal((await exportProject(page)).assets[0].data, empty.assets[0].data, 'the validated import is kept');
  assert.equal(await page.locator('#practice-undo-import').isEnabled(), true, 'undo is still available when the failure shows');
  await page.locator('#practice-undo-import').click();
  const restored = await exportProject(page);
  assert.deepEqual(restored.assets, first.assets); assert.deepEqual(restored.venue.scene, first.venue.scene);
  assert.equal(await page.locator('#practice-retry').isHidden(), true, 'returning to a venue without a shape leaves no stale retry');
  assert.equal(await failed(), false);
  // 作れる会場は、3D のタブを開かずに 2D 編集の背景が出る。取り込みの状態文は残り、3D の読み込みの文言で上書きしない。
  const wall = glb(venueFixture());
  await importProject(page, wall); await background.waitFor({ state: 'attached' });
  await onMapping(); assert.equal(await page.locator('#practice-retry').isHidden(), true);
  assert.match(await status.textContent(), /Project loaded/); assert.equal(await failed(), false);
  assert.equal(await background.evaluate(img => img.complete && img.naturalWidth > 0), true, 'the projector view of the venue is drawn');
  // 作れる会場から作れない会場を取り込んで失敗し、取り込み前に戻すと、背景と 3D が戻る。3D のタブを表示していても同じ。
  for (const tab of ['mapping', 'preview']) {
    if (tab === 'preview') { await page.locator('#preview-tab').click(); await page.waitForSelector('#dc-practice-canvas'); }
    await importProject(page, glb(venueFixture(d => { d.scenes[0].nodes = []; }), wall));
    await page.waitForSelector('#practice-retry:not([hidden])');
    assert.match(await status.textContent(), committed); assert.equal(await background.count(), 0);
    await inProjectPanel(page, () => page.locator('#practice-undo-import').click());
    await background.waitFor({ state: 'attached' });
    assert.equal(await page.locator('#practice-retry').isHidden(), true, `${tab}: undo leaves no stale retry`);
    assert.equal(await failed(), false); assert.deepEqual((await exportProject(page)).assets, wall.assets);
    await onMapping();
  }
  await page.locator('#preview-tab').click(); await page.waitForSelector('#dc-practice-canvas');
  await page.waitForFunction(() => document.querySelector('#practice-dimensions')?.textContent === 'Venue size: 6.00 × 4.00 × 0.00 m');
  await page.locator('#mapping-tab').click();
  await page.locator('#practice-save').click(); await page.waitForTimeout(300);
  // 編集を閉じて開き直すと背景は無い (3D を読み込まない)。保存済みを開くと、3D のタブを開かずに背景が出る。
  await closeEditor(page); await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await projectControls(page);
  assert.equal(await background.count(), 0, 'reopening the editor does not load 3D');
  await page.locator('#practice-saved-projects').selectOption({ label: 'Background' }); await page.locator('#practice-open-project').click();
  await background.waitFor({ state: 'attached' }); await onMapping();
  assert.deepEqual((await exportProject(page)).assets, wall.assets);
  // 出力レイアウトのタブにいるときに作れない会場を取り込んでも、失敗を知らせるだけでタブは動かさない。
  await page.locator('#layout-tab').click();
  await importProject(page, empty); await page.waitForSelector('#practice-retry:not([hidden])');
  assert.equal(await page.locator('#layout-tab').getAttribute('aria-selected'), 'true');
  await closeEditor(page);
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
  await projectControls(page); await page.locator('#practice-open-content').click(); await page.waitForURL('**/project');
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 1920);
  assert.equal(page.context().pages().length, 1);
  await snapshot(page, base.name + '-sample');
}

/** 編集の Undo / Redo (#161): 1 操作 = 1 件、選択だけでは積まない、入力欄の Cmd+Z は奪わない、保存と一致する。 */
async function history(page, base) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  const undoBtn = page.locator('#dc-undo-btn'), redoBtn = page.locator('#dc-redo-btn');
  // 全幅の履歴バーは無く、3 カラムは画面上端から始まる。Undo / Redo はツールカラムの見出しにある (#215)。
  assert.equal(await page.locator('.dc-edit-toolbar').count(), 0, 'no full-width history bar');
  assert.equal((await page.locator('.control-container').boundingBox()).y, (await page.locator('#dc-inline-editor').boundingBox()).y, 'columns start at the top of the editor');
  assert.equal(await page.locator('.tool-column > .column-header .dc-history #dc-undo-btn').count(), 1, 'history lives in the tool heading');
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
  if (artifactDir) await page.locator('.tool-column > .column-header').screenshot({ path: resolve(artifactDir, base.name + '-history-disabled.png') });
  await showPanel(page, 'outputs');
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
  await showPanel(page, 'mappings'); await page.locator('#add-mapping-btn').click();
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
  await showPanel(page, 'outputs'); await undoRestores('output x', () => change(page, '#output-x-input', 40)); await showPanel(page, 'mappings');

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
/** ソース列・マッピング列の拡大・パン (#193)。表示だけで、state・履歴は変わらず、拡大中も編集の換算が合う。 */
async function zoomPan(page, base) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await page.locator('#add-mapping-btn').click();
  const history = () => Promise.all(['#dc-undo-btn', '#dc-redo-btn'].map(s => page.locator(s).isDisabled()));
  const box = selector => page.locator(selector).boundingBox();
  const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);
  const mapControls = '#output-stage .dc-zoom-controls', srcControls = '.source-column .dc-zoom-controls';
  for (const controls of [mapControls, srcControls]) {
    assert.equal(await page.locator(`${controls} .dc-zoom-level`).textContent(), '100%', `${controls} starts at fit`);
    assert.equal(await page.locator(`${controls} .dc-zoom-btn`).nth(2).isDisabled(), true, 'fit is disabled at fit');
    // 押せないボタンは汎用の button:disabled の塗りを付けず、アイコンを淡くする (ホバー中も)
    const fit = page.locator(`${controls} .dc-zoom-btn`).nth(2);
    await fit.hover();
    assert.equal(await fit.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'a disabled zoom button has no fill');
  }
  // 右下に置く
  const stage = await box('#output-stage'), controls = await box(mapControls);
  near(stage.x + stage.width - (controls.x + controls.width), 10, 1, 'controls sit at the right edge');
  near(stage.y + stage.height - (controls.y + controls.height), 10, 1, 'controls sit at the bottom edge');

  // ── マッピング列: ホイールはカーソル下の点を固定して拡大し、state も履歴も変えない
  const before = await state(page), beforeHistory = await history();
  const fitHost = await box('#output-stage .dc-canvas-host');
  const handle = page.locator('#output-stage .quad-handle:not(.quad-handle-scale):not(.quad-handle-rotate)').first();
  const fitHandle = await handle.boundingBox();
  const cursor = { x: fitHost.x + fitHost.width * 0.3, y: fitHost.y + fitHost.height * 0.6 };
  const fraction = h => ({ x: (cursor.x - h.x) / h.width, y: (cursor.y - h.y) / h.height });
  const fitFraction = fraction(fitHost);
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => document.querySelector('#output-stage .dc-zoom-level').textContent !== '100%');
  await page.waitForTimeout(100);
  const zoomedHost = await box('#output-stage .dc-canvas-host');
  assert.ok(zoomedHost.width > fitHost.width * 1.5, 'wheel up zooms the mapping view in');
  near(fraction(zoomedHost).x, fitFraction.x, 0.002, 'the point under the cursor stays (x)');
  near(fraction(zoomedHost).y, fitFraction.y, 0.002, 'the point under the cursor stays (y)');
  near((await handle.boundingBox()).width, fitHandle.width, 0.5, 'handles keep their screen size');
  assert.deepEqual(await state(page), before, 'zooming never edits the state');
  assert.deepEqual(await history(), beforeHistory, 'zooming adds no history');
  await snapshot(page, `${base.name}-zoom-mapping`);

  // 拡大中の四隅のドラッグは画面上の移動量を仮想キャンバス px に換算する
  const corner = await handle.boundingBox(), canvasPerPx = before.canvas.width / zoomedHost.width;
  const start = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(start.x + i * 10, start.y);
  await page.mouse.up();
  const active = s => s.mappings.find(m => m.id === s.activeId);
  const dragged = await state(page);
  near(active(dragged).quad.topLeft.x - active(before).quad.topLeft.x, 40 * canvasPerPx, canvasPerPx, 'a zoomed corner drag converts screen px to canvas px');
  // 矢印キーの微調整は出力の 1px 単位で、編集ビューの拡大率に依らない (出力窓が閉じていれば仮想キャンバス 1px)
  await page.keyboard.press('ArrowRight');
  near(active(await state(page)).quad.topLeft.x - active(dragged).quad.topLeft.x, 1, 1e-6, 'a zoomed arrow nudge moves one output px');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await state(page), dragged);

  // Space + ドラッグはハンドルの上から始めてもパンになり、state を変えない
  const dragHandle = await handle.boundingBox(), hostBeforePan = await box('#output-stage .dc-canvas-host');
  await page.mouse.move(dragHandle.x + dragHandle.width / 2, dragHandle.y + dragHandle.height / 2);
  await page.keyboard.down('Space');
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(dragHandle.x + dragHandle.width / 2 - i * 10, dragHandle.y + dragHandle.height / 2 + i * 6);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(100);
  const hostAfterPan = await box('#output-stage .dc-canvas-host');
  near(hostAfterPan.x - hostBeforePan.x, -50, 1, 'space-drag pans x');
  near(hostAfterPan.y - hostBeforePan.y, 30, 1, 'space-drag pans y');
  assert.deepEqual(await state(page), dragged, 'space-drag over a handle never moves the corner');
  // 中ボタンのドラッグもパン
  await page.mouse.move(cursor.x, cursor.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cursor.x + 30, cursor.y + 20, { steps: 3 }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(100);
  const hostAfterMiddle = await box('#output-stage .dc-canvas-host');
  near(hostAfterMiddle.x - hostAfterPan.x, 30, 1, 'middle-drag pans x');
  assert.deepEqual(await state(page), dragged, 'middle-drag never edits');
  // 右下のボタン: 縮小・拡大・全体に合わせる
  const level = async () => page.locator('#output-stage .dc-zoom-level').textContent();
  const zoomedLevel = await level();
  await page.locator(`${mapControls} .dc-zoom-btn`).nth(1).click();
  assert.ok(parseInt(await level()) > parseInt(zoomedLevel), 'the + button zooms in');
  await page.locator(`${mapControls} .dc-zoom-btn`).nth(0).click();
  await page.locator(`${mapControls} .dc-zoom-btn`).nth(2).click();
  await page.waitForTimeout(100);
  assert.equal(await level(), '100%', 'fit returns to 100%');
  const backHost = await box('#output-stage .dc-canvas-host');
  for (const k of ['x', 'y', 'width', 'height']) near(backHost[k], fitHost[k], 0.5, `fit restores the canvas ${k}`);

  // ── ソース列: 拡大中も crop 枠のドラッグは画面上の移動量どおりに % を動かす
  await page.locator('#reset-source-btn').click();
  const fitFrame = await box('.source-column .canvas-frame');
  const sourceHandle = page.locator('.source-column .handle-se');
  const fitSourceHandle = await sourceHandle.boundingBox();
  // 全選択の右下の角あたりを拡大する
  await page.mouse.move(fitFrame.x + fitFrame.width * 0.9, fitFrame.y + fitFrame.height * 0.9);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  const zoomedFrame = await box('.source-column .canvas-frame');
  assert.ok(zoomedFrame.width > fitFrame.width * 1.5, 'wheel up zooms the source view in');
  near((await sourceHandle.boundingBox()).width, fitSourceHandle.width, 0.5, 'source handles keep their screen size');
  const srcBefore = active(await state(page)).source;
  const se = await sourceHandle.boundingBox(), video = await box('#source-video');
  const sp = { x: se.x + se.width / 2, y: se.y + se.height / 2 };
  await page.mouse.move(sp.x, sp.y); await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(sp.x - i * 10, sp.y - i * 5);
  await page.mouse.up();
  const srcAfter = active(await state(page)).source;
  near(srcBefore.width - srcAfter.width, (40 / video.width) * 100, 0.2, 'a zoomed crop drag converts screen px to %');
  near(srcBefore.height - srcAfter.height, (20 / video.height) * 100, 0.2, 'a zoomed crop drag converts screen px to % (y)');
  // ソースの矢印キー微調整もソースの 1px 単位 (640px の映像で 1/6.4 %)
  const selBox = await box('#selection-box');
  await page.mouse.click(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
  const srcBeforeNudge = active(await state(page)).source;
  await page.keyboard.press('ArrowRight');
  near(active(await state(page)).source.x - srcBeforeNudge.x, 100 / 640, 1e-6, 'a zoomed source nudge moves one source px');
  await snapshot(page, `${base.name}-zoom-source`);
  await page.locator(`${srcControls} .dc-zoom-btn`).nth(2).click();
  await page.waitForTimeout(100);
  const backFrame = await box('.source-column .canvas-frame');
  for (const k of ['x', 'y', 'width', 'height']) near(backFrame[k], fitFrame[k], 0.5, `fit restores the source frame ${k}`);

  // ── マスクのペン描画中に Space + ドラッグしても頂点は増えない
  await page.locator('#add-mask-btn').click();
  const pen = () => state(page).then(s => active(s).points.length);
  const penBefore = await pen();
  const host = await box('#output-stage .dc-canvas-host');
  await page.mouse.move(host.x + host.width * 0.4, host.y + host.height * 0.4);
  await page.keyboard.down('Space');
  await page.mouse.down(); await page.mouse.move(host.x + host.width * 0.45, host.y + host.height * 0.45, { steps: 3 }); await page.mouse.up();
  await page.keyboard.up('Space');
  assert.equal(await pen(), penBefore, 'space-drag never adds a pen point');
  // Space を離せば、通常のクリックで頂点を足せる
  await page.mouse.click(host.x + host.width * 0.4, host.y + host.height * 0.4);
  assert.equal(await pen(), penBefore + 1, 'a plain click still adds a pen point');
  for (const [fx, fy] of [[0.6, 0.4], [0.5, 0.6]]) await page.mouse.click(host.x + host.width * fx, host.y + host.height * fy);
  await page.keyboard.press('Enter');
  // ── 拡大中のマスク頂点のドラッグも画面上の移動量を仮想キャンバス px に換算する
  const vertex = page.locator('#output-stage .mask-vertex-handle').first();
  const v0 = await vertex.boundingBox();
  await page.mouse.move(v0.x + v0.width / 2, v0.y + v0.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  const maskHost = await box('#output-stage .dc-canvas-host');
  assert.ok(maskHost.width > host.width * 1.5, 'zoomed in over the mask');
  const maskPerPx = before.canvas.width / maskHost.width;
  const v1 = await vertex.boundingBox(), pointBefore = active(await state(page)).points[0];
  const vp = { x: v1.x + v1.width / 2, y: v1.y + v1.height / 2 };
  await page.mouse.move(vp.x, vp.y); await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(vp.x + i * 10, vp.y + i * 5);
  await page.mouse.up();
  const pointAfter = active(await state(page)).points[0];
  near(pointAfter.x - pointBefore.x, 40 * maskPerPx, maskPerPx, 'a zoomed mask vertex drag converts screen px to canvas px (x)');
  near(pointAfter.y - pointBefore.y, 20 * maskPerPx, maskPerPx, 'a zoomed mask vertex drag converts screen px to canvas px (y)');
}

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
/** マスクの描画中、入力欄で押したキーはその欄だけに効き、描画中のマスクを変えない (#206)。 */
async function maskDraftKeys(page) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  const host = await page.locator('#output-stage .dc-canvas-host').boundingBox();
  const at = (fx, fy) => page.mouse.click(host.x + host.width * fx, host.y + host.height * fy);
  const masks = async () => (await state(page)).mappings.filter(m => m.kind === 'mask');
  const focusedTag = () => page.evaluate(() => document.activeElement?.tagName);
  await page.locator('#add-mask-btn').click();
  for (const [fx, fy] of [[.3, .3], [.6, .3], [.45, .6]]) await at(fx, fy);
  const [drawn] = await masks();
  assert.equal(drawn.drafting, true); assert.equal(drawn.points.length, 3);
  /** 描画中のまま、頂点が描いたときと同じである。 */
  const draftKept = async label => {
    const now = await masks();
    assert.deepEqual(now.map(m => ({ id: m.id, drafting: m.drafting, points: m.points })), [{ id: drawn.id, drafting: true, points: drawn.points }], label);
  };

  // 出力設定の数値欄: Backspace / Delete は欄の文字を消し、Escape は欄の取消、Enter は欄の確定
  await showPanel(page, 'outputs');
  const x = page.locator('#output-x-input');
  const outputX = async () => (await state(page)).outputs[0].position.x;
  const committedX = await outputX(), shownX = await x.inputValue();
  await x.fill('123'); await x.press('Backspace');
  assert.equal(await x.inputValue(), '12', 'Backspace in the output field deletes its last digit');
  await draftKept('Backspace in the output field keeps the mask being drawn');
  await x.press('Home'); await x.press('Delete');
  assert.equal(await x.inputValue(), '2', 'Delete in the output field deletes its first digit');
  await draftKept('Delete in the output field keeps the mask being drawn');
  await x.press('Escape');
  assert.equal(await x.inputValue(), shownX, 'Escape in the output field restores the committed value');
  assert.equal(await outputX(), committedX, 'Escape in the output field commits nothing');
  await draftKept('Escape in the output field keeps the mask being drawn');
  await x.fill('40'); await x.press('Enter');
  assert.equal(await outputX(), 40, 'Enter in the output field commits the value');
  await draftKept('Enter in the output field keeps the mask being drawn');

  // マッピング名の rename 欄: 同じく欄だけに効く
  await showPanel(page, 'mappings');
  const name = page.locator(`.mapping-list-item[data-id="${drawn.id}"] .name`);
  const input = page.locator('.mapping-list-item .name-input');
  const original = await name.innerText();
  assert.ok(original.length >= 3, 'the mask has a name long enough to edit');
  await name.dblclick();
  await input.press('End'); await input.press('Backspace');
  assert.equal(await input.inputValue(), original.slice(0, -1), 'Backspace in the rename field deletes its last character');
  await draftKept('Backspace in the rename field keeps the mask being drawn');
  await input.press('Home'); await input.press('Delete');
  assert.equal(await input.inputValue(), original.slice(1, -1), 'Delete in the rename field deletes its first character');
  await draftKept('Delete in the rename field keeps the mask being drawn');
  await input.press('Escape');
  assert.equal(await input.count(), 0, 'Escape closes the rename field');
  assert.equal(await name.innerText(), original, 'Escape in the rename field keeps the name');
  await draftKept('Escape in the rename field keeps the mask being drawn');
  await name.dblclick(); await input.fill('pen'); await input.press('Enter');
  assert.equal(await input.count(), 0, 'Enter closes the rename field');
  assert.equal((await masks())[0].name, 'pen', 'Enter in the rename field commits the name');
  await draftKept('Enter in the rename field keeps the mask being drawn');

  // 入力欄の外 (プレビュー上) では従来どおり: Backspace / Delete で頂点を 1 つ消し、Enter で確定、Escape で破棄
  const points = async () => (await masks())[0].points;
  await at(.6, .6);
  assert.equal((await points()).length, 4);
  assert.notEqual(await focusedTag(), 'INPUT');
  await page.keyboard.press('Backspace');
  assert.deepEqual(await points(), drawn.points, 'Backspace on the preview removes the last vertex');
  await page.keyboard.press('Delete');
  assert.deepEqual(await points(), drawn.points.slice(0, 2), 'Delete on the preview removes the last vertex');
  await page.keyboard.press('Enter');
  assert.equal((await masks())[0].drafting, true, 'Enter with two vertices keeps drawing');
  await at(.45, .6); await page.keyboard.press('Enter');
  const [closed] = await masks();
  assert.ok(!closed.drafting, 'Enter on the preview closes the mask'); assert.equal(closed.points.length, 3);
  await page.locator('#add-mask-btn').click();
  await at(.2, .7); await at(.3, .8);
  assert.equal((await masks()).length, 2);
  await page.keyboard.press('Escape');
  assert.deepEqual((await masks()).map(m => m.id), [drawn.id], 'Escape on the preview discards the mask being drawn');
}
/** 隅を選んだまま <select> で押した矢印キーは、その欄のもので、選んだ隅を動かさない (#206 と同じ約束)。 */
async function nudgeSelectKeys(page) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  await page.locator('#output-stage [data-corner]').first().click();
  assert.equal(await page.locator('#output-stage .quad-handle.kbd-selected').count(), 1, 'a corner is selected for the arrow keys');
  await showPanel(page, 'preview3d');
  const quality = page.locator('#practice-quality'); await quality.waitFor();
  assert.equal(await page.locator('#output-stage .quad-handle.kbd-selected').count(), 1, 'the corner stays selected in the 3D panel');
  // window は document の後に呼ばれるので、document のキー処理が既定の動作を止めたかをここで見られる。
  await page.evaluate(() => addEventListener('keydown', event => { window.lastKeyPrevented = event.defaultPrevented; }));
  const before = await state(page);
  await quality.focus();
  assert.equal(await quality.inputValue(), '640');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual((await state(page)).mappings, before.mappings, 'ArrowDown in a select keeps the selected corner in place');
  assert.equal(await page.evaluate(() => window.lastKeyPrevented), false, 'ArrowDown in a select is left to the browser');
  // macOS の Chromium は閉じた select の矢印キーで一覧を開く (値は変えない) ので、値はそれ以外で確かめる。
  if (process.platform === 'darwin') await page.keyboard.press('Escape');
  else assert.equal(await quality.inputValue(), '960', 'ArrowDown in a select picks its next option');
  // 欄の外では従来どおり、矢印キーが選んだ隅を動かす
  await quality.evaluate(element => element.blur());
  await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await state(page)).mappings, before.mappings, 'ArrowRight outside a field nudges the selected corner');
  // 逆の順。欄にフォーカスがあるまま隅を押すと (ハンドルは既定のフォーカス移動を止める)、矢印キーは押した隅に届く。
  const corner = page.locator('#output-stage [data-corner]').first();
  const picked = await quality.inputValue();
  await quality.focus(); await corner.click();
  let moved = await state(page);
  await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await state(page)).mappings, moved.mappings, 'pressing a corner while a select has focus hands the arrow keys to the corner');
  assert.equal(await quality.inputValue(), picked, 'the select keeps its value once a corner is picked');
  await showPanel(page, 'outputs');
  const x = page.locator('#output-x-input'); const xValue = await x.inputValue();
  await x.focus(); await corner.click();
  moved = await state(page);
  await page.keyboard.press('ArrowUp');
  assert.notDeepEqual((await state(page)).mappings, moved.mappings, 'pressing a corner while a number field has focus hands the arrow keys to the corner');
  assert.equal(await x.inputValue(), xValue, 'the number field keeps its value once a corner is picked');
  assert.equal((await state(page)).outputs[0].position.x, moved.outputs[0].position.x, 'the output does not move');
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
/** 家アイコンは確認を経てホームへ移り、出力ウィンドウを閉じる。取り消せば編集に留まる (#225)。 */
async function confirmHome(page, base) {
  await page.locator(entryButton).click(); await page.waitForSelector('#practice-home');
  const dialog = page.locator('#practice-home-confirm');
  const openDialog = async () => {
    await page.locator('#practice-home').click();
    assert.equal(await dialog.evaluate(d => d.open && d.matches(':modal')), true, 'home opens a modal confirmation');
    assert.equal(new URL(page.url()).pathname, '/a', 'one click on home never leaves the sketch');
  };
  await openDialog();
  assert.equal(await page.locator('#practice-home-cancel').evaluate(e => e === document.activeElement), true, 'cancel has the initial focus');
  await page.locator('#practice-home-cancel').click();
  assert.equal(await dialog.evaluate(d => d.open), false);
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true, 'cancel keeps the editor open');
  await openDialog(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#dc-inline-editor').isVisible(), true, 'Esc keeps the editor open');
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('ja'), base.modules);
  assert.equal(await page.locator('#practice-home').getAttribute('aria-label'), 'ホームに戻る');
  await showPanel(page, 'outputs');
  const popupPromise = page.waitForEvent('popup'); await page.locator('#outputs-list .open-btn').first().click(); const popup = await popupPromise;
  await openDialog();
  assert.equal(await page.locator('#practice-home-confirm-title').innerText(), 'ホームに戻りますか？');
  // 確定は遷移のため <a> だが、× の確認と同じ赤いボタンに見える (下線付きのリンクにしない)。
  assert.deepEqual(await page.locator('#practice-home-confirm-btn').evaluate(e => { const c = getComputedStyle(e); return [c.backgroundColor, c.textDecorationLine]; }), ['rgb(185, 28, 28)', 'none']);
  await snapshot(page, base.name + '-home-confirm-ja');
  await page.locator('#practice-home-confirm-btn').click();
  await page.waitForURL(url => url.pathname === '/');
  assert.equal(await page.locator('#dc-inline-editor').count(), 0, 'the editor is gone at home');
  await popup.waitForEvent('close', { timeout: 5000 }).catch(() => {});
  assert.equal(popup.isClosed(), true, 'going home closes the output windows');
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

/** 左端のアクティビティバー (#215): パネル切替・選択中の再押下で折り畳み・畳んだままの Undo・キーボード・狭い画面。 */
async function activityBar(page, base) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth === 640);
  const requests = observedRequests.get(page);
  const loadedPanel = () => requests.some(url => /PracticePanel/.test(url));
  const tabs = page.locator('.dc-activity-tabs');
  assert.equal(await tabs.getAttribute('role'), 'tablist'); assert.equal(await tabs.getAttribute('aria-orientation'), 'vertical');
  assert.deepEqual(await tabs.locator('.dc-activity-btn').evaluateAll(bs => bs.map(b => b.dataset.toolPanel)), ['mappings', 'outputs', 'check', 'preview3d', 'project']);
  const bar = await page.locator('.dc-activity-bar').boundingBox(), tool = await page.locator('.tool-column').boundingBox();
  assert.ok(bar.x <= 1 && bar.width <= 48 && Math.abs(bar.x + bar.width - tool.x) <= 1, 'the activity bar sits at the left edge, right before the tool column');
  assert.ok((await page.locator('.dc-activity-bar-footer #practice-stop').boundingBox()).y > (await tabs.boundingBox()).y + (await tabs.boundingBox()).height, 'close is below the panel buttons');
  const title = page.locator('#dc-tool-panel-title');
  const visible = async selector => page.locator(selector).isVisible();
  // 既定は「マッピング」。マッピング一覧と選択中の詳細 (ソース設定・マッピング設定) が同じパネルにある (#228)。
  const mappingControls = ['#add-mapping-btn', '#add-mask-btn', '#mappings-list', '#reset-source-btn', '#reset-mapping-btn'];
  const outputControls = ['#add-output-btn', '#outputs-list', '#output-x-input'];
  const otherControls = ['[data-pattern="grid"]', '#dev-mode-toggle', '#export-settings-btn'];
  assert.equal(await activePanel(page), 'mappings');
  assert.equal(await page.locator('#dc-activity-mappings').getAttribute('aria-expanded'), 'true');
  assert.equal(await title.innerText(), 'Mappings');
  for (const selector of mappingControls) assert.equal(await visible(selector), true, `${selector} is in mappings`);
  for (const selector of [...outputControls, ...otherControls]) assert.equal(await visible(selector), false, `${selector} is in another panel`);
  await page.locator('#add-mapping-btn').click(); const mappings = (await state(page)).mappings.length;
  // 出力: 出力ウィンドウ一覧と選択中の出力の位置・サイズ (出力設定)。
  await page.locator('#dc-activity-outputs').click();
  assert.equal(await title.innerText(), 'Outputs');
  for (const selector of outputControls) assert.equal(await visible(selector), true, `${selector} is in outputs`);
  for (const selector of [...mappingControls, ...otherControls]) assert.equal(await visible(selector), false, `${selector} is not in outputs`);
  await snapshot(page, base.name + '-activity-outputs');
  // 確認: テストパターンと開発モード。ここまでは 3D を読み込まない。
  await page.locator('#dc-activity-check').click();
  assert.equal(await title.innerText(), 'Check');
  assert.equal(await visible('[data-pattern="grid"]'), true); assert.equal(await visible('#dev-mode-toggle'), true);
  assert.equal(await visible('#add-output-btn'), false);
  assert.equal(await page.locator('.dc-tool-panel.is-active').count(), 1);
  assert.equal(loadedPanel(), false, 'mappings, outputs and check panels never load 3D');
  // 下端はホームへ戻る (家) と閉じる (×) だけ。会場の作成・調整は使う頻度が低いのでここには置かない (#225)。
  const homeLink = page.locator('.dc-activity-bar-footer #practice-home');
  assert.match(await homeLink.getAttribute('href'), /^\/$/); assert.equal(await homeLink.getAttribute('target'), null);
  assert.equal(await homeLink.getAttribute('aria-label'), 'Back to home');
  assert.deepEqual(await page.locator('.dc-activity-bar-footer a, .dc-activity-bar-footer button').evaluateAll(es => es.filter(e => e.checkVisibility()).map(e => e.id)), ['practice-home', 'practice-stop']);
  assert.equal(await page.locator('#practice-venue').count(), 1, 'the venue entry exists, inside the project panel');
  assert.equal(await page.locator('.dc-activity-bar #practice-venue').count(), 0, 'the venue entry is not on the activity bar');
  // プロジェクト: 開いても 3D (PracticePanel) は読み込まない (#169)。保存・読込が「設定の入出力」より先に並ぶ。
  await page.locator('#dc-activity-project').click();
  assert.equal(await title.innerText(), 'Project');
  await page.locator('#practice-project-name').waitFor();
  assert.equal(loadedPanel(), false, 'opening the project panel does not load 3D');
  // 保存・読込 → 設定の入出力 → 会場の作成・調整 (末尾、別タブ) の順 (#225)。
  assert.deepEqual(await page.locator('#dc-tool-panel-project > *').evaluateAll(es => es.map(e => e.querySelector('#dc-practice-project') ? 'project' : e.querySelector('#export-settings-btn') ? 'io' : e.querySelector('#practice-venue') ? 'venue' : '?')), ['project', 'io', 'venue']);
  const venueLink = page.locator('#dc-tool-panel-project #practice-venue');
  assert.equal(await venueLink.isVisible(), true);
  assert.equal(await venueLink.getAttribute('target'), '_blank'); assert.match(await venueLink.getAttribute('href'), /\/venue$/);
  assert.equal(await venueLink.innerText(), 'Venue setup ↗');
  // 3D: プレビューの設定と会場校正へのリンク。
  await page.locator('#dc-activity-preview3d').click();
  assert.equal(await title.innerText(), '3D');
  await page.locator('#practice-output').waitFor();
  assert.equal(loadedPanel(), true, 'opening the 3D panel loads the practice panel');
  assert.equal(await visible('#dc-tool-panel-preview3d a[href$="/venue"]'), true);
  assert.equal(await visible('#practice-project-name'), false);
  await snapshot(page, base.name + '-activity-3d');
  // 列幅を変えてから畳み、開き直すと同じ幅に戻る。
  await showPanel(page, 'mappings');
  const resizer = await page.locator('.dc-column-resizer[data-resize-edge="tool"]').boundingBox();
  await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + 200); await page.mouse.down();
  await page.mouse.move(resizer.x + resizer.width / 2 + 40, resizer.y + 200, { steps: 4 }); await page.mouse.up();
  const width = (await page.locator('.tool-column').boundingBox()).width;
  const stageWidth = (await page.locator('#output-stage').boundingBox()).width;
  await page.locator('#dc-activity-mappings').click();
  assert.equal(await page.locator('.tool-column').isVisible(), false, 'pressing the selected button collapses the tool column');
  assert.equal(await page.locator('.dc-column-resizer[data-resize-edge="tool"]').isVisible(), false);
  assert.equal(await page.locator('#dc-activity-mappings').getAttribute('aria-expanded'), 'false');
  assert.equal(await activePanel(page), 'mappings', 'collapsing keeps the selection');
  await page.waitForFunction(w => document.querySelector('#output-stage').getBoundingClientRect().width > w + 100, stageWidth);
  const sourceX = (await page.locator('.source-column').boundingBox()).x;
  assert.ok(Math.abs(sourceX - (bar.x + bar.width)) <= 8, 'the source column follows the activity bar');
  await snapshot(page, base.name + '-activity-collapsed');
  // 畳んだ間もキー操作で Undo / Redo できる。
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal((await state(page)).mappings.length, mappings - 1, 'undo works while the tool column is collapsed');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  assert.equal((await state(page)).mappings.length, mappings, 'redo works while the tool column is collapsed');
  // 別のパネルを押すと、そのパネルで開く。幅は畳む前のまま。
  await page.locator('#dc-activity-check').click();
  assert.equal(await page.locator('.tool-column').isVisible(), true);
  assert.equal(await activePanel(page), 'check'); assert.equal(await title.innerText(), 'Check');
  assert.equal((await page.locator('.tool-column').boundingBox()).width, width, 'reopening restores the resized width');
  // キーボード: 上下・Home・End で移動して選ぶ。Enter で選択中を畳み、もう一度で開く。
  await page.locator('#dc-activity-check').focus();
  const focused = () => page.evaluate(() => document.activeElement?.dataset.toolPanel);
  await page.keyboard.press('ArrowDown'); assert.equal(await activePanel(page), 'preview3d'); assert.equal(await focused(), 'preview3d');
  await page.keyboard.press('End'); assert.equal(await activePanel(page), 'project');
  await page.keyboard.press('ArrowDown'); assert.equal(await activePanel(page), 'mappings', 'ArrowDown wraps');
  await page.keyboard.press('ArrowUp'); assert.equal(await activePanel(page), 'project', 'ArrowUp wraps');
  await page.keyboard.press('Home'); assert.equal(await activePanel(page), 'mappings');
  await page.keyboard.press('ArrowDown'); assert.equal(await activePanel(page), 'outputs');
  await page.keyboard.press('ArrowUp'); assert.equal(await activePanel(page), 'mappings');
  const before = await state(page);
  await page.keyboard.press('Enter'); assert.equal(await page.locator('.tool-column').isVisible(), false, 'Enter collapses');
  await page.keyboard.press('Space'); assert.equal(await page.locator('.tool-column').isVisible(), true, 'Space reopens');
  assert.deepEqual(await state(page), before, 'activity bar keys never nudge mappings');
  // 言語切替で見出しとボタン名が追従する。
  await page.evaluate(async modules => (await import(`${modules}/i18n/index.ts`)).setLang('ja'), base.modules);
  assert.equal(await title.innerText(), 'マッピング');
  assert.equal(await page.locator('#dc-activity-outputs').getAttribute('aria-label'), '出力');
  assert.equal(await page.locator('#dc-activity-check').getAttribute('aria-label'), '確認');
  assert.equal(await page.locator('#dc-activity-project').getAttribute('title'), 'プロジェクト');
  await snapshot(page, base.name + '-activity-ja');
  // 狭い画面でも、開いた状態・畳んだ状態ともに横にはみ出さない。
  await page.setViewportSize({ width: 900, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok((await page.locator('.dc-activity-bar').boundingBox()).x <= 1);
  assert.equal(await page.locator('.tool-column').isVisible(), true);
  await snapshot(page, base.name + '-activity-narrow-ja');
  await page.locator('#dc-activity-mappings').click();
  assert.equal(await page.locator('.tool-column').isVisible(), false);
  const narrowBar = await page.locator('.dc-activity-bar').boundingBox();
  assert.ok(Math.abs((await page.locator('.source-column').boundingBox()).x - (narrowBar.x + narrowBar.width)) <= 2, 'collapsed narrow layout gives the space to the source');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await snapshot(page, base.name + '-activity-narrow-collapsed-ja');
  await page.locator('#dc-activity-mappings').click();
  await closeEditor(page);
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
      for (const [testName, run] of Object.entries({ workspace, workspaceSlideshow: workspace, lifecycle, projects, slideshow, slideshowShortcuts, recovery, outputs, outputUndo, unavailable, projectWithoutWebgl, projectImport3d, cancellation, loading, confirmClose, confirmHome, history, maskSelect, maskDraftKeys, nudgeSelectKeys, zoomPan, activityBar, sample, slideshowDraft, fullscreenMapping })) {
        if (process.env.PRACTICE_CASE && process.env.PRACTICE_CASE !== testName) continue;
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', locale: 'en-US' });
        const errors = []; context.on('page', page => page.on('pageerror', e => errors.push(e.message))); observeConsole(context);
        try {
          const page = await setup(context, base, testName.toLowerCase().includes('slideshow') ? '/slideshow' : testName === 'recovery' ? '/w' : '/a', !testName.startsWith('workspace') && !['projectWithoutWebgl', 'projectImport3d'].includes(testName));
          await run(page, base); assert.deepEqual(errors, [], `${name}/${testName}: browser errors`);
          console.log(`${name}/${testName}: PASS`);
        } finally { await context.close(); }
      }
    } finally { await server.close(); }
  }
} finally { await browser.close(); }
