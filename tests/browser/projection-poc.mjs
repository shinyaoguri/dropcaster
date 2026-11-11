import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fixture, presetNames } from '../../poc/projection-3d/fixtures.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifactDir = process.env.POC_ARTIFACT_DIR;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const server = await createServer({ configFile: resolve(root, 'poc/projection-3d/vite.config.ts'), server: { port: 0, strictPort: false, watch: null, hmr: false }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
const report = { comparisons: [], browser: browser.version(), platform: `${process.platform}/${process.arch}` };

// Compare the entire image plus flat interiors. CSS/GPU coverage at polygon/text
// edges differs; exclude a 2px neighborhood of CSS edges only for the interior
// metric. Full-image MAE still catches misplaced edges and missing shapes.
function compare(css, gpu, width, height) {
  let total = 0, bad = 0, interior = 0, maxInterior = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y*width+x)*4;
    const delta = [0,1,2].map(c => Math.abs(css[i+c]-gpu[i+c]));
    total += delta.reduce((a,b)=>a+b,0);
    let edge = x < 2 || y < 2 || x >= width-2 || y >= height-2;
    for (let dy = -2; !edge && dy <= 2; dy++) for (let dx = -2; !edge && dx <= 2; dx++) {
      const j = ((y+dy)*width+x+dx)*4;
      if ([0,1,2].some(c => Math.abs(css[i+c]-css[j+c]) > 18)) edge = true;
    }
    if (!edge) {
      interior++; maxInterior = Math.max(maxInterior, ...delta);
      if (Math.max(...delta) > 12) bad++;
    }
  }
  return { mae: total/(width*height*3), interior, interiorBadFraction: bad/Math.max(interior,1), maxInterior };
}

