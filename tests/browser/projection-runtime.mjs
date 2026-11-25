// Real ControlWindow UI and captureStream lifecycle, through both viewer entries.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { checkMainHiddenNotice, setMainVisibility } from './lib/main-hidden-notice.mjs';

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

// p5.js 1.x と同じく window の key* listener で受け、e.which で keyCode / keyIsDown を決める作品。
// Tab だけ preventDefault して、作品側の取り消しが出力ウィンドウの元のイベントに戻るかを見る。
const keyRecorder = `
  window.keyLog = [];
  for (const type of ['keydown', 'keyup', 'keypress']) addEventListener(type, e => {
    keyLog.push({ type, key: e.key, code: e.code, which: e.which, keyCode: e.keyCode, repeat: e.repeat, shift: e.shiftKey });
    if (type === 'keydown' && e.key === 'Tab') e.preventDefault();
  });`;
const keyFixture = () => fixture().replace('<script>', `<script>${keyRecorder}`);

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

async function keysCase(page) {
  await addSource(page, keyFixture());
  await addSource(page, keyFixture(), 'nextSource');
  const popup = await start(page);
  await popup.waitForSelector('#dc-output-stage');
  // 作品に届いたキー（keypress を除く）を [type, key, code, which] で取り出して消す。
  const take = (name = 'source') => page.evaluate(n => window.runtimeRegression[n].contentWindow.keyLog.splice(0), name);
  const downUp = log => log.filter(k => k.type !== 'keypress').map(k => [k.type, k.key, k.code, k.which]);
  await popup.evaluate(() => {
    // 全画面の開始・解除の呼び出しを数え、順に記録する。CI の Chrome は実際に全画面へ入る。
    window.fullscreenCalls = 0;
    window.fullscreenLog = [];
    const request = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function () { window.fullscreenCalls++; window.fullscreenLog.push('request'); return request.call(this); };
    const exit = Document.prototype.exitFullscreen;
    Document.prototype.exitFullscreen = function () { window.fullscreenCalls++; window.fullscreenLog.push('exit'); return exit.call(this); };
    // 出力ウィンドウ側の転送 listener より後に登録し、元のイベントの defaultPrevented を見る。
    window.prevented = [];
    addEventListener('keydown', e => window.prevented.push([e.key, e.defaultPrevented]));
  });

  await popup.keyboard.press('2');
  const two = await take();
  assert.deepEqual(downUp(two), [['keydown', '2', 'Digit2', 50], ['keyup', '2', 'Digit2', 50]], 'digit reaches the sketch');
  assert.ok(two.some(k => k.type === 'keypress' && k.key === '2'), 'keypress (p5 keyTyped) reaches the sketch');

  await popup.keyboard.down('Space');
  await popup.keyboard.down('Space');
  await popup.keyboard.up('Space');
  assert.deepEqual((await take()).filter(k => k.type !== 'keypress').map(k => [k.type, k.code, k.which, k.repeat]),
    [['keydown', 'Space', 32, false], ['keydown', 'Space', 32, true], ['keyup', 'Space', 32, false]], 'hold and repeat');

  await popup.keyboard.press('Shift+KeyA');
  assert.deepEqual((await take()).filter(k => k.key === 'A').map(k => [k.type, k.which, k.shift]),
    [['keydown', 65, true], ['keypress', 65, true], ['keyup', 65, true]], 'modifier state reaches the sketch');

  await popup.keyboard.press('f');
  assert.deepEqual(downUp(await take()), [['keydown', 'f', 'KeyF', 70], ['keyup', 'f', 'KeyF', 70]], 'f goes to the sketch');
  assert.equal(await popup.evaluate(() => window.fullscreenCalls), 0, 'f no longer toggles output fullscreen');

  await popup.keyboard.press('Tab');
  assert.deepEqual(await popup.evaluate(() => window.prevented.filter(([key]) => key === 'Tab' || key === '2')),
    [['2', false], ['Tab', true]], 'sketch preventDefault cancels the original key');
  await take();

  await popup.keyboard.down('a');
  await popup.evaluate(() => dispatchEvent(new FocusEvent('blur')));
  assert.deepEqual(downUp(await take()), [['keydown', 'a', 'KeyA', 65], ['keyup', 'a', 'KeyA', 65]], 'blur releases held keys');
  await popup.keyboard.up('a');
  await take();

  await popup.locator('#dc-output-fs').focus();
  await popup.keyboard.press('Enter');
  assert.deepEqual(await take(), [], 'keys on the output UI button stay in the output window');
  await popup.evaluate(() => document.activeElement.blur());

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ControlOrMeta+z');
  assert.deepEqual(await take(), [], 'main window keys do not reach the sketch');

  await page.evaluate(() => window.runtimeRegression.wc.setSource(window.runtimeRegression.nextSource));
  await popup.keyboard.press('3');
  assert.deepEqual(await take(), [], 'replaced source no longer receives keys');
  assert.deepEqual(downUp(await take('nextSource')), [['keydown', '3', 'Digit3', 51], ['keyup', '3', 'Digit3', 51]], 'new source receives keys');

  assert.doesNotMatch(await popup.locator('#dc-output-hint').textContent(), /\bF\b/, 'hint no longer offers F');

  // 出力を足して 2 台目の出力ウィンドウを開く。そちらで押したキーも同じ作品へ届く。
  await click(page, '#add-output-btn');
  const [second] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => {
    const { wc } = window.runtimeRegression;
    return void wc.openOutputWindowFor(wc.events.state.get().outputs.at(-1).id);
  })]);
  await second.waitForSelector('#dc-output-stage');
  await second.keyboard.press('4');
  assert.deepEqual(downUp(await take('nextSource')), [['keydown', '4', 'Digit4', 52], ['keyup', '4', 'Digit4', 52]], 'second output forwards keys');

  // 全画面にはダブルクリックで入れる。全画面中のダブルクリックでは抜けない (#258)。
  // （上の全画面ボタンでの Enter で全画面に入っているので、いったん抜けてから数える）
  await popup.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : undefined);
  await popup.waitForFunction(() => !document.fullscreenElement);
  await popup.evaluate(() => { window.fullscreenLog = []; });
  await popup.locator('#dc-output-stage').dblclick();
  await popup.waitForFunction(() => !!document.fullscreenElement);
  await popup.locator('#dc-output-stage').dblclick();
  // 解除が走るなら fullscreenchange を待つ間に起きるので、少し待ってから見る。
  await popup.waitForTimeout(300);
  assert.deepEqual(await popup.evaluate(() => window.fullscreenLog), ['request'], 'double-click enters fullscreen but never exits it');
  assert.ok(await popup.evaluate(() => !!document.fullscreenElement), 'output stays fullscreen after double-click');
  // 作品へキーを渡す出力で手で抜ける手段は Esc と全画面ボタン。ボタンで抜けられる。
  await popup.locator('#dc-output-fs').click();
  await popup.waitForFunction(() => !document.fullscreenElement);
  assert.deepEqual(await popup.evaluate(() => window.fullscreenLog), ['request', 'exit'], 'fullscreen button exits fullscreen');
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

