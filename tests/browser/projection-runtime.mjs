// Real ControlWindow UI and captureStream lifecycle, through both viewer entries.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = resolve(process.env.RUNTIME_TEST_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-unsafe-swiftshader'],
});

// Reloaded documents deliberately create their canvas after load, later than the
// old one-shot 100 ms recapture. Draw continuously so decoded pixels can be checked.
function fixture({ webgl = false, width = 320, height = 240, color = 'red', delay = 0 } = {}) {
  return `<!doctype html><script>
    let canvas, ctx, frame;
    window.createCanvas = () => {
      cancelAnimationFrame(frame);
      canvas?.remove();
      canvas = document.createElement('canvas');
      canvas.width = ${width}; canvas.height = ${height};
      document.body.appendChild(canvas);
      ctx = canvas.getContext('${webgl ? 'webgl' : '2d'}');
      window.gl = ${webgl ? 'ctx' : 'null'};
      function draw() {
        ${webgl ? 'ctx.clearColor(0, 1, 0, 1); ctx.clear(ctx.COLOR_BUFFER_BIT);'
          : `ctx.fillStyle = '${color}'; ctx.fillRect(0, 0, canvas.width, canvas.height);`}
        frame = requestAnimationFrame(draw);
      }
      draw();
    };
    addEventListener('load', () => setTimeout(createCanvas, ${delay}));
  </script><body></body>`;
}

async function setup(page, base) {
  await page.goto(base.url);
  await page.waitForSelector('input'); // entry smoke test, before mounting the real editor
  await page.evaluate(async moduleBase => {
    const [{ WindowController }, { ControlWindow }, { InlineControlHost }] = await Promise.all([
      import(`${moduleBase}/components/WindowController.ts`),
      import(`${moduleBase}/windows/control/ControlWindow.ts`),
      import(`${moduleBase}/windows/control/InlineControlHost.ts`),
    ]);
    const outer = document.createElement('aside');
    outer.style.cssText = 'position:fixed;inset:0;background:#222;z-index:9999';
    document.body.appendChild(outer);
    const wc = new WindowController();
    const h = window.runtimeRegression = { wc, outer, changes: [], echoes: 0, loads: 0, modes: [] };
    wc.events.state.subscribe(state => h.changes.push({ state: structuredClone(state), current: wc.events.state.get() === state }));
    const otherHost = new InlineControlHost(window, document.createElement('div'), wc);
    h.otherChanges = [];
    otherHost.onStateChange(state => h.otherChanges.push(structuredClone(state)));
    window.addEventListener('projection-mode-change', event => h.modes.push(event.detail.active));
    h.mount = () => {
      h.panel?.destroy(); h.offEcho?.();
      h.panel = new ControlWindow();
      h.panel.mountInline(outer, shell => h.host = new InlineControlHost(window, shell, wc));
      h.offEcho = h.host.onStateChange(() => h.echoes++);
      wc.rebindStreamToInlinePanel();
    };
    h.mount();
    h.video = () => document.getElementById('source-video');
    h.stream = () => h.video()?.srcObject;
    h.track = () => h.stream()?.getVideoTracks()[0];
    h.addFrame = async ({ html, url }) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-1000px;width:320px;height:240px';
      if (html) iframe.srcdoc = html; else iframe.src = url;
      const loaded = new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }));
      iframe.addEventListener('load', () => h.loads++);
      document.body.appendChild(iframe);
      await loaded;
      return iframe;
    };
  }, base.modules);
}

async function addSource(page, html, name = 'source', url) {
  await page.evaluate(async ({ html, name, url }) => {
    const h = window.runtimeRegression;
    h[name] = await h.addFrame({ html, url });
  }, { html, name, url });
  await page.waitForFunction(name => window.runtimeRegression[name].contentDocument.querySelector('canvas'), name);
}

async function start(page) {
  // Playwright's page.close can resolve before the opener's WindowProxy reports
  // closed. Wait for that observable state before asking for a new popup.
  await page.waitForFunction(() => !window.runtimeRegression.popup || window.runtimeRegression.popup.closed);
  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(async () => {
    const h = window.runtimeRegression;
    h.popup = h.wc.openOutputWindow();
    await h.wc.startCanvasStreaming(h.source);
  });
  const popup = await popupPromise;
  await waitVideo(page);
  return popup;
}

