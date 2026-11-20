// スライドショーの先読み iframe が待機中に描画ループを回さないことを、実 App で確かめる (#172)。
//
// 各作品は rAF のたびに window.__frames を数えるだけの最小 fixture。iframe ごとの回数を
// 一定時間おいて読み、表示中は進み、先読みで非表示のものは進まないことを見る。
// 本番コードには手を入れず、作品 HTML の応答だけ context.route で差し替える
// (先読みの完了を保留したいケースだけ、その応答をテストが解く)。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
// 指定すると、切替の前後 (直前・直後・フェード完了後) の画面を保存する
const artifactDir = process.env.SLIDESHOW_ARTIFACT_DIR;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
// 計測窓。headless Chromium の rAF は約 60 Hz なので表示側は 1 秒で数十進む
const WINDOW_MS = 1000;
const MIN_RUNNING = 20;
// SketchPool のクロスフェード (400ms) と、その後の idle 化 (+50ms) が終わるまで待つ
const FADE_SETTLE_MS = 700;

// マッピングの captureStream が拾えるよう、毎フレーム canvas も塗り替える。
// リサイズでは、よくある作品と同じく予約済みのフレームを取り消して掛け直す
const sketchHtml = (marker) => `<!doctype html><html><body><p id="marker">${marker}</p><canvas width="320" height="180"></canvas><script>
  window.__frames = 0;
  const x = document.querySelector('canvas').getContext('2d');
  let id;
  function tick() { window.__frames++; x.fillStyle = 'hsl(' + (window.__frames * 7 % 360) + ' 80% 50%)'; x.fillRect(0, 0, 320, 180); id = requestAnimationFrame(tick); }
  tick();
  addEventListener('resize', () => { cancelAnimationFrame(id); id = requestAnimationFrame(tick); });
</script></body></html>`;
const catalog = [
  { id: 'a', title: 'A', path: 'sketches/a/index.html' },
  { id: 'b', title: 'B', path: 'sketches/b/index.html' },
  // ホスト版の Gist / OpenProcessing と同じ srcdoc 経路も通す
  { id: 'c', title: 'C', path: '', srcdoc: sketchHtml('c') },
  { id: 'd', title: 'D', path: 'sketches/d/index.html' },
].map(s => ({ description: '', type: 'html', tags: [], interactiveElements: [], lastModified: '2026-11-16', ...s }));

/** iframe ごとの { marker, visible, frames }。まだ読み込まれていない iframe は marker が null。 */
async function frames(page) {
  return page.evaluate(() => [...document.querySelectorAll('#slideshow-stage iframe.dc-sketch-frame')].map((f) => {
    const w = f.contentWindow;
    return { marker: w?.document.getElementById('marker')?.textContent ?? null, visible: f.classList.contains('dc-visible'), frames: w?.__frames ?? 0 };
  }));
}

/** WINDOW_MS のあいだに各作品の描画回数がいくつ進んだか（marker → { visible, delta }）。 */
async function measure(page, ms = WINDOW_MS) {
  const before = await frames(page);
  await page.waitForTimeout(ms);
  const after = await frames(page);
  const result = {};
  for (const a of after) {
    const b = before.find(x => x.marker === a.marker);
    if (a.marker && b) result[a.marker] = { visible: a.visible, delta: a.frames - b.frames };
  }
  return result;
}

/** 表示中が visibleMarker で、先読み側に hiddenMarker が読み込み済みになるまで待つ。 */
async function waitForPair(page, visibleMarker, hiddenMarker) {
  await page.waitForFunction(([v, h]) => {
    const fs = [...document.querySelectorAll('#slideshow-stage iframe.dc-sketch-frame')];
    const info = fs.map(f => ({ m: f.contentWindow?.document.getElementById('marker')?.textContent, vis: f.classList.contains('dc-visible') }));
    return info.some(i => i.m === v && i.vis) && info.some(i => i.m === h && !i.vis);
  }, [visibleMarker, hiddenMarker]);
}

async function snapshot(page, name) {
  if (artifactDir) await page.screenshot({ path: resolve(artifactDir, name + '.png') });
}