// #152: dragging an output in the layout tab must not resize the virtual-canvas
// compositor layer (full re-raster per frame), nor re-append the output popup's
// <video> containers. Both made the editor and the layout view flicker.
async function layoutDragCase(page) {
  await addSource(page, fixture());
  const popup = await start(page);
  await click(page, '#add-mapping-btn');
  await click(page, '#layout-tab');
  await page.waitForSelector('.dc-layout-output');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('LayerTree.enable');
  const { root: docRoot } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '.dc-layout-canvas' });
  const { node } = await cdp.send('DOM.describeNode', { nodeId });
  let recording = false;
  const canvasLayerSizes = new Set();
  cdp.on('LayerTree.layerTreeDidChange', ({ layers }) => {
    if (!recording || !layers) return;
    for (const l of layers) {
      if (l.backendNodeId === node.backendNodeId && l.drawsContent) canvasLayerSizes.add(`${Math.round(l.width)}x${Math.round(l.height)}`);
    }
  });

  await popup.evaluate(() => {
    const canvas = document.getElementById('dc-output-canvas');
    window.dragProbe = { childList: 0, transforms: new Set() };
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'childList') window.dragProbe.childList++;
        else window.dragProbe.transforms.add(canvas.style.transform);
      }
    }).observe(canvas, { childList: true, attributes: true, attributeFilter: ['style'] });
  });

  // Drag outward so the output leaves the virtual canvas (canvas dims are fixed mid-drag).
  // `at` is the grab point inside the element's box (the resize handle sits on the
  // clipped corner of the output, so its centre is outside the hit area).
  const drag = async (selector, label, at = 0.5) => {
    canvasLayerSizes.clear();
    await popup.evaluate(() => { window.dragProbe.childList = 0; window.dragProbe.transforms.clear(); });
    const box = await page.locator(selector).first().boundingBox();
    const x0 = box.x + box.width * at, y0 = box.y + box.height * at;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    recording = true;
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x0 + i * 4, y0 + i * 3);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    }
    recording = false;
    const probe = await popup.evaluate(() => ({ childList: window.dragProbe.childList, transforms: window.dragProbe.transforms.size }));
    await page.mouse.up();
    assert.ok(canvasLayerSizes.size > 0, `${label}: virtual-canvas layer observed during drag`);
    assert.equal(canvasLayerSizes.size, 1, `${label}: virtual-canvas layer keeps its size (${[...canvasLayerSizes].join(', ')})`);
    assert.ok(probe.transforms > 1, `${label}: output window follows the drag`);
    assert.equal(probe.childList, 0, `${label}: output window keeps its mapping elements attached`);
  };
  await drag('.dc-layout-output', 'move');
  await drag('.dc-layout-resize.se', 'resize', 0.2);

  // Re-ordering mappings must still re-order the output window's elements, in both
  // directions (one direction alone can match the creation order by chance).
  const orders = await page.evaluate(async () => {
    const h = window.runtimeRegression;
    const output = [...h.wc.outputWindows.values()][0];
    const results = [];
    for (let i = 0; i < 2; i++) {
      const state = h.wc.events.state.get();
      h.wc.applyStateFromInline({ ...state, mappings: [...state.mappings].reverse() });
      await new Promise(r => setTimeout(r, 100));
      // First in the list is frontmost, i.e. last in DOM order.
      const expected = h.wc.events.state.get().mappings.map(m => output.children.get(m.id)?.div).filter(Boolean).reverse();
      const actual = [...output.getWindow().document.getElementById('dc-output-canvas').children].filter(el => expected.includes(el));
      results.push({ count: expected.length, same: expected.every((el, j) => actual[j] === el) });
    }
    return results;
  });
  assert.deepEqual(orders, [{ count: 2, same: true }, { count: 2, same: true }], 'mapping re-order updates the output DOM order');
  await cdp.detach();
}

