// 上演中に Service Worker の新しい版が届いても、操作画面を再読み込みせず出力ウィンドウを
// 閉じないこと、更新の通知は操作画面にだけ出ることを、両 viewer エントリの本番ビルドで確かめる (#164)。
//
// SW の待機・有効化と Vite の遅延読み込み (vite:preloadError) は本番ビルドでしか本物にならないので、
// テストが両エントリを OS の一時ディレクトリへビルドし、静的サーバで配信する。sw.js はテンプレート
// (generateServiceWorker) から版だけ変えて差し替え、registration.update() で更新を起こす。
// 作品は rAF で canvas を塗り替えるだけの fixture で、サーバが sketches.json と一緒に返す。
//
// 絞り込み: SW_UPDATE_ENTRY=gallery|hosted、SW_UPDATE_CASE=<ケース名>。
// SW_UPDATE_ARTIFACT_DIR=<dir> で通知の表示を保存する (SW_UPDATE_LOCALE=ja-JP で日本語の表示)。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';
import { generateServiceWorker } from '../../src/cli/utils/service-worker.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifactDir = process.env.SW_UPDATE_ARTIFACT_DIR;
if (artifactDir) await mkdir(artifactDir, { recursive: true });
const TIMEOUT_MS = 20_000;
// 自動の再読み込みや出力の close が起きうる間だけ待つ (正しければ何も起きずに待ち切る)
const SETTLE_MS = 1_500;
const entryButton = '#open-windows-btn, #mapping-btn';
const notice = '#dc-update-notice';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const sketchHtml = (id) => `<!doctype html><html><body style="margin:0"><p id="marker" hidden>${id}</p><canvas width="640" height="360"></canvas><script>
  const x = document.querySelector('canvas').getContext('2d'); let n = 0;
  function tick() { n++; x.fillStyle = 'hsl(' + (n * 5 % 360) + ' 70% 50%)'; x.fillRect(0, 0, 640, 360); requestAnimationFrame(tick); }
  tick();
</script></body></html>`;
const catalog = [
  { id: 'a', title: 'A', path: 'sketches/a/index.html' },
  { id: 'b', title: 'B', path: 'sketches/b/index.html' },
].map(s => ({ description: '', type: 'html', tags: [], interactiveElements: [], lastModified: '2026-11-16', ...s }));

async function swSource(version) {
  const dir = await mkdtemp(join(tmpdir(), 'dc-sw-update-src-'));
  try {
    await generateServiceWorker(dir, { cacheVersion: version });
    return await readFile(join(dir, 'sw.js'), 'utf-8');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** state.sw を sw.js として返し、state.blocked に当たるパスは 404 にする (デプロイで消えた旧チャンク)。 */
function startServer(dir, state) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/sw.js') {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-cache' }).end(state.sw);
      return;
    }
    if (pathname === '/sketches.json') { res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'] }).end(JSON.stringify(catalog)); return; }
    const sketch = pathname.match(/^\/sketches\/([^/]+)\/(?:index\.html)?$/);
    if (sketch) { res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] }).end(sketchHtml(sketch[1])); return; }
    if (state.blocked?.test(pathname)) { res.writeHead(404).end(); return; }
    const file = normalize(join(dir, pathname));
    if (file.startsWith(dir) && extname(pathname)) {
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream' }).end(body);
        return;
      } catch { /* SPA fallback へ */ }
    }
    if (pathname.startsWith('/assets/')) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] }).end(await readFile(join(dir, 'index.html')));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

function stopServer(server) {
  server.closeAllConnections();
  return new Promise((done) => server.close(() => done()));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 再読み込みで実行コンテキストが消えても失敗にせず、条件が成り立つまで Node 側から問い合わせる。 */
async function until(fn, label, timeout = TIMEOUT_MS) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { if (await fn()) return; } catch (err) { last = err; }
    if (Date.now() > end) throw new Error(`timeout: ${label}${last ? ` (${last.message})` : ''}`);
    await sleep(100);
  }
}

const loads = (page) => page.evaluate(() => Number(sessionStorage.getItem('dcLoads') || 0));
const cacheNames = (page) => page.evaluate(() => caches.keys());
const hasController = (page) => page.evaluate(() => navigator.serviceWorker.controller !== null);