async function current(page) {
  return page.locator('#current-sketch-number').textContent();
}

/** 表示中の iframe に載っている作品の marker (読み込み前の iframe は null)。 */
async function visibleMarkers(page) {
  return (await frames(page)).filter(f => f.visible).map(f => f.marker);
}

/**
 * B を表示した直後、クロスフェードが終わる前に切替を重ねる (最後は d で、その応答は保留)。
 * steps は [B を表示してからの ms, 同時に押すボタン...] の並び。保留中は shownWhileHeld が表示されたままで、
 * 応答を返すと番号表示 (4) どおり d が表示されて動く (#208)。
 * ページ内のタイマーで押すので、テスト側の待ちが延びても間隔は変わらない。
 */
async function assertRapidSwitchEndsOnD({ page, held, release }, label, steps, shownWhileHeld) {
  await waitForPair(page, 'a', 'b');
  await page.evaluate((list) => {
    document.querySelector('#next-btn').click(); // b は先読み済みなので、ここで表示されてフェードが始まる
    for (const [at, ...ids] of list) setTimeout(() => { for (const id of ids) document.querySelector(id).click(); }, at);
  }, steps);
  await held; // d の読み込み要求が届いて保留されている
  // フェード完了 (400ms) と、その後の idle 化 (+50ms) をまたいで見る
  const deadline = Date.now() + FADE_SETTLE_MS;
  while (Date.now() < deadline) {
    const seen = await frames(page);
    assert.deepEqual(seen.filter(f => f.visible).map(f => f.marker), [shownWhileHeld],
      `${label}: d の応答を保留中に、表示中の作品が ${shownWhileHeld} から変わった (${JSON.stringify(seen)})`);
    await page.waitForTimeout(50);
  }
  assert.equal(await current(page), '4', `${label}: 保留中の番号表示`);
  release();
  await page.waitForFunction(() => [...document.querySelectorAll('#slideshow-stage iframe.dc-sketch-frame.dc-visible')]
    .some(f => f.contentWindow?.document.getElementById('marker')?.textContent === 'd'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(FADE_SETTLE_MS);
  assert.deepEqual(await visibleMarkers(page), ['d'], `${label}: 応答を返した後に表示中の作品 (${JSON.stringify(await frames(page))})`);
  assert.equal(await current(page), '4', `${label}: 応答を返した後の番号表示`);
  assertRunning(await measure(page), 'd', label);
}

function assertRunning(m, marker, label) {
  assert.ok(m[marker], `${label}: ${marker} が見つからない (${JSON.stringify(m)})`);
  assert.equal(m[marker].visible, true, `${label}: ${marker} が表示されていない (${JSON.stringify(m)})`);
  assert.ok(m[marker].delta >= MIN_RUNNING, `${label}: 表示中の ${marker} の描画が進まない (${JSON.stringify(m)})`);
}

function assertIdle(m, marker, label) {
  assert.ok(m[marker], `${label}: ${marker} が見つからない (${JSON.stringify(m)})`);
  assert.equal(m[marker].visible, false, `${label}: ${marker} が非表示でない (${JSON.stringify(m)})`);
  assert.equal(m[marker].delta, 0, `${label}: 非表示の ${marker} が待機中も描画している (${JSON.stringify(m)})`);
}

/** hold に渡した作品 (path 経路) の応答は、テストが release() を呼ぶまで返さない。 */
async function setup(browser, base, { hold = null, query = '' } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' });
  context.setDefaultTimeout(15_000);
  const errors = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  await context.route('**/sketches.json', (r) => r.fulfill({ json: catalog }));
  let release = null;
  const held = new Promise((arrived) => {
    context.route('**/sketches/*/index.html', (r) => {
      const id = new URL(r.request().url()).pathname.split('/').at(-2);
      const fulfill = () => r.fulfill({ contentType: 'text/html', body: sketchHtml(id) });
      if (id !== hold) return fulfill();
      release = fulfill;
      arrived();
    });
  });
  const page = await context.newPage();
  await page.goto(base.url + '/slideshow' + query);
  return { context, page, errors, held, release: () => release() };
}

const cases = {
  // 先読みの完了後、非表示の作品は描画を止め、表示中の作品だけが進む
  async idlePrefetch({ page }) {
    await waitForPair(page, 'a', 'b');
    await page.waitForTimeout(200); // 読み込み直後に予約済みだった 1 フレームを計測窓の外へ出す
    const m = await measure(page);
    assertRunning(m, 'a', '待機中');
    assertIdle(m, 'b', '待機中');
  },

  // Next で表示した先読み作品は描画を再開し、クロスフェード中は新旧の両方が進む。
  // フェード後は、表示を外れた側と新しく先読みした側 (srcdoc) が止まる。Previous でも同じ
  async switchResumes({ page, base }) {
    await waitForPair(page, 'a', 'b');
    await snapshot(page, `${base.name}-switch-0-before`);
    await page.locator('#next-btn').click();
    await page.waitForFunction(() => document.querySelector('#current-sketch-number').textContent === '2');
    await snapshot(page, `${base.name}-switch-1-just-after`);
    const fade = await measure(page, 200);
    assert.ok(fade.b?.visible && fade.b.delta > 0, `クロスフェード中: 表示した b が進まない (${JSON.stringify(fade)})`);
    assert.ok(fade.a?.delta > 0, `クロスフェード中: フェードアウト中の a が止まった (${JSON.stringify(fade)})`);
    await waitForPair(page, 'b', 'c');
    await page.waitForTimeout(FADE_SETTLE_MS);
    await snapshot(page, `${base.name}-switch-2-after-fade`);
    const next = await measure(page);
    assertRunning(next, 'b', 'Next 後');
    assertIdle(next, 'c', 'Next 後');

    await page.locator('#prev-btn').click();
    await page.waitForFunction(() => document.querySelector('#current-sketch-number').textContent === '1');
    await waitForPair(page, 'a', 'b');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const prev = await measure(page);
    assertRunning(prev, 'a', 'Previous 後');
    assertIdle(prev, 'b', 'Previous 後');
  },

  // 先読みの完了直前に Next を押しても、完了後に表示中の作品が止まらない
  async nextBeforePrefetchCompletes({ page, held, release }) {
    await held; // a の表示後、b の先読み要求が届いて保留されている
    await page.locator('#next-btn').click();
    assert.equal(await current(page), '2');
    release();
    await waitForPair(page, 'b', 'c');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const m = await measure(page);
    assertRunning(m, 'b', '先読み完了前の Next');
    assertIdle(m, 'c', '先読み完了前の Next');
  },

  // マッピング中も、出力 (captureStream) は切替の前後で表示中の作品のフレームを受け取り続ける
  async mappingStream({ page }) {
    await waitForPair(page, 'a', 'b');
    await page.locator('#mapping-btn').click();
    await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth > 0);
    const videoFrames = () => page.evaluate((ms) => new Promise((done) => {
      const v = document.querySelector('#source-video');
      let n = 0;
      const count = () => { n++; v.requestVideoFrameCallback(count); };
      v.requestVideoFrameCallback(count);
      setTimeout(() => done(n), ms);
    }), WINDOW_MS);
    assert.ok(await videoFrames() >= MIN_RUNNING, 'マッピング: 切替前の出力が途切れた');
    await page.locator('#next-btn').click();
    await waitForPair(page, 'b', 'c');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const n = await videoFrames();
    assert.ok(n >= MIN_RUNNING, `マッピング: Next 後の出力が途切れた (${n} frames / ${WINDOW_MS}ms)`);
    const m = await measure(page);
    assertRunning(m, 'b', 'マッピング中の Next');
    assertIdle(m, 'c', 'マッピング中の Next');
  },

  // srcdoc の作品も「先読み → 停止 → 表示 → 再開」と進む (b から始めて c を先読みさせる)
  async srcdocPrefetchResumes({ page }) {
    await waitForPair(page, 'b', 'c');
    await page.waitForTimeout(200);
    const idle = await measure(page);
    assertRunning(idle, 'b', 'srcdoc の先読み待機中');
    assertIdle(idle, 'c', 'srcdoc の先読み待機中');
    await page.locator('#next-btn').click();
    await page.waitForFunction(() => document.querySelector('#current-sketch-number').textContent === '3');
    await waitForPair(page, 'c', 'd');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const m = await measure(page);
    assertRunning(m, 'c', 'srcdoc の先読みを表示');
    assertIdle(m, 'd', 'srcdoc の先読みを表示');
  },

  // 待機中に作品がフレームを取り消して掛け直しても (リサイズ・全画面化)、表示後の描画ループは 1 本のまま
  async resizeWhilePaused({ page }) {
    await waitForPair(page, 'a', 'b');
    await page.waitForTimeout(200);
    const baseline = (await measure(page)).a.delta; // この環境の 1 本ぶんの描画回数
    for (const width of [1000, 1100, 1200]) {
      await page.setViewportSize({ width, height: 700 });
      await page.waitForTimeout(150);
    }
    await page.locator('#next-btn').click();
    await waitForPair(page, 'b', 'c');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const m = await measure(page);
    assertRunning(m, 'b', '待機中のリサイズ');
    assert.ok(m.b.delta <= baseline * 1.5,
      `待機中のリサイズ: 表示後の b の描画ループが多重化した (1 本ぶん ${baseline}, ${JSON.stringify(m)})`);
    assertIdle(m, 'c', '待機中のリサイズ');
  },

  // B を表示した直後に Next を 2 回押し、D の読み込みを保留する。後から来た先読みの完了や
  // 取り消された切替が、表示中の frame を止めない (どの作品が表示されるかはここでは見ない)
  async previewRaceKeepsVisibleRunning({ page, held, release }) {
    await waitForPair(page, 'a', 'b');
    await page.locator('#next-btn').click();
    await page.waitForFunction(() => document.querySelector('#current-sketch-number').textContent === '2');
    await page.waitForTimeout(50);
    await page.evaluate(() => { const next = document.querySelector('#next-btn'); next.click(); next.click(); });
    await held;
    await page.waitForTimeout(FADE_SETTLE_MS);
    release();
    await page.waitForTimeout(1500);
    const m = await measure(page);
    const visible = Object.entries(m).filter(([, f]) => f.visible);
    assert.ok(visible.length > 0, `競合後: 表示中の frame が無い (${JSON.stringify(m)})`);
    for (const [marker, f] of visible) {
      assert.ok(f.delta >= MIN_RUNNING, `競合後: 表示中の ${marker} が止まった (${JSON.stringify(m)})`);
    }
  },

  // 上と同じ手順で、表示される作品が番号表示と一致する。フェード完了のタイマーが、表示待ちの d が
  // 読み込み先に取った frame を idle に戻すと、保留していた c の先読みがそこへ載って表示されてしまう (#208)
  async rapidNextShowsNumberedSketch(env) {
    await assertRapidSwitchEndsOnD(env, 'Next を 2 回', [[50, '#next-btn', '#next-btn']], 'b');
  },

  // 続けて 4 回 (c → d → c → d)。同じ frame を取り直し続けても、最後の d が表示される
  async rapidFourSwitchesShowNumberedSketch(env) {
    await assertRapidSwitchEndsOnD(env, '続けて 4 回', [[50, '#next-btn', '#next-btn', '#prev-btn', '#next-btn']], 'b');
  },

  // Previous 方向。a へ戻った直後 (a は読み込み済みなのですぐ表示される) に d へ進むと、
  // d はフェード中の b の frame を読み込み先に取る
  async rapidPrevShowsNumberedSketch(env) {
    await assertRapidSwitchEndsOnD(env, 'Previous を 2 回', [[50, '#prev-btn'], [100, '#prev-btn']], 'a');
  },

  // a → b → a → b と戻って進むと、a の frame は 2 度フェードアウトする。1 度目のフェード完了のタイマーが
  // 2 度目のフェードの途中で frame を idle に戻すと、まだ見えている a が先読みの c に差し替わる
  async refadeKeepsFadingSketch({ page }) {
    await waitForPair(page, 'a', 'b');
    const gap = await page.evaluate(() => new Promise((done) => {
      const stage = document.querySelector('#slideshow-stage');
      const hiddenAt = new Map();
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.attributeName === 'class') {
            if (!r.target.classList.contains('dc-visible')) hiddenAt.set(r.target, performance.now());
          } else if (r.target.hasAttribute('srcdoc')) { // 先読みの c (srcdoc) が載った
            done(performance.now() - hiddenAt.get(r.target));
          }
        }
      }).observe(stage, { subtree: true, attributes: true, attributeFilter: ['class', 'srcdoc'] });
      document.querySelector('#next-btn').click();
      setTimeout(() => document.querySelector('#prev-btn').click(), 50);
      setTimeout(() => document.querySelector('#next-btn').click(), 350);
      setTimeout(() => done(null), 5000);
    }));
    assert.notEqual(gap, null, '戻って進む: c の先読みが始まらない');
    assert.ok(gap >= 400, `戻って進む: フェードアウトの途中 (${Math.round(gap)}ms) で frame が先読みに使われた`);
    await waitForPair(page, 'b', 'c');
    await page.waitForTimeout(FADE_SETTLE_MS);
    assert.equal(await current(page), '2');
    const m = await measure(page);
    assertRunning(m, 'b', '戻って進む');
    assertIdle(m, 'c', '戻って進む');
  },

  // 切替を連続で押しても、最後に表示した作品だけが進み、残りは止まる
  async rapidSwitch({ page }) {
    await waitForPair(page, 'a', 'b');
    await page.locator('#next-btn').click();
    await page.locator('#next-btn').click();
    await page.waitForFunction(() => document.querySelector('#current-sketch-number').textContent === '3');
    await waitForPair(page, 'c', 'd');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const m = await measure(page);
    assertRunning(m, 'c', '連続 Next');
    assertIdle(m, 'd', '連続 Next');
  },

  // 未読み込みの作品 (d) へ切り替え、その読み込み中に表示中の作品 (a) へ戻ると d の表示は取り消される。
  // 取り消された d は読み込み後も非表示のままなので、描画を止めて待つ
  async supersededShow({ page, held, release }) {
    await waitForPair(page, 'a', 'b');
    await page.locator('#prev-btn').click();
    await held; // d の読み込み要求が届いて保留されている
    await page.locator('#next-btn').click();
    assert.equal(await current(page), '1');
    release();
    await waitForPair(page, 'a', 'd');
    await page.waitForTimeout(FADE_SETTLE_MS);
    const m = await measure(page);
    assertRunning(m, 'a', '取り消された切替');
    assertIdle(m, 'd', '取り消された切替');
  },
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const config of ['vite.config.ts', 'apps/web/vite.config.ts']) {
    const hosted = config.startsWith('apps/'), name = hosted ? 'hosted' : 'gallery';
    if (process.env.SLIDESHOW_ENTRY && process.env.SLIDESHOW_ENTRY !== name) continue;
    const server = await createServer({ configFile: resolve(root, config), root: hosted ? resolve(root, 'apps/web') : root,
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: null, hmr: false }, logLevel: 'error' });
    try {
      await server.listen();
      const base = { name, url: `http://127.0.0.1:${server.httpServer.address().port}` };
      for (const [caseName, run] of Object.entries(cases)) {
        if (process.env.SLIDESHOW_CASE && process.env.SLIDESHOW_CASE !== caseName) continue;
        const env = await setup(browser, base, {
          hold: { nextBeforePrefetchCompletes: 'b', supersededShow: 'd', previewRaceKeepsVisibleRunning: 'd',
            rapidNextShowsNumberedSketch: 'd', rapidFourSwitchesShowNumberedSketch: 'd', rapidPrevShowsNumberedSketch: 'd' }[caseName] ?? null,
          query: caseName === 'srcdocPrefetchResumes' ? '?index=1' : '',
        });
        try {
          await run({ ...env, base });
          assert.deepEqual(env.errors, [], `${name}/${caseName}: browser errors`);
          console.log(`${name}/${caseName}: PASS`);
        } finally { await env.context.close(); }
      }
    } finally { await server.close(); }
  }
} finally { await browser.close(); }