// #156: a canvas-sized element warped by a perspective matrix3d cannot be rastered
// at the ancestor's down-scale, so any paint on it (the mapping outline) costs
// thousands of tiles and starves the compositor (checkerboarded holes across the
// editor). Warped elements carry only the <video>; outlines live in untransformed SVG.
async function quadTilesCase(page) {
  await addSource(page, fixture());
  await start(page);
  const W = 1920, H = 1080;
  const quads = [
    [[260, 140], [980, 300], [900, 900], [120, 980]],
    [[700, 200], [1500, 80], [1400, 760], [760, 820]],
    [[1300, 120], [1850, 260], [1700, 900], [1250, 980]],
  ].map(([tl, tr, br, bl]) => ({
    topLeft: { x: tl[0], y: tl[1] }, topRight: { x: tr[0], y: tr[1] },
    bottomRight: { x: br[0], y: br[1] }, bottomLeft: { x: bl[0], y: bl[1] },
  }));
  const state = {
    version: 2,
    canvas: { width: 2 * W, height: 2 * H },
    outputs: [
      { id: 'o1', name: 'Output 1', position: { x: 0, y: 0 }, size: { width: W, height: H } },
      { id: 'o2', name: 'Output 2', position: { x: W, y: 0 }, size: { width: W, height: H } },
      { id: 'o3', name: 'Output 3', position: { x: W / 2, y: H }, size: { width: W, height: H } },
    ],
    mappings: quads.map((quad, i) => ({ id: `q${i + 1}`, source: { x: 0, y: 0, width: 1, height: 1 }, quad })),
    activeId: 'q2',
    activeOutputId: 'o1',
  };

  const cdp = await page.context().newCDPSession(page);
  // Peak tile demand and OOM flags of every compositor while `action` settles.
  const measure = async action => {
    const events = [];
    const onData = ({ value }) => events.push(...value);
    cdp.on('Tracing.dataCollected', onData);
    const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-cc.debug'] } });
    await action();
    await page.waitForTimeout(1500);
    await cdp.send('Tracing.end');
    await complete;
    cdp.off('Tracing.dataCollected', onData);
    const prepared = events.filter(e => e.name === 'DidPrepareTiles').map(e => e.args.state);
    return { samples: prepared.length, maxTiles: Math.max(0, ...prepared.map(s => s.tile_count)), oom: prepared.filter(s => s.did_oom_on_last_assign).length };
  };
  // Outlines must stay with their mapping: same corners, same stacking slot, and
  // the warped element itself must not paint a border.
  const outlines = selector => page.evaluate(({ selector, quads }) => {
    const ids = ['q1', 'q2', 'q3'];
    return [...document.querySelectorAll(selector)].map(el => {
      const outline = el.nextElementSibling;
      const id = el.dataset.mappingId ?? ids.find(i => el.id === 'cropped-container' && i === window.runtimeRegression.wc.events.state.get().activeId);
      const q = quads[ids.indexOf(id)];
      const expected = q && [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft].map(p => `${p.x},${p.y}`).join(' ');
      const style = getComputedStyle(el);
      return {
        selector, id,
        border: style.borderTopWidth,
        outline: !!outline?.classList.contains('dc-quad-outline'),
        points: outline?.querySelector('polygon')?.getAttribute('points') === expected,
        zIndex: outline ? getComputedStyle(outline).zIndex === style.zIndex : false,
      };
    });
  }, { selector, quads });

  const mappingTab = await measure(() => page.evaluate(s => window.runtimeRegression.wc.applyStateFromInline(s), state));
  const mappingOutlines = [...await outlines('#cropped-container'), ...await outlines('.preview-mapping.inactive')];
  await click(page, '#layout-tab');
  const layoutTab = await measure(() => page.waitForSelector('.dc-layout-preview'));
  const layoutOutlines = await outlines('.dc-layout-preview');
  // The reported operation: drag an output while the output window draws its
  // dev-mode outlines (the output window warps the same canvas-sized elements).
  // The popup opened by start() belonged to the previous state's output; open o1's.
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(() => window.runtimeRegression.wc.openOutputWindowFor('o1')),
  ]);
  await popup.waitForFunction(() => document.querySelectorAll('.dc-out-mapping').length > 0);
  await page.evaluate(() => window.runtimeRegression.wc.setDevMode(true));
  await popup.waitForFunction(() => document.getElementById('dc-output-stage')?.classList.contains('dc-dev-mode'));
  const layoutDrag = await measure(async () => {
    const box = await page.locator('.dc-layout-output[data-output-id="o3"]').boundingBox();
    const x0 = box.x + box.width / 2, y0 = box.y + box.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(x0 + Math.sin(i / 5) * 60, y0 + i);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    }
    await page.mouse.up();
  });
  const popupOutlines = await popup.evaluate(() => [...document.querySelectorAll('.dc-out-mapping')].map(el => ({
    border: getComputedStyle(el).borderTopWidth,
    outline: el.nextElementSibling?.classList.contains('dc-out-outline') && getComputedStyle(el.nextElementSibling).display !== 'none',
  })));
  await cdp.detach();

  console.log(`  quadTiles: mapping tab ${JSON.stringify(mappingTab)}, layout tab ${JSON.stringify(layoutTab)}, dev-mode drag ${JSON.stringify(layoutDrag)}`);
  for (const [label, m] of Object.entries({ mappingTab, layoutTab, layoutDrag })) {
    assert.ok(m.samples > 0, `${label}: tile preparation observed`);
    // Rectangular quads measure ~100 tiles; perspective quads with painted warped
    // layers measured ~2,700 before the fix.
    assert.ok(m.maxTiles < 500, `${label}: peak tile demand ${m.maxTiles} stays below 500`);
    assert.equal(m.oom, 0, `${label}: compositor never runs out of tile memory`);
  }
  assert.equal(mappingOutlines.length, 3, 'mapping tab: active + 2 inactive previews');
  assert.equal(layoutOutlines.length, 9, 'layout tab: 3 mappings x 3 outputs');
  assert.ok(popupOutlines.length > 0, 'output window draws mappings');
  for (const o of popupOutlines) assert.deepEqual(o, { border: '0px', outline: true }, 'output window: dev-mode outline in untransformed SVG');
  for (const o of [...mappingOutlines, ...layoutOutlines]) {
    assert.deepEqual(o, { selector: o.selector, id: o.id, border: '0px', outline: true, points: true, zIndex: true }, `${o.selector} ${o.id}: outline in untransformed SVG`);
  }
}