async function waitVideo(page, width) {
  await page.waitForFunction(width => {
    const video = window.runtimeRegression.video();
    return video?.readyState >= 2 && video.srcObject?.getVideoTracks()[0]?.readyState === 'live'
      && (!width || video.videoWidth === width);
  }, width);
}

async function click(page, selector) {
  // Tool column scroll does not affect the action; invoke the real button handler.
  await page.locator(selector).evaluate(el => el.click());
}

async function stateCase(page) {
  await addSource(page, fixture());
  await start(page);
  const remount = async label => {
    const expected = await page.evaluate(() => structuredClone(window.runtimeRegression.wc.events.state.get()));
    // Adding an output also opens it. Close every real output so the existing
    // last-window monitor, rather than a test-only stop call, ends projection.
    for (const output of page.context().pages()) if (output !== page) await output.close();
    await page.waitForFunction(() => window.runtimeRegression.modes.at(-1) === false);
    await page.evaluate(() => window.runtimeRegression.mount());
    const shown = await page.evaluate(() => {
      const h = window.runtimeRegression;
      return { state: h.host.getState(), mappings: h.outer.querySelectorAll('.mapping-list-item').length,
        outputs: h.outer.querySelectorAll('.output-item').length };
    });
    assert.deepEqual(shown.state, expected, `${label}: current snapshot survives restart`);
    assert.equal(shown.mappings, expected.mappings.length, `${label}: editor mappings`);
    assert.equal(shown.outputs, expected.outputs.length, `${label}: editor outputs`);
    await start(page);
    // A subsequent real edit must not overwrite the stored state with an old snapshot.
    await click(page, '#add-mapping-btn');
    await page.waitForFunction(() => localStorage.getItem('dropcaster.mappings.v2') === JSON.stringify(window.runtimeRegression.wc.events.state.get()));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dropcaster.mappings.v2')));
    assert.equal(stored.mappings.length, expected.mappings.length + 1);
    const persisted = JSON.parse(JSON.stringify(expected));
    for (const mapping of persisted.mappings) assert.deepEqual(stored.mappings.find(m => m.id === mapping.id), mapping, `${label}: preserved mapping`);
    assert.deepEqual(stored.outputs, persisted.outputs, `${label}: preserved outputs`);
  };
  await click(page, '#add-mapping-btn');
  await click(page, '#add-output-btn');
  const added = await page.evaluate(() => {
    const h = window.runtimeRegression;
    return { state: h.wc.events.state.get(), changes: h.changes, other: h.otherChanges, echoes: h.echoes };
  });
  assert.equal(added.state.mappings.length, 2);
  assert.equal(added.state.outputs.length, 2);
  assert.equal(added.echoes, 0, 'origin host receives no echo');
  assert.equal(added.changes.length, 2, 'non-host subscribers receive both replacements');
  assert.equal(added.other.length, 2, 'another host receives both replacements');
  assert.ok(added.changes.every(change => change.current), 'snapshot is current inside listeners');
  await remount('added');
  await click(page, '.mapping-list-item:last-child .remove-btn');
  await click(page, '.output-item:last-child .remove-output-btn');
  await remount('deleted');
  const imported = await page.evaluate(() => {
    const state = structuredClone(window.runtimeRegression.wc.events.state.get());
    state.mappings[0].name = 'Imported mapping';
    state.mappings[0].source = { x: 12, y: 8, width: 66, height: 75 };
    state.outputs[0].name = 'Imported output';
    return state;
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await click(page, '#import-settings-btn');
  await (await chooserPromise).setFiles({ name: 'venue.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await page.waitForFunction(() => window.runtimeRegression.wc.events.state.get().mappings[0].name === 'Imported mapping');
  await remount('imported');
  assert.equal(await page.evaluate(() => window.runtimeRegression.echoes), 0);
}

async function patternCase(page) {
  await addSource(page, fixture());
  await addSource(page, fixture({ width: 640, height: 360, color: 'blue' }), 'nextSource');
  await start(page);
  await click(page, '[data-pattern="grid"]');
  await waitVideo(page, 1920);
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.patternStream = h.stream(); h.patternTrack = h.track();
    h.wc.setSource(h.nextSource); // the same path used by SlideshowView
    h.wc.setSource(h.source);
    h.wc.setSource(h.nextSource);
  });
  assert.deepEqual(await page.evaluate(() => {
    const h = window.runtimeRegression;
    return { same: h.stream() === h.patternStream, track: h.patternTrack.readyState,
      selected: h.wc.events.testPattern.get(), active: document.querySelector('.test-pattern-btn.active').dataset.pattern,
      dimensions: h.wc.events.videoDimensions.get() };
  }), { same: true, track: 'live', selected: 'grid', active: 'grid', dimensions: { width: 1920, height: 1080 } });
  await page.evaluate(() => window.runtimeRegression.mount());
  assert.equal(await page.locator('.test-pattern-btn.active').getAttribute('data-pattern'), 'grid', 'remount shows the current pattern');
  for (const pattern of ['white', 'smpte', 'grid']) {
    await click(page, `[data-pattern="${pattern}"]`);
    assert.equal(await page.evaluate(() => window.runtimeRegression.stream() === window.runtimeRegression.patternStream), true);
  }
  await click(page, '[data-pattern="off"]');
  await waitVideo(page, 640);
  assert.deepEqual(await page.evaluate(() => {
    const h = window.runtimeRegression;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(h.video(), 0, 0, 1, 1);
    return { pixel: [...ctx.getImageData(0, 0, 1, 1).data], old: h.patternTrack.readyState,
      dimensions: h.wc.events.videoDimensions.get() };
  }), { pixel: [0, 0, 255, 255], old: 'ended', dimensions: { width: 640, height: 360 } });
  // A failed pattern capture keeps the live source and rolls back optimistic UI.
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.realCapture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = () => { throw new Error('intentional test pattern failure'); };
    h.beforeFailure = h.stream();
  });
  try {
    await click(page, '[data-pattern="white"]');
    assert.deepEqual(await page.evaluate(() => {
      const h = window.runtimeRegression;
      return { same: h.stream() === h.beforeFailure, live: h.track().readyState,
        kind: h.wc.events.testPattern.get(), active: document.querySelector('.test-pattern-btn.active').dataset.pattern };
    }), { same: true, live: 'live', kind: 'off', active: 'off' });
  } finally {
    await page.evaluate(() => { HTMLCanvasElement.prototype.captureStream = window.runtimeRegression.realCapture; });
  }
  await click(page, '[data-pattern="grid"]');
  await page.evaluate(() => window.runtimeRegression.wc.stopCanvasStreaming());
  assert.equal(await page.evaluate(() => window.runtimeRegression.wc.events.testPattern.get()), 'off');
  await page.evaluate(async () => {
    const h = window.runtimeRegression;
    h.mount(); await h.wc.startCanvasStreaming(h.nextSource);
  });
  await waitVideo(page, 640);
  assert.equal(await page.locator('.test-pattern-btn.active').getAttribute('data-pattern'), 'off');
}