async function newContext(browser) {
  const context = await browser.newContext({ locale: process.env.SW_UPDATE_LOCALE || 'en-US', viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(TIMEOUT_MS);
  // 操作画面の読み込み回数をタブごとに数える (作品の iframe と about:blank の出力ウィンドウは数えない)
  await context.addInitScript(() => {
    if (window.top !== window || !location.protocol.startsWith('http')) return;
    sessionStorage.setItem('dcLoads', String(Number(sessionStorage.getItem('dcLoads') || 0) + 1));
  });
  const errors = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  return { context, errors };
}

/** 初回訪問で SW の制御を得てから (初回登録の切替が終わるまで待って) path を開き直す。 */
async function openControlled(context, base, path) {
  const page = await context.newPage();
  await page.goto(base.url + '/');
  await until(() => hasController(page), 'SW が初回訪問のページを制御する');
  await sleep(SETTLE_MS);
  if (path !== '/') await page.goto(base.url + path);
  return page;
}

async function publishUpdate(page, state, version) {
  state.sw = await swSource(version);
  await until(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
    return true;
  }), 'registration.update()');
  await until(() => page.evaluate((v) => caches.has(`dropcaster-shell-${v}`), version), `新しい版 ${version} がインストールされる`);
  await sleep(SETTLE_MS);
}

async function openMappingOutput(page) {
  await page.locator(entryButton).click();
  await page.waitForFunction(() => document.querySelector('#source-video')?.videoWidth > 0);
  await page.locator('#add-output-btn').click();
  await page.locator('#add-mapping-btn').click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#outputs-list .open-btn').first().click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0));
  return popup;
}