// #196: 投影が映らないときの原因を、観測できた状態から操作画面に出す。ソース列に作品側
// (canvas 待ち・canvas なし・capture 失敗・取り直し中・canvas が複数)、出力一覧の各行に出力側
// (未起動・再生エラー) を対処と一緒に出し、正常に戻ったら消す。静止した作品・テストパターンは失敗にしない。
async function diagnosisCase(page, base) {
  const sourceStatus = () => page.evaluate(() => {
    const el = document.getElementById('dc-source-status');
    return { hidden: el.hidden, kind: el.dataset.kind, level: el.dataset.level,
      text: el.querySelector('.dc-source-status-text').textContent,
      hint: el.querySelector('.dc-source-status-hint').hidden ? '' : el.querySelector('.dc-source-status-hint').textContent };
  });
  const waitKind = (kind, timeout) => page.waitForFunction(kind => document.getElementById('dc-source-status').dataset.kind === kind, kind, { timeout });
  const outputRow = () => page.evaluate(() => {
    const status = document.querySelector('.output-item .output-status');
    return status ? { kind: status.dataset.kind, text: status.textContent } : null;
  });
  // 一瞬だけの状態 (取り直し中) も取りこぼさないよう、ソース列の表示の移り変わりを記録する。
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    const el = document.getElementById('dc-source-status');
    h.statusLog = [];
    new MutationObserver(() => h.statusLog.push({ kind: el.dataset.kind, hidden: el.hidden, text: el.textContent.trim() }))
      .observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  });

  // 出力を開く前: 出力一覧の行に「未起動」と開き方が出る。ソース列は配信していないので何も出さない。
  assert.deepEqual(await outputRow(), { kind: 'notOpen', text: 'Not open: press “Open” to project on this output.' }, 'closed output: not open');
  assert.equal((await sourceStatus()).hidden, true, 'idle: no source notice');

  // canvas を作らない作品 (ここでは作るのを止めている作品)。待っている間は待っていると出し、
  // 待ち時間を過ぎたら「canvas が見つかりません」と対処を出す。出力の行は開いたので消える。
  await page.evaluate(async html => {
    const h = window.runtimeRegression;
    h.source = await h.addFrame({ html });
  }, fixture({ delay: 600000 }));
  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(async () => {
    const h = window.runtimeRegression;
    h.popup = h.wc.openOutputWindow();
    await h.wc.startCanvasStreaming(h.source);
  });
  await popupPromise;
  assert.deepEqual(await sourceStatus(), { hidden: false, kind: 'waiting', level: 'pending',
    text: 'Waiting for the sketch to create its canvas…', hint: '' }, 'no canvas yet: waiting');
  await page.waitForFunction(() => !document.querySelector('.output-item .output-status'));
  await waitKind('noCanvas', 8000);
  const noCanvas = await sourceStatus();
  assert.deepEqual({ ...noCanvas, hint: undefined }, { hidden: false, kind: 'noCanvas', level: 'error', text: 'No canvas found in the sketch.', hint: undefined });
  assert.match(noCanvas.hint, /may not be creating a canvas/, 'no canvas: hint');
  // 作品が canvas を作ったら映し、表示も消える (正常に戻る)。
  await page.evaluate(() => window.runtimeRegression.source.contentWindow.createCanvas());
  await waitVideo(page, 320);
  await waitKind('ok');
  assert.deepEqual(await sourceStatus(), { hidden: true, kind: 'ok', level: 'ok', text: '', hint: '' }, 'canvas appeared: back to normal');

  // track が終わったら取り直し中と出し、取り直せたら消す。
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.statusLog.length = 0; h.oldTrack = h.track();
    h.oldTrack.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction(() => {
    const h = window.runtimeRegression; return h.track() !== h.oldTrack && h.track()?.readyState === 'live';
  });
  await waitVideo(page, 320);
  const recapture = await page.evaluate(() => window.runtimeRegression.statusLog);
  assert.ok(recapture.some(s => s.kind === 'recapturing' && !s.hidden && s.text === 'The video from the canvas stopped. Capturing it again…'),
    `track ended: recapturing is shown (${JSON.stringify(recapture)})`);
  assert.deepEqual(await sourceStatus(), { hidden: true, kind: 'ok', level: 'ok', text: '', hint: '' }, 'recaptured: back to normal');

  // canvas が複数あると、最初の 1 枚を映していることを知らせる (失敗にはしない)。減ったら消す。
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.extraCanvas = h.source.contentDocument.createElement('canvas');
    h.source.contentDocument.body.appendChild(h.extraCanvas);
  });
  await page.waitForFunction(() => !document.getElementById('dc-source-status').hidden);
  assert.deepEqual(await sourceStatus(), { hidden: false, kind: 'ok', level: 'notice',
    text: 'The sketch has 2 canvases. The first one (320×240) is projected.', hint: '' }, 'two canvases: first one');
  await page.evaluate(() => window.runtimeRegression.extraCanvas.remove());
  await page.waitForFunction(() => document.getElementById('dc-source-status').hidden);

  // テストパターンを映している間も、静止した作品 (描き直さない canvas) を映している間も失敗にしない。
  await click(page, '[data-pattern="grid"]');
  await waitVideo(page, 1920);
  assert.deepEqual(await sourceStatus(), { hidden: true, kind: 'testPattern', level: 'ok', text: '', hint: '' }, 'test pattern: not a failure');
  await click(page, '[data-pattern="off"]');
  await waitVideo(page, 320);
  const still = `<!doctype html><script>addEventListener('load', () => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    canvas.getContext('2d').fillRect(0, 0, 200, 100); document.body.appendChild(canvas);
  });</script><body></body>`;
  await addSource(page, still, 'still');
  await page.evaluate(() => {
    const h = window.runtimeRegression; h.statusLog.length = 0; h.wc.setSource(h.still);
  });
  // 描き終えた後に捕まえた静止 canvas は、次に描き直すまで映像のフレームを出さないことがある。
  // フレームの有無では判定しないので、capture が始まったこと (寸法と live の track) だけを待つ。
  await page.waitForFunction(() => {
    const h = window.runtimeRegression;
    return h.wc.events.videoDimensions.get().width === 200 && h.track()?.readyState === 'live';
  });
  await page.waitForTimeout(6000); // 「canvas なし」の待ち時間 (5 秒) を越えても変わらない
  assert.deepEqual(await sourceStatus(), { hidden: true, kind: 'ok', level: 'ok', text: '', hint: '' }, 'still canvas: not a failure');
  assert.deepEqual((await page.evaluate(() => window.runtimeRegression.statusLog)).filter(s => !s.hidden), [], 'still canvas: nothing shown meanwhile');

  // 別のサイトの画像を CORS の許可なしに描いた canvas は captureStream が SecurityError になる。
  // 原因と対処を出し、作品が描ける canvas に替えたら映して消す。
  await page.context().route('http://other.test/**', route => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  const tainted = fixture({ width: 240, height: 120, delay: 600000 }).replace('</script>', `
    addEventListener('load', async () => {
      const img = new Image(); img.src = 'http://other.test/texture.png'; await img.decode();
      const dirty = document.createElement('canvas'); dirty.width = 160; dirty.height = 90;
      dirty.getContext('2d').drawImage(img, 0, 0);
      document.body.appendChild(dirty);
      window.useCleanCanvas = () => { dirty.remove(); createCanvas(); };
    });</script>`);
  await page.evaluate(async html => {
    const h = window.runtimeRegression;
    h.tainted = await h.addFrame({ html });
    h.wc.setSource(h.tainted);
  }, tainted);
  await waitKind('captureFailed');
  const failed = await sourceStatus();
  assert.deepEqual({ ...failed, hint: undefined }, { hidden: false, kind: 'captureFailed', level: 'error',
    text: 'Could not capture video from the sketch canvas (SecurityError).', hint: undefined }, 'tainted canvas: capture failed');
  assert.match(failed.hint, /without CORS permission/, 'tainted canvas: hint names CORS');
  await page.evaluate(() => window.runtimeRegression.tainted.contentWindow.useCleanCanvas());
  await waitVideo(page, 240);
  await waitKind('ok');
  assert.equal((await sourceStatus()).hidden, true, 'clean canvas: back to normal');

  // 出力ウィンドウの <video>.play() が拒否されたら (自動再生を許さないブラウザ設定など)、その出力の行に出す。
  const outputPopup = page.context().pages().find(p => p !== page);
  const rebind = () => outputPopup.evaluate(() => {
    for (const video of document.querySelectorAll('video')) { video.autoplay = false; video.srcObject = null; }
    opener.postMessage({ type: 'output-needs-stream' }, opener.location.origin);
  });
  await outputPopup.evaluate(() => {
    window.realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('autoplay is not allowed', 'NotAllowedError'));
  });
  await rebind();
  await page.waitForFunction(() => document.querySelector('.output-item .output-status')?.dataset.kind === 'playError');
  assert.deepEqual(await outputRow(), { kind: 'playError', text: 'The output window could not play the video (NotAllowedError).'
    + 'The browser is blocking autoplay for this site. Allow autoplay in the site settings, then close this output and open it again.' }, 'play rejected: shown on the row');
  assert.deepEqual(Object.values(await page.evaluate(() => window.runtimeRegression.wc.events.outputDiagnosis.get())),
    [{ kind: 'playError', error: 'NotAllowedError' }], 'play rejected: state model');
  await outputPopup.evaluate(() => { HTMLMediaElement.prototype.play = window.realPlay; });
  await rebind();
  await page.waitForFunction(() => !document.querySelector('.output-item .output-status'));
  assert.deepEqual(Object.values(await page.evaluate(() => window.runtimeRegression.wc.events.outputDiagnosis.get())),
    [{ kind: 'open' }], 'play resumed: back to normal');

  // 出力を閉じると、行は再び「未起動」に戻る。日本語でも同じ。
  await outputPopup.close();
  await page.waitForFunction(() => document.querySelector('.output-item .output-status')?.dataset.kind === 'notOpen');
  await page.evaluate(async moduleBase => (await import(`${moduleBase}/i18n/index.ts`)).setLang('ja'), base.modules);
  assert.deepEqual(await outputRow(), { kind: 'notOpen', text: '未起動: 「開く」で出力ウィンドウを開くと、この出力に映ります。' }, 'ja: not open');
}