async function recoveryCase(page, base) {
  for (const sourceType of ['srcdoc', 'src']) {
    await addSource(page, sourceType === 'srcdoc' ? fixture({ webgl: true, delay: 350 }) : undefined,
      'source', `${base.url}/runtime-webgl.html`);
    const popup = await start(page);
    await page.evaluate(() => {
      const h = window.runtimeRegression;
      h.oldCanvas = h.source.contentDocument.querySelector('canvas');
      h.oldTrack = h.track(); h.beforeLoads = h.loads;
      h.source.contentWindow.gl.getExtension('WEBGL_lose_context').loseContext();
    });
    await page.waitForFunction(() => window.runtimeRegression.wc.events.webglContext.get() === 'lost');
    await page.waitForFunction(() => {
      const h = window.runtimeRegression;
      return h.loads > h.beforeLoads && h.wc.events.webglContext.get() === 'ok'
        && h.track() !== h.oldTrack && h.track()?.readyState === 'live';
    }, null, { timeout: 15000 });
    await waitVideo(page, 320);
    assert.deepEqual(await page.evaluate(() => {
      const h = window.runtimeRegression;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d'); ctx.drawImage(h.video(), 0, 0, 1, 1);
      return { replaced: h.source.contentDocument.querySelector('canvas') !== h.oldCanvas,
        old: h.oldTrack.readyState, pixel: [...ctx.getImageData(0, 0, 1, 1).data],
        hidden: document.getElementById('dc-webgl-lost-banner').hidden,
        output: h.popup.document.querySelectorAll('video').length > 0
          && [...h.popup.document.querySelectorAll('video')].every(video => video.srcObject === h.stream()) };
    }), { replaced: true, old: 'ended', pixel: [0, 255, 0, 255], hidden: true, output: true }, `${sourceType}: reload reconnects decoded green video`);
    // The new canvas must have resize/context monitors too; native restore also reconnects.
    await page.evaluate(() => {
      const h = window.runtimeRegression;
      h.source.contentDocument.querySelector('canvas').width = 400;
      h.beforeLoads = h.loads; h.oldTrack = h.track();
      h.extension = h.source.contentWindow.gl.getExtension('WEBGL_lose_context');
      h.extension.loseContext();
    });
    await page.waitForFunction(() => window.runtimeRegression.wc.events.webglContext.get() === 'lost');
    await page.evaluate(() => window.runtimeRegression.extension.restoreContext());
    await page.waitForFunction(() => window.runtimeRegression.wc.events.webglContext.get() === 'ok');
    assert.deepEqual(await page.evaluate(() => {
      const h = window.runtimeRegression;
      return { reloaded: h.loads !== h.beforeLoads, newTrack: h.track() !== h.oldTrack, width: h.wc.events.videoDimensions.get().width };
    }), { reloaded: false, newTrack: true, width: 400 });
    // Same iframe + an explicitly ended track must not be mistaken for a live capture.
    await page.evaluate(() => {
      const h = window.runtimeRegression;
      h.oldTrack = h.track(); h.oldTrack.stop(); h.wc.setSource(h.source);
    });
    await page.waitForFunction(() => {
      const h = window.runtimeRegression; return h.track() !== h.oldTrack && h.track()?.readyState === 'live';
    });
    // Canvas replacement without a navigation must be observed as well.
    await page.evaluate(() => {
      const h = window.runtimeRegression;
      h.oldTrack = h.track(); h.source.contentWindow.createCanvas();
    });
    await page.waitForFunction(() => {
      const h = window.runtimeRegression; return h.track() !== h.oldTrack && h.oldTrack.readyState === 'ended';
    });
    await page.evaluate(() => window.runtimeRegression.wc.stopCanvasStreaming());
    await popup.close();
  }
  // Calibration suspends recovery, but returning to an already-lost canvas must
  // resume it; if the context restored while suspended it must not be reloaded.
  const calibrationPopup = await start(page);
  for (const restoreWhileCalibrating of [false, true]) {
    await page.evaluate(() => {
      const h = window.runtimeRegression;
      h.extension = h.source.contentWindow.gl.getExtension('WEBGL_lose_context');
      h.extension.loseContext();
    });
    await page.waitForFunction(() => window.runtimeRegression.wc.events.webglContext.get() === 'lost');
    await click(page, '[data-pattern="white"]');
    await waitVideo(page, 1920);
    if (restoreWhileCalibrating) {
      await page.evaluate(() => window.runtimeRegression.extension.restoreContext());
      await page.waitForFunction(() => !window.runtimeRegression.source.contentWindow.gl.isContextLost());
    }
    await page.evaluate(() => {
      const h = window.runtimeRegression; h.beforeLoads = h.loads;
    });
    await click(page, '[data-pattern="off"]');
    if (!restoreWhileCalibrating) {
      await page.waitForFunction(() => {
        const h = window.runtimeRegression; return h.loads > h.beforeLoads && h.wc.events.webglContext.get() === 'ok';
      }, null, { timeout: 15000 });
    } else {
      await page.waitForTimeout(2200);
      assert.equal(await page.evaluate(() => {
        const h = window.runtimeRegression; return h.loads === h.beforeLoads;
      }), true, 'already-restored canvas is not reloaded after calibration');
    }
    await waitVideo(page, 320);
  }
  await page.evaluate(() => window.runtimeRegression.wc.stopCanvasStreaming());
  await calibrationPopup.close();
  // Switching source during the 2 s recovery grace period must cancel the old reload.
  await addSource(page, fixture({ width: 640, height: 360, color: 'blue' }), 'nextSource');
  const switchedPopup = await start(page);
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.beforeLoads = h.loads;
    h.source.contentWindow.gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForFunction(() => window.runtimeRegression.wc.events.webglContext.get() === 'lost');
  await page.evaluate(() => {
    const h = window.runtimeRegression; h.wc.setSource(h.nextSource);
  });
  await waitVideo(page, 640);
  await page.waitForTimeout(2200);
  assert.deepEqual(await page.evaluate(() => {
    const h = window.runtimeRegression;
    return { reload: h.loads !== h.beforeLoads, width: h.video().videoWidth, status: h.wc.events.webglContext.get() };
  }), { reload: false, width: 640, status: 'ok' }, 'source switch cancels obsolete recovery');
  await page.evaluate(() => window.runtimeRegression.wc.stopCanvasStreaming());
  await switchedPopup.close();
  // Stop while the reloaded document is still waiting to generate its canvas.
  await addSource(page, fixture({ webgl: true, delay: 900 }));
  await start(page);
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.beforeLoads = h.loads;
    h.source.contentWindow.gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForFunction(() => window.runtimeRegression.loads > window.runtimeRegression.beforeLoads);
  await page.evaluate(() => window.runtimeRegression.wc.stopCanvasStreaming());
  await page.waitForFunction(() => window.runtimeRegression.source.contentDocument.querySelector('canvas'));
  await page.waitForTimeout(250); // beyond the 100 ms recapture debounce
  assert.deepEqual(await page.evaluate(() => {
    const h = window.runtimeRegression;
    return { live: h.track()?.readyState === 'live', status: h.wc.events.webglContext.get(), active: h.modes.at(-1) };
  }), { live: false, status: 'ok', active: false }, 'stop cancels delayed reload recovery');
  // Route teardown before the reload deadline cancels the navigation itself.
  await page.evaluate(async () => {
    const h = window.runtimeRegression;
    await h.wc.startCanvasStreaming(h.source);
    h.beforeLoads = h.loads;
    h.source.contentWindow.gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForFunction(() => window.runtimeRegression.wc.events.webglContext.get() === 'lost');
  await page.evaluate(() => window.runtimeRegression.wc.destroy());
  await page.waitForTimeout(2200); // assert that the cancelled 2 s timer cannot reload
  assert.deepEqual(await page.evaluate(() => {
    const h = window.runtimeRegression; return { reload: h.loads !== h.beforeLoads, live: h.track()?.readyState === 'live' };
  }), { reload: false, live: false }, 'destroy cancels reload and tracks');
}

try {
  for (const config of ['vite.config.ts', 'apps/web/vite.config.ts']) {
    const hosted = config.startsWith('apps/');
    const name = hosted ? 'hosted' : 'gallery';
    const server = await createServer({
      configFile: resolve(root, config),
      root: hosted ? resolve(root, 'apps/web') : root,
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: null, hmr: false },
      logLevel: 'error',
    });
    try {
      await server.listen();
      const base = { url: `http://127.0.0.1:${server.httpServer.address().port}`,
        modules: hosted ? `/@fs${root}/src/viewer` : '/src/viewer' };
      for (const [testName, run] of Object.entries({ state: stateCase, pattern: patternCase, recovery: recoveryCase })) {
        if (process.env.RUNTIME_CASE && process.env.RUNTIME_CASE !== testName) continue;
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        try {
          await context.route('**/sketches.json', route => route.fulfill({ json: [] }));
          await context.route('**/runtime-webgl.html', route => route.fulfill({ contentType: 'text/html', body: fixture({ webgl: true, delay: 350 }) }));
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          await setup(page, base);
          await run(page, base);
          await page.evaluate(() => {
            const h = window.runtimeRegression; h.panel.destroy(); h.wc.destroy();
          });
          assert.deepEqual(errors, [], `${name}/${testName}: uncaught browser errors`);
          console.log(`${name}/${testName}: PASS`);
        } finally { await context.close(); }
      }
    } finally { await server.close(); }
  }
  console.log(`Chromium ${browser.version()}: projection runtime regressions passed`);
} finally { await browser.close(); }