async function openVenueOutput(page) {
  await page.evaluate(() => { history.pushState({}, '', '/venue'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('#venue-canvas');
  await page.waitForFunction(() => !document.querySelector('#venue-model-pane')?.inert);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#venue-open-output').click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  return popup;
}

/** 出力ウィンドウが開いたまま、映像の再生位置が進み続けていること。 */
async function assertOutputLive(popup, label) {
  assert.equal(popup.isClosed(), false, `${label}: 出力ウィンドウが閉じた`);
  const time = () => popup.evaluate(() => Math.max(...[...document.querySelectorAll('video')].map(v => v.currentTime)));
  const before = await time();
  await sleep(500);
  assert.ok(await time() > before, `${label}: 出力ウィンドウの映像が止まった`);
}

async function assertNoticeOnlyInControl(page, popup, state, label) {
  assert.equal(await page.locator(notice).isVisible(), true, `${label}: 操作画面に更新通知が出ない`);
  assert.equal(await page.locator(notice).getAttribute('data-state'), state, `${label}: 通知の種類が違う`);
  if (popup) assert.equal(await popup.locator(notice).count(), 0, `${label}: 出力ウィンドウに更新通知が出た`);
}

async function snapshot(page, name) {
  if (artifactDir) await page.screenshot({ path: resolve(artifactDir, `${name}.png`) });
}

/** 出力を開いたまま新しい版を配信し、操作画面の load が増えず出力も映り続けることを見る。 */
function keepsShow(path, open) {
  return async ({ browser, base, state }) => {
    const { context, errors } = await newContext(browser);
    try {
      const page = await openControlled(context, base, path);
      const popup = await open(page);
      const before = await loads(page);
      // 自動の再読み込みに保存待ちの離脱確認 (#168) が出ないこと (#164 の関連事象)
      const dialogs = [];
      page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss(); });
      await publishUpdate(page, state, 'v2');
      assert.deepEqual(dialogs, [], '新しい版の配信で操作画面にダイアログが出た');
      assert.equal(await loads(page), before, '新しい版の配信で操作画面が再読み込みされた');
      await assertOutputLive(popup, '新しい版の配信後');
      await assertNoticeOnlyInControl(page, popup, 'update', '新しい版の配信後');
      await snapshot(page, `${base.name}${path.replaceAll('/', '-')}-update-notice`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  };
}

const cases = {
  sketchPage: keepsShow('/a', openMappingOutput),
  slideshow: keepsShow('/slideshow', async (page) => {
    await page.locator('#play-pause-btn').click();
    return openMappingOutput(page);
  }),
  venue: keepsShow('/', openVenueOutput),

  // SW 未登録の初回訪問: 初回の登録・有効化でページを再読み込みせず、通知も出さない
  async firstVisit({ browser, base }) {
    const { context, errors } = await newContext(browser);
    try {
      const page = await context.newPage();
      await page.goto(base.url + '/a');
      await until(() => hasController(page), 'SW が初回訪問のページを制御する');
      await sleep(SETTLE_MS);
      assert.equal(await loads(page), 1, '初回訪問のページが自動で再読み込みされた');
      assert.equal(await page.locator(notice).isVisible(), false, '初回訪問で更新通知が出た');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  },

  // 全ウィンドウを閉じて開き直すと、新しい版の SW とキャッシュで動き、通知は出ない
  async applyAfterClose({ browser, base, state }) {
    const { context, errors } = await newContext(browser);
    try {
      const page = await openControlled(context, base, '/a');
      const popup = await openMappingOutput(page);
      await publishUpdate(page, state, 'v2');
      assert.deepEqual((await cacheNames(page)).filter(n => n.startsWith('dropcaster-shell-')).sort(),
        ['dropcaster-shell-v1', 'dropcaster-shell-v2'], '開いている間は旧版のキャッシュが残る (旧版の SW が有効のまま)');
      await popup.close();
      await page.close();
      const next = await context.newPage();
      await next.goto(base.url + '/a');
      await until(async () => {
        const names = await cacheNames(next);
        return names.includes('dropcaster-shell-v2') && !names.some(n => n.endsWith('-v1'));
      }, '全ウィンドウを閉じた後に新しい版が有効になる');
      await sleep(SETTLE_MS);
      assert.equal(await loads(next), 1, '開き直したページが再読み込みされた');
      assert.equal(await next.locator(notice).isVisible(), false, '新しい版で開いたページに更新通知が出た');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  },

  // 通知のボタンを押したときだけ、新しい版を有効にして 1 度だけ再読み込みする
  async applyByClick({ browser, base, state }) {
    const { context, errors } = await newContext(browser);
    try {
      const page = await openControlled(context, base, '/a');
      await publishUpdate(page, state, 'v2');
      const before = await loads(page);
      await page.locator(`${notice} button[data-action="reload"]`).click();
      await until(async () => await loads(page) === before + 1, '通知のボタンで再読み込みする');
      await until(async () => !(await cacheNames(page)).some(n => n.endsWith('-v1')), '押した後は新しい版が有効になる');
      await sleep(SETTLE_MS);
      assert.equal(await loads(page), before + 1, '再読み込みが 1 度で止まらない');
      assert.equal(await page.locator(notice).isVisible(), false, '適用後も更新通知が残った');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  },

  // デプロイで旧版の遅延チャンクが消えた後に会場ページを開くと、自動で再読み込みせず案内を出す
  async lazyChunkMissing({ browser, base, state }) {
    const { context } = await newContext(browser);
    try {
      const page = await openControlled(context, base, '/');
      state.blocked = /^\/assets\/VenueCalibrationPage-/;
      const before = await loads(page);
      await page.evaluate(() => { history.pushState({}, '', '/venue'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.waitForSelector(`${notice}[data-state="reload"]`);
      await sleep(SETTLE_MS);
      assert.equal(await loads(page), before, '遅延読み込みの失敗で自動的に再読み込みした');
      await assertNoticeOnlyInControl(page, null, 'reload', '遅延読み込みの失敗後');
      await snapshot(page, `${base.name}-reload-notice`);
      state.blocked = null;
      await page.locator(`${notice} button[data-action="reload"]`).click();
      await until(async () => await loads(page) === before + 1, '案内のボタンで再読み込みする');
      await page.waitForSelector('#venue-canvas');
    } finally { await context.close(); }
  },
};

const entries = [
  { name: 'gallery', config: 'vite.config.ts', root },
  { name: 'hosted', config: 'apps/web/vite.config.ts', root: resolve(root, 'apps/web') },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
const failures = [];
try {
  for (const entry of entries) {
    if (process.env.SW_UPDATE_ENTRY && process.env.SW_UPDATE_ENTRY !== entry.name) continue;
    const outDir = await mkdtemp(join(tmpdir(), `dc-sw-update-${entry.name}-`));
    try {
      await build({ configFile: resolve(root, entry.config), root: entry.root, logLevel: 'error',
        build: { outDir, emptyOutDir: true } });
      for (const [caseName, run] of Object.entries(cases)) {
        if (process.env.SW_UPDATE_CASE && process.env.SW_UPDATE_CASE !== caseName) continue;
        const state = { sw: await swSource('v1'), blocked: null };
        const server = await startServer(outDir, state);
        const base = { name: entry.name, url: `http://127.0.0.1:${server.address().port}` };
        try {
          await run({ browser, base, state });
          console.log(`${entry.name}/${caseName}: PASS`);
        } catch (err) {
          failures.push(`${entry.name}/${caseName}`);
          console.error(`${entry.name}/${caseName}: FAIL\n${err.stack}`);
        } finally { await stopServer(server); }
      }
    } finally { await rm(outDir, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
if (failures.length) {
  console.error(`failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