/** RUNTIME_ARTIFACT_DIR があれば、メイン画面を隠して操作中の出力 (案内が出た状態) を保存する。 */
async function snapshotNotice(page, popup, file) {
  const dir = process.env.RUNTIME_ARTIFACT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await setMainVisibility(page, 'hidden');
  await popup.mouse.move(300, 300);
  await popup.waitForFunction(() => getComputedStyle(document.getElementById('dc-output-main-hidden')).opacity === '1');
  await popup.screenshot({ path: resolve(dir, file) });
  await setMainVisibility(page, 'visible');
}

// #185: メイン画面が隠れると作品の rAF と captureStream が止まる。出力ウィンドウで操作している
// 間だけ原因と対処を示す (全画面でも同じ)。出力を開いていなければ何も出さない。
async function mainHiddenCase(page, base) {
  await addSource(page, fixture());
  // 出力を開く前にメイン画面が隠れても、どこにも案内は出ない (メイン画面にも出さない)。
  await setMainVisibility(page, 'hidden');
  assert.equal(page.context().pages().length, 1, 'no output window: nothing opens');
  assert.equal(await page.locator('#dc-output-main-hidden').count(), 0, 'no output window: main page shows nothing');
  await setMainVisibility(page, 'visible');

  // 後始末の検査用: OutputWindow がメイン画面の visibilitychange で動いた回数と、残っているリスナーを数える。
  await page.evaluate(async moduleBase => {
    const { OutputWindow } = await import(`${moduleBase}/windows/output/OutputWindow.ts`);
    const h = window.runtimeRegression;
    const sync = OutputWindow.prototype.syncMainHidden;
    h.mainHiddenSyncs = 0;
    OutputWindow.prototype.syncMainHidden = function (...args) { h.mainHiddenSyncs++; return sync.apply(this, args); };
    h.mainVisibilityListeners = new Set();
    const add = document.addEventListener, remove = document.removeEventListener;
    document.addEventListener = function (type, listener, ...rest) {
      if (type === 'visibilitychange' && String(listener).includes('syncMainHidden')) h.mainVisibilityListeners.add(listener);
      return add.call(this, type, listener, ...rest);
    };
    document.removeEventListener = function (type, listener, ...rest) {
      if (type === 'visibilitychange') h.mainVisibilityListeners.delete(listener);
      return remove.call(this, type, listener, ...rest);
    };
  }, base.modules);
  /** 出力を閉じた後、メイン画面の表示が変わっても OutputWindow の処理が走らないこと。 */
  const assertReleased = async label => {
    await page.waitForFunction(() => window.runtimeRegression.popup.closed);
    await page.evaluate(() => { window.runtimeRegression.mainHiddenSyncs = 0; });
    await setMainVisibility(page, 'hidden');
    await setMainVisibility(page, 'visible');
    assert.deepEqual(await page.evaluate(() => {
      const h = window.runtimeRegression;
      return { listeners: h.mainVisibilityListeners.size, syncs: h.mainHiddenSyncs };
    }), { listeners: 0, syncs: 0 }, `${label}: closed output stops watching the main page`);
  };

  let popup = await start(page);
  assert.equal(await page.evaluate(() => window.runtimeRegression.mainVisibilityListeners.size), 1, 'open output watches the main page');
  await popup.setViewportSize({ width: 960, height: 600 });
  await checkMainHiddenNotice(page, popup, { lang: 'en', label: 'window' });
  // 全画面の出力でも同じ規則 (表示を全画面の有無で変えない)。
  await popup.locator('#dc-output-fs').click();
  await popup.waitForFunction(() => !!document.fullscreenElement);
  await checkMainHiddenNotice(page, popup, { lang: 'en', label: 'fullscreen' });
  await snapshotNotice(page, popup, `${base.name}-main-hidden-fullscreen-en.png`);
  await popup.evaluate(() => document.exitFullscreen());

  // 利用者がウィンドウを閉じる経路 (beforeunload が走る)。
  await popup.close({ runBeforeUnload: true });
  await assertReleased('window closed by the user');

  await page.evaluate(async moduleBase => (await import(`${moduleBase}/i18n/index.ts`)).setLang('ja'), base.modules);
  popup = await start(page);
  await popup.setViewportSize({ width: 960, height: 600 });
  await checkMainHiddenNotice(page, popup, { lang: 'ja', label: 'ja' });
  await snapshotNotice(page, popup, `${base.name}-main-hidden-window-ja.png`);
  // アプリの操作で閉じる経路 (操作パネルの出力の「閉じる」と同じ closeOutputWindowFor)。
  await page.evaluate(() => {
    const h = window.runtimeRegression;
    h.wc.closeOutputWindowFor(h.wc.events.state.get().outputs[0].id);
  });
  await assertReleased('window closed by the app');
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
      const base = { name, url: `http://127.0.0.1:${server.httpServer.address().port}`,
        modules: hosted ? `/@fs${root}/src/viewer` : '/src/viewer' };
      for (const [testName, run] of Object.entries({ state: stateCase, pattern: patternCase, recovery: recoveryCase, keys: keysCase, layoutDrag: layoutDragCase, quadTiles: quadTilesCase, mainHidden: mainHiddenCase, diagnosis: diagnosisCase })) {
        if (process.env.RUNTIME_CASE && process.env.RUNTIME_CASE !== testName) continue;
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', locale: 'en-US' });
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