try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ja-JP' });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /THREE|shader|WebGLProgram/i.test(m.text())) errors.push(m.text()); });
  page.on('request', r => requests.push(r.url()));
  await page.goto(url);
  await page.waitForFunction(() => !!window.projectionPoc);
  assert.ok(!requests.some(r => /\/ProjectionPreview|\/three(?:\.js|\/|_)/.test(r)), 'Three must load only on Start');
  await page.click('#start');
  await page.waitForFunction(() => window.projectionPoc.preview?.depthRenders > 0);
  const waitFrames = () => page.evaluate(() => new Promise((resolve, reject) => {
    let count = 0;
    const video = window.projectionPoc.video;
    const timeout = setTimeout(() => reject(new Error('No source video frames within 10s')),10000);
    const frame = () => { if (++count === 4) { clearTimeout(timeout); resolve(); } else video.requestVideoFrameCallback(frame); };
    video.requestVideoFrameCallback(frame);
  }));
  await waitFrames();
  assert.ok(await page.evaluate(() => Array.from(document.getElementById('gpu').getContext('2d').getImageData(0,0,640,360).data).some((v,i) => i%4!==3 && v>0)), 'initial GPU snapshot contains a decoded frame');
  const comparisonStyle = await page.addStyleTag({ content: '#css-wrap { position:fixed; left:0; top:0; width:320px; height:180px; z-index:1000; } #handles { display:none; }' });
  await page.selectOption('#resolution', '320');

  const cases = presetNames.map(name => ({ name, state: fixture(name), pattern: 'grid' }));
  cases.push({ name: 'alpha', state: fixture('full'), pattern: 'alpha' });
  cases.push({ name: 'alpha-mask-behind', state: fixture('mask-behind'), pattern: 'alpha' });
  cases.push({ name: 'black', state: fixture('full'), pattern: 'black' });
  const zero = fixture('full'); zero.mappings[0].source.width = 0;
  cases.push({ name: 'zero-crop', state: zero, pattern: 'grid' });
  const comparisonFailures = [];
  for (const c of cases) {
    await page.evaluate(c => { window.projectionPoc.setState(c.state); window.projectionPoc.setPattern(c.pattern); }, c);
    await waitFrames();
    const css = await page.locator('#css').screenshot();
    const cssPixels = await page.evaluate(async png => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0);
      return Array.from(ctx.getImageData(0,0,img.width,img.height).data);
    }, css.toString('base64'));
    const gpu = await page.evaluate(() => window.projectionPoc.snapshot());
    assert.equal(cssPixels.length, gpu.pixels.length);
    const metrics = compare(cssPixels, gpu.pixels, gpu.width, gpu.height);
    report.comparisons.push({ name: c.name, ...metrics });
    if (artifactDir) {
      await writeFile(resolve(artifactDir, `${c.name}-css.png`), css);
      const png = await page.evaluate(() => document.getElementById('gpu').toDataURL().split(',')[1]);
      await writeFile(resolve(artifactDir, `${c.name}-gpu.png`), Buffer.from(png, 'base64'));
    }
    console.log(c.name, JSON.stringify(metrics));
    // Mipmapped video minification differs from Chromium's CSS layer filtering
    // on grid/text edges (most visible on a mirrored 320px preview). See report.
    if (metrics.mae > 6) comparisonFailures.push(`${c.name}: full-image MAE ${metrics.mae} > 6/255`);
    if (metrics.interiorBadFraction > 0.005) comparisonFailures.push(`${c.name}: interior mismatch > 0.5%`);
  }
  await comparisonStyle.evaluate(el => el.remove());
  assert.deepEqual(comparisonFailures, []);

  await page.selectOption('#preset', 'perspective');
  const corner = await page.locator('#handles circle').first().boundingBox();
  const oldCorner = await page.evaluate(() => ({...window.projectionPoc.state.mappings[0].quad.topLeft}));
  await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);
  await page.mouse.down(); await page.mouse.move(corner.x+corner.width/2+24,corner.y+corner.height/2+10,{steps:5}); await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(() => window.projectionPoc.state.mappings[0].quad.topLeft),oldCorner,'corner drag updates canonical PoC state');

  await page.evaluate(state => { window.projectionPoc.setState(state); window.projectionPoc.setPattern('white'); }, fixture('full'));
  await waitFrames();
  const probes = await page.evaluate(() => {
    const p = window.projectionPoc.preview; p.setBoxVisible(true); p.render();
    const result = {
      wall: p.probe([-2,1,-3],[0,0,1]), box: p.probe([-.2,1,0],[0,0,1]),
      hidden: p.probe([-.2,.8,-3],[0,0,1]), back: p.probe([-2,1,-3],[0,0,-1]),
      outside: p.probe([10,1,-3],[0,0,1]), behind: p.probe([0,2,5],[0,0,1]), far: p.probe([0,1,-40],[0,0,1]),
    };
    p.setBoxVisible(false); p.render(); result.uncovered = p.probe([-.2,.8,-3],[0,0,1]);
    p.setBoxVisible(true); p.render(); return result;
  });
  for (const name of ['wall','box','uncovered']) assert.ok(probes[name].every(c => c > 240), `${name} receives light`);
  for (const name of ['hidden','back','outside','behind','far']) assert.deepEqual(probes[name], [0,0,0], `${name} receives no light`);
  report.probes = probes;

  // Test actual rasterized back faces too, not only a negative-normal probe.
  await page.evaluate(() => {
    const p=window.projectionPoc.preview; p.controls.enableDamping=false;
    p.observer.position.set(0,2,-6); p.controls.target.set(0,2,-3); p.controls.update(); p.render();
  });
  const backLit = await page.locator('#venue').screenshot();
  await page.evaluate(() => { const p=window.projectionPoc.preview; p.setProjectionEnabled(false); p.render(); });
  const backUnlit = await page.locator('#venue').screenshot();
  assert.ok(backLit.equals(backUnlit),'front projection does not leak through the back of the wall');
  await page.evaluate(() => { const p=window.projectionPoc.preview; p.setProjectionEnabled(true); p.resetView(); });

  await page.evaluate(() => window.projectionPoc.setPattern('black')); await waitFrames();
  const black = await page.evaluate(() => {
    const p=window.projectionPoc.preview; p.render();
    return p.probe([-2,1,-3],[0,0,1]);
  });
  assert.deepEqual(black, [0,0,0]);
  // Black illumination leaves the venue identical to no illumination, not black.
  await page.evaluate(() => { const p=window.projectionPoc.preview; p.controls.enableDamping=false; p.render(); });
  const blackVenue = await page.locator('#venue').screenshot();
  await page.uncheck('#projection');
  const unlitVenue = await page.locator('#venue').screenshot();
  assert.ok(blackVenue.equals(unlitVenue), 'black does not paint over the venue');
  await page.check('#projection');

  const before = await page.evaluate(() => window.projectionPoc.preview.diagnostics());
  const canvas = await page.locator('#venue').boundingBox();
  await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
  await page.mouse.down(); await page.mouse.move(canvas.x+canvas.width/2+90,canvas.y+canvas.height/2+30,{steps:10}); await page.mouse.up();
  await page.mouse.wheel(0,120);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await waitFrames();
  const after = await page.evaluate(() => window.projectionPoc.preview.diagnostics());
  assert.deepEqual(after.projectorMatrix,before.projectorMatrix,'observer operations never move projector');
  assert.equal(after.depthRenders,before.depthRenders,'static depth reused across orbit/resize');

  for (let n=0;n<3;n++) {
    const stopped = await page.evaluate(() => {
      const p=window.projectionPoc.preview; window.projectionPoc.stop();
      return { ...p.diagnostics(), track: window.projectionPoc.stream.getVideoTracks()[0].readyState };
    });
    assert.equal(stopped.disposed,true); assert.equal(stopped.memory.textures,0); assert.equal(stopped.memory.geometries,0);
    assert.equal(stopped.track,'live','preview cannot stop borrowed tracks');
    await page.click('#start'); await page.waitForFunction(() => window.projectionPoc.preview?.depthRenders>0);
  }

  await page.evaluate(() => {
    const ext=window.projectionPoc.preview.renderer.getContext().getExtension('WEBGL_lose_context');
    window.restorePocContext=() => ext.restoreContext(); ext.loseContext();
  });
  await page.waitForFunction(() => !window.projectionPoc.preview);
  assert.equal(await page.evaluate(() => window.projectionPoc.stream.getVideoTracks()[0].readyState),'live');
  await page.evaluate(() => new Promise((resolve,reject) => {
    const timeout=setTimeout(()=>reject(new Error('WebGL did not restore within 10s')),10000);
    document.getElementById('venue').addEventListener('webglcontextrestored',()=>{clearTimeout(timeout);resolve();},{once:true}); window.restorePocContext();
  }));
  await page.click('#start'); await page.waitForFunction(() => window.projectionPoc.preview?.depthRenders>0);

  // Measure while the observer moves; source resolution is invariant.
  await page.selectOption('#preset','full');
  await page.selectOption('#resolution','640');
  await page.evaluate(() => { window.projectionPoc.setPattern('grid'); window.projectionPoc.preview.controls.autoRotate=true; });
  await page.waitForFunction(() => window.projectionPoc.frameTimes.length>=180, undefined, { timeout: 30000 });
  report.performance = await page.evaluate(() => {
    const api=window.projectionPoc, times=api.frameTimes.slice(-120).sort((a,b)=>a-b);
    api.preview.controls.autoRotate=false;
    return { ...api.preview.diagnostics(), source:[api.video.videoWidth,api.video.videoHeight], samples:times.length,
      fps:1000/(times.reduce((a,b)=>a+b,0)/times.length), p95FrameMs:times[Math.floor(times.length*.95)] };
  });
  assert.deepEqual(report.performance.source,[640,360]);
  if (artifactDir) await page.screenshot({path:resolve(artifactDir,'venue.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(report,null,2));
  if(artifactDir) await writeFile(resolve(artifactDir,'report.json'),JSON.stringify(report,null,2)+'\n');

  const unsupported = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--disable-webgl']});
  try {
    console.log('Testing deliberately disabled WebGL; renderer errors in this section are expected.');
    const fallback=await unsupported.newPage({locale:'ja-JP'}); await fallback.goto(url); await fallback.click('#start');
    await fallback.waitForFunction(() => document.getElementById('status').textContent.includes('開始できません'));
    assert.equal(await fallback.evaluate(() => window.projectionPoc.preview),null);
    assert.equal(await fallback.evaluate(() => window.projectionPoc.stream.getVideoTracks()[0].readyState),'live');
    await fallback.selectOption('#preset','perspective');
    assert.equal(await fallback.locator('#handles circle').count(),4,'2D stays editable when WebGL is unavailable');
  } finally { await unsupported.close(); }
  console.log('PASS: 14 CSS/GPU comparisons, projection/occlusion, editing, camera independence, lifecycle, WebGL failure fallback');
} finally {
  await browser.close(); await server.close();
}
