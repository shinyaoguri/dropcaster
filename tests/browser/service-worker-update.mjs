// 上演中に Service Worker の新しい版が届いても、操作画面を再読み込みせず出力ウィンドウを
// 閉じないこと、更新の通知は操作画面にだけ出ることを、viewer の本番ビルドで確かめる (#164)。
//
// SW の待機・有効化と Vite の遅延読み込み (vite:preloadError) は本番ビルドでしか本物にならないので、
// テストが OS の一時ディレクトリへビルドし、静的サーバで配信する。ビルドは 3 経路:
//   gallery      このリポジトリの vite.config.ts (ルート配信)
//   hosted       apps/web/vite.config.ts (ルート配信)
//   cli-subpath  利用者の `dropcaster build --base /sub/` (terser・manualChunks・サブパス配信)
// sw.js はテンプレート (generateServiceWorker) から版だけ変えて差し替え、registration.update() で
// 更新を起こす。作品は rAF で canvas を塗り替えるだけの fixture で、サーバが sketches.json と一緒に返す。
//
// 絞り込み: SW_UPDATE_ENTRY=gallery|hosted|cli-subpath、SW_UPDATE_CASE=<ケース名>。
// SW_UPDATE_ARTIFACT_DIR=<dir> で通知の表示を保存する (SW_UPDATE_LOCALE=ja-JP で日本語の表示)。
// 失敗したケースは、経過の記録 (createTrace) を FAIL の後ろに出す。SW_UPDATE_TRACE=1 で成功したケースも出す (#231)。
// SW_UPDATE_REPEAT=<n> で各ケースを n 回続けて実行する (不安定さの回数の記録用。既定 1)。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const REPEAT = Math.max(1, Number(process.env.SW_UPDATE_REPEAT) || 1);
const entryButton = '#open-windows-btn, #mapping-btn';
const notice = '#dc-update-notice';
// 会場ページの遅延チャンク。Vite 既定は name-hash.js、dropcaster build は name.hash.js
const VENUE_CHUNK = /^\/assets\/VenueCalibrationPage[-.]/;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/**
 * ケースの経過を、ケース開始からの ms を付けて貯める。待ちの後の検査やページ読み込みのタイムアウトで
 * 落ちたときに、何がいつ起きたかを追うための記録 (#231)。載せるのは、サーバが sw.js を返した時刻と版、
 * 操作画面の読み込み、SW の更新 (updatefound / statechange)、テストの節目、ケースを閉じる直前の状態。
 */
function createTrace() {
  const start = Date.now();
  const lines = [];
  return {
    add(what, at = Date.now()) { lines.push({ at, text: `  +${String(at - start).padStart(6)}ms ${what}` }); },
    // ページ側の出来事は起きた時刻で届く (届く順は前後する) ので、時刻で並べ直す
    text: () => lines.toSorted((a, b) => a.at - b.at).map(l => l.text).join('\n'),
  };
}
let trace = createTrace();
const swVersion = (source) => source.match(/const CACHE_VERSION = "([^"]*)"/)?.[1] ?? '?';

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

/**
 * basePath (例 '/sub') の下で dir を配信する。state.sw を sw.js として返し、state.blocked に当たる
 * パス (basePath を除いた形) は 404 にする (デプロイで消えた旧チャンク・取れなかったチャンク)。
 */
function startServer(dir, state, basePath) {
  const server = createServer(async (req, res) => {
    const full = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!full.startsWith(`${basePath}/`)) { res.writeHead(404).end(); return; }
    const pathname = full.slice(basePath.length);
    if (pathname === '/sw.js') {
      state.swFetches = (state.swFetches ?? 0) + 1;
      state.swFetchedAt = Date.now();
      trace.add(`server: sw.js を返す (${swVersion(state.sw)}、${state.swFetches} 回目)`);
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
  if (!server.listening) return Promise.resolve();
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
const hasWaiting = (page) => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
const CONTENT_CACHES = ['dropcaster-gist', 'dropcaster-local', 'dropcaster-op-cdn', 'dropcaster-op-meta', 'dropcaster-runtime'];
/** dropcaster-shell-* と、それ以外 (中身のバケット) に分ける。 */
async function bucketNames(page) {
  const names = (await cacheNames(page)).filter(n => n.startsWith('dropcaster-')).sort();
  return { shell: names.filter(n => n.startsWith('dropcaster-shell-')), content: names.filter(n => !n.startsWith('dropcaster-shell-')) };
}
/**
 * ページの URL・readyState と、SW の登録の状態・キャッシュ名。記録用なので、取れない項目は理由を入れて返す。
 * キャッシュは名前だけを見る (caches.open は、install の後始末が消したキャッシュを作り直してしまう)。
 */
const pageState = (page) => page.evaluate(async () => {
  const state = { readyState: document.readyState };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    Object.assign(state, {
      controller: navigator.serviceWorker.controller?.state ?? null,
      installing: reg?.installing?.state ?? null, waiting: reg?.waiting?.state ?? null, active: reg?.active?.state ?? null,
      caches: (await caches.keys()).sort(),
    });
  } catch (err) { state.sw = String(err); }
  return JSON.stringify(state);
});
const cachedIn = (page, bucket, url) => page.evaluate(async ([b, u]) => !!(await (await caches.open(b)).match(u)), [bucket, url]);

/** 新しい版を配信して update() し、その install が終わる (待機に入るか失敗する) まで待つ。 */
async function publishAndSettle(page, state, version) {
  state.sw = await swSource(version);
  const before = state.swFetches ?? 0;
  trace.add(`test: ${version} を配信して update() を呼ぶ`);
  await until(() => page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update().catch(() => {}); return true; }), 'registration.update()');
  await until(async () => (state.swFetches ?? 0) > before, `新しい版 ${version} の sw.js が取られる`);
  trace.add(`test: ${version} の update() が返り、sw.js が取られた`);
  await until(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration()).installing), `新しい版 ${version} の install が終わる`);
  trace.add(`test: installing が無い ${await pageState(page)}`);
  await sleep(SETTLE_MS);
  trace.add(`test: ${SETTLE_MS}ms 待った ${await pageState(page)}`);
}

/**
 * ブラウザは SW が制御するナビゲーション (操作画面と作品の iframe) の 1.5 秒ほど後に、自分でも sw.js を
 * 取りにいく (更新確認。ナビゲーションのたびに先へ延びる)。新しい版を配信した後にこれが来ると、
 * テストの update() とは別に、同じ版の install がもう 1 度走る (#231)。最後のナビゲーションの後の
 * この確認がサーバに届くまで待ち、旧版を配信している間に済ませる。
 */
async function settleBrowserUpdateCheck(context, state) {
  await until(() => (state.swFetchedAt ?? 0) > (lastNavigationAt.get(context) ?? Infinity), '最後のナビゲーションの後の、ブラウザ自身の更新確認');
  trace.add('test: 最後のナビゲーションの後の、ブラウザ自身の更新確認が済んだ');
}

/** 全ウィンドウを閉じて開き直し、version の shell だけが残る (= その版が有効になる) まで待つ。 */
async function reopenAfterClose(context, base, version) {
  for (const p of context.pages()) await p.close();
  const page = await context.newPage();
  await page.goto(base.url + '/');
  await until(async () => (await bucketNames(page)).shell.join() === `dropcaster-shell-${version}`, `全ウィンドウを閉じた後に ${version} が有効になる`);
  return page;
}

/** SPA の中で route へ移る (ページの読み込みを起こさない)。 */
function navigateInApp(page, base, route) {
  return page.evaluate((path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); },
    base.path + route);
}

/** 応答が終わっていないリクエスト (コンテキストごと)。値は出した時刻。 */
const pendingRequests = new WeakMap();
/** 最後のナビゲーション (操作画面と作品の iframe) のリクエストを出した時刻 (コンテキストごと)。 */
const lastNavigationAt = new WeakMap();

async function newContext(browser, options = {}) {
  const context = await browser.newContext({ locale: process.env.SW_UPDATE_LOCALE || 'en-US', viewport: { width: 1280, height: 800 }, ...options });
  context.setDefaultTimeout(TIMEOUT_MS);
  await context.exposeBinding('dcTrace', (_source, what, at) => trace.add(`page: ${what}`, at));
  // 操作画面の読み込み回数をタブごとに数える (作品の iframe と about:blank の出力ウィンドウは数えない)
  await context.addInitScript(() => {
    if (window.top !== window || !location.protocol.startsWith('http')) return;
    sessionStorage.setItem('dcLoads', String(Number(sessionStorage.getItem('dcLoads') || 0) + 1));
    // 経過の記録 (#231): このページが見た SW の更新。初回登録の install は ready より前なので載らない
    const say = (what) => { try { void window.dcTrace?.(what, Date.now())?.catch(() => {}); } catch { /* 記録だけなので捨てる */ } };
    void navigator.serviceWorker?.ready.then((reg) => {
      say(`SW ready ${location.pathname}`);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        say('SW updatefound');
        worker?.addEventListener('statechange', () => say(`SW statechange ${worker.state}`));
      });
    });
  });
  const errors = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('load', () => trace.add(`page: load ${p.url()}`));
  });
  const pending = new Map();
  pendingRequests.set(context, pending);
  context.on('request', (r) => {
    pending.set(r, Date.now());
    if (r.isNavigationRequest()) {
      lastNavigationAt.set(context, Date.now());
      trace.add(`request: ナビゲーション ${r.url()}`);
    }
  });
  context.on('requestfinished', (r) => pending.delete(r));
  context.on('requestfailed', (r) => { pending.delete(r); trace.add(`request: 失敗 ${r.url()} (${r.failure()?.errorText})`); });
  context.on('response', (res) => { if (res.status() >= 400) trace.add(`response: ${res.status()} ${res.url()}${res.request().serviceWorker() ? ' (SW から)' : ''}`); });
  return { context, errors };
}

/**
 * ケースを閉じる直前の、各ページの状態と応答が終わっていないリクエストを記録に足してから閉じる。
 * 失敗したケースは finally へ直行するので、失敗した時点の状態になる (#231)。
 */
async function closeContext(context) {
  for (const page of context.pages()) {
    const state = await Promise.race([pageState(page), sleep(2_000).then(() => '(2 秒待っても応答なし)')]).catch((err) => `(取れない: ${err.message})`);
    trace.add(`閉じる直前: ${page.url()} ${state}`);
  }
  const now = Date.now();
  for (const [request, since] of pendingRequests.get(context) ?? []) trace.add(`閉じる直前: 応答が終わっていない ${request.method()} ${request.url()} (${now - since}ms 前から)`);
  await context.close();
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
  // 出力とマッピングはアクティビティバーの別パネル (#228)。既定はマッピング。
  await page.locator('#dc-activity-outputs').click();
  await page.locator('#add-output-btn').click();
  await page.locator('#dc-activity-mappings').click();
  await page.locator('#add-mapping-btn').click();
  await page.locator('#dc-activity-outputs').click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#outputs-list .open-btn').first().click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0));
  return popup;
}

async function openVenue(page, base) {
  await navigateInApp(page, base, '/venue');
  await page.waitForSelector('#venue-canvas');
  await page.waitForFunction(() => !document.querySelector('#venue-model-pane')?.inert);
}

async function openVenueOutput(page, base) {
  await openVenue(page, base);
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
      const popup = await open(page, base);
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
    } finally { await closeContext(context); }
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
    } finally { await closeContext(context); }
  },

  // 全ウィンドウを閉じて開き直すと、新しい版の SW とキャッシュで動き、通知は出ない。
  // 開き直す時点で配信が止まっていても (オフライン)、新しい版のアプリ・作品カタログ・
  // 遅延読み込みの画面が開く (新しい版は旧版が開いている間に入り、閉じた時点で旧版のバケットを消すため)
  async applyAfterClose({ browser, base, state, server }) {
    const { context, errors } = await newContext(browser);
    try {
      const page = await openControlled(context, base, '/a');
      const popup = await openMappingOutput(page);
      await publishUpdate(page, state, 'v2');
      assert.deepEqual((await cacheNames(page)).filter(n => n.startsWith('dropcaster-shell-')).sort(),
        ['dropcaster-shell-v1', 'dropcaster-shell-v2'], '開いている間は旧版のキャッシュが残る (旧版の SW が有効のまま)');
      await popup.close();
      await page.close();

      await stopServer(server);
      const next = await context.newPage();
      await next.goto(base.url + '/');
      await until(async () => {
        const names = await cacheNames(next);
        return names.includes('dropcaster-shell-v2') && !names.some(n => n.endsWith('-v1'));
      }, '全ウィンドウを閉じた後に新しい版が有効になる');
      await next.waitForFunction(() => (document.querySelector('#app')?.innerHTML.length ?? 0) > 0, null, { timeout: 5_000 })
        .catch(() => {});
      assert.ok(await next.evaluate(() => document.querySelector('#app')?.innerHTML.length ?? 0) > 0,
        'オフラインで開き直したアプリが描画されない (新しい版のシェルの資産がキャッシュに無い)');
      const titles = await next.evaluate(async (url) => {
        const res = await fetch(url).catch(() => null);
        return res?.ok ? (await res.json()).map(s => s.title) : null;
      }, `${base.url}/sketches.json`);
      assert.deepEqual(titles, ['A', 'B'], 'オフラインで作品カタログ (sketches.json) が取れない');
      await sleep(SETTLE_MS);
      assert.equal(await loads(next), 1, '開き直したページが再読み込みされた');
      assert.equal(await next.locator(notice).isVisible(), false, '新しい版で開いたページに更新通知が出た');
      await openVenue(next, base);
      assert.deepEqual(errors, []);
    } finally { await closeContext(context); }
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
    } finally { await closeContext(context); }
  },

  // この修正より前の版のページは、新しい版が installed になると自動で SKIP_WAITING を送っていた。
  // 新しい版の SW はそれを受けて切り替わらない (切り替わると旧ページが再読み込みされ、出力が閉じる)
  async legacySkipWaiting({ browser, base, state }) {
    const { context, errors } = await newContext(browser);
    try {
      const page = await openControlled(context, base, '/a');
      await publishUpdate(page, state, 'v2');
      const before = await loads(page);
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: 'SKIP_WAITING' }));
      await sleep(SETTLE_MS);
      assert.equal(await hasWaiting(page), true, '旧版のページからの SKIP_WAITING で新しい版に切り替わった');
      assert.ok((await cacheNames(page)).includes('dropcaster-shell-v1'), '旧版のキャッシュが消えた');
      assert.equal(await loads(page), before, '操作画面が再読み込みされた');
      assert.equal(await page.locator(notice).getAttribute('data-state'), 'update', '通知の種類が変わった');
      assert.deepEqual(errors, []);
    } finally { await closeContext(context); }
  },

  // 新しい版の install 中にシェルの資産が 1 つでも取れなければ、新しい版は待機に入らず旧版のまま動く。
  // 取れるようになれば、次の更新確認でやり直して待機に入る
  async installFailureKeepsOld({ browser, base, state }) {
    const { context, errors } = await newContext(browser);
    try {
      const page = await openControlled(context, base, '/a');
      const before = await loads(page);
      // 失敗する install はやり直しの対象になる (待機中の同じ版が無いので、ブラウザ自身の更新確認でも
      // install が走る)。その install が下の検査の最中に重ならないよう、先に済ませる。成功する install の
      // ケースでは、更新確認は待機中の版と比べる (Service Worker 仕様の Update) ので 2 度目の install は起きない
      await settleBrowserUpdateCheck(context, state);
      state.blocked = VENUE_CHUNK;
      await publishAndSettle(page, state, 'v2');
      assert.equal(await hasWaiting(page), false, '資産が取れないまま新しい版が待機に入った');
      assert.deepEqual((await bucketNames(page)).shell, ['dropcaster-shell-v1'], '失敗した install の shell が残った / 旧版の shell が消えた');
      assert.equal(await page.locator(notice).count(), 0, '待機していないのに更新通知が出た');
      assert.equal(await loads(page), before, '操作画面が再読み込みされた');
      state.blocked = null;
      await publishAndSettle(page, state, 'v2');
      assert.equal(await hasWaiting(page), true, '資産が取れるようになっても新しい版が待機に入らない');
      assert.ok(await cachedIn(page, 'dropcaster-shell-v2', `${base.url}/`), '新しい版の shell にシェル HTML が無い');
      // アイコンは任意: 配信されていれば事前キャッシュし、無くても (cli-subpath は public/ が空) install は通る
      const icon = `${base.url}/icon.svg`;
      const iconRes = await fetch(icon); // テストのサーバは無いファイルに SPA fallback の HTML を返す
      const iconServed = iconRes.ok && !iconRes.headers.get('content-type').includes('text/html');
      assert.equal(await cachedIn(page, 'dropcaster-shell-v2', icon), iconServed, `アイコン (配信 ${iconServed}) の事前キャッシュ`);
      assert.deepEqual(errors, []);
    } finally { await closeContext(context); }
  },

  // 中身のバケットは版を持たず、2 回更新しても 1 組だけで中身が引き継がれる。入れ替わるのは shell だけ。
  // 版を持っていたころのバケットは 1 回だけ移して消し、runtime のサブパスの assets/ は移さない
  async contentCachesStable({ browser, base, state }) {
    const { context, errors } = await newContext(browser);
    try {
      let page = await openControlled(context, base, '/a');
      await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('canvas'));
      // local に置くのは作品のファイル。作品でも作品カタログでもないものは、有効化のときに runtime へ移る (#179)
      const legacy = { kept: `${base.url}/legacy-runtime.txt`, asset: `${base.url}/assets/legacy-old.js`, local: `${base.url}/sketches/legacy/data.json` };
      await page.evaluate(async ({ kept, asset, local }) => {
        await (await caches.open('dropcaster-runtime-old')).put(kept, new Response('kept'));
        await (await caches.open('dropcaster-runtime-old')).put(asset, new Response('old asset'));
        await (await caches.open('dropcaster-local-old')).put(local, new Response('[]'));
      }, legacy);
      const sketch = `${base.url}/sketches/a/index.html`;
      for (const version of ['v2', 'v3']) {
        await publishAndSettle(page, state, version);
        page = await reopenAfterClose(context, base, version);
        const buckets = await bucketNames(page);
        assert.deepEqual(buckets.shell, [`dropcaster-shell-${version}`], `${version}: shell が入れ替わらない`);
        assert.ok(buckets.content.every(n => CONTENT_CACHES.includes(n)) && buckets.content.includes('dropcaster-local')
          && buckets.content.includes('dropcaster-runtime'), `${version}: 中身のバケットが 1 組でない: ${buckets.content.join(', ')}`);
        assert.ok(await cachedIn(page, 'dropcaster-local', sketch), `${version}: v1 のときに取った作品が引き継がれない`);
        assert.ok(await cachedIn(page, 'dropcaster-runtime', legacy.kept), `${version}: 版を持っていたころの runtime の中身が移らない`);
        assert.ok(await cachedIn(page, 'dropcaster-local', legacy.local), `${version}: 版を持っていたころの local の中身が移らない`);
        assert.equal(await cachedIn(page, 'dropcaster-runtime', legacy.asset), false, `${version}: runtime の assets/ が移った`);
      }
      assert.deepEqual(errors, []);
    } finally { await closeContext(context); }
  },

  // 会場ページの遅延チャンクが取れない (SW が無い環境で、デプロイで消えた) ときは、
  // 自動で再読み込みせず、原因を断定せずに再読み込みを案内する。SW があれば install が
  // 遅延チャンクまで事前キャッシュするので、この失敗は SW の無い環境 (enablePwa: false・
  // secure context でない) でだけ起きる
  async lazyChunkMissing({ browser, base, state }) {
    const { context } = await newContext(browser, { serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(base.url + '/');
      await page.waitForFunction(() => (document.querySelector('#app')?.innerHTML.length ?? 0) > 0);
      state.blocked = VENUE_CHUNK;
      const before = await loads(page);
      await navigateInApp(page, base, '/venue');
      await page.waitForSelector(`${notice}[data-state]`);
      await sleep(SETTLE_MS);
      assert.equal(await loads(page), before, '遅延読み込みの失敗で自動的に再読み込みした');
      await assertNoticeOnlyInControl(page, null, 'loadFailed', '遅延読み込みの失敗後');
      await snapshot(page, `${base.name}-reload-notice`);
      state.blocked = null;
      await page.locator(`${notice} button[data-action="reload"]`).click();
      await until(async () => await loads(page) === before + 1, '案内のボタンで再読み込みする');
      await page.waitForSelector('#venue-canvas');
    } finally { await closeContext(context); }
  },

  // オフラインで遅延チャンクが取れないときは、新しい版ではなく接続を確かめるよう案内する
  async lazyChunkOffline({ browser, base, state }) {
    const { context } = await newContext(browser, { serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.goto(base.url + '/');
      await page.waitForFunction(() => (document.querySelector('#app')?.innerHTML.length ?? 0) > 0);
      const before = await loads(page);
      await context.setOffline(true);
      await navigateInApp(page, base, '/venue');
      await page.waitForSelector(`${notice}[data-state]`);
      await sleep(SETTLE_MS);
      assert.equal(await loads(page), before, 'オフラインの遅延読み込みの失敗で自動的に再読み込みした');
      await assertNoticeOnlyInControl(page, null, 'offline', 'オフラインの遅延読み込みの失敗後');
      await snapshot(page, `${base.name}-offline-notice`);
      await context.setOffline(false);
      state.blocked = null;
      await page.locator(`${notice} button[data-action="reload"]`).click();
      await until(async () => await loads(page) === before + 1, '案内のボタンで再読み込みする');
      await page.waitForSelector('#venue-canvas');
    } finally { await closeContext(context); }
  },
};

/** 利用者の `dropcaster build` で /sub/ 配信用にビルドする。 */
async function buildWithCli(outDir) {
  const gallery = await mkdtemp(join(tmpdir(), 'dc-sw-update-gallery-'));
  try {
    await mkdir(join(gallery, 'public'));
    await writeFile(join(gallery, 'dropcaster.config.js'), 'export default {};\n');
    const run = spawnSync(process.execPath, [resolve(root, 'src/cli/index.js'), 'build', '--base', '/sub/', '--output', outDir], {
      cwd: gallery, encoding: 'utf-8', env: { ...process.env, DROPCASTER_LANG: 'en' },
    });
    assert.equal(run.status, 0, `dropcaster build failed: ${run.stderr}`);
  } finally { await rm(gallery, { recursive: true, force: true }); }
}

const entries = [
  { name: 'gallery', basePath: '', build: (outDir) => build({ configFile: resolve(root, 'vite.config.ts'), root, logLevel: 'error', build: { outDir, emptyOutDir: true } }) },
  { name: 'hosted', basePath: '', build: (outDir) => build({ configFile: resolve(root, 'apps/web/vite.config.ts'), root: resolve(root, 'apps/web'), logLevel: 'error', build: { outDir, emptyOutDir: true } }) },
  { name: 'cli-subpath', basePath: '/sub', build: buildWithCli },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
const failures = [];
let passes = 0;
try {
  for (const entry of entries) {
    if (process.env.SW_UPDATE_ENTRY && process.env.SW_UPDATE_ENTRY !== entry.name) continue;
    const outDir = await mkdtemp(join(tmpdir(), `dc-sw-update-${entry.name}-`));
    try {
      await entry.build(outDir);
      for (const [caseName, run] of Object.entries(cases).flatMap(c => Array(REPEAT).fill(c))) {
        if (process.env.SW_UPDATE_CASE && process.env.SW_UPDATE_CASE !== caseName) continue;
        const state = { sw: await swSource('v1'), blocked: null };
        const server = await startServer(outDir, state, entry.basePath);
        const base = { name: entry.name, path: entry.basePath, url: `http://127.0.0.1:${server.address().port}${entry.basePath}` };
        trace = createTrace();
        try {
          await run({ browser, base, state, server });
          passes++;
          console.log(`${entry.name}/${caseName}: PASS`);
          if (process.env.SW_UPDATE_TRACE) console.log(trace.text());
        } catch (err) {
          failures.push(`${entry.name}/${caseName}`);
          console.error(`${entry.name}/${caseName}: FAIL\n${err.stack}\n経過 (ケース開始からの時間):\n${trace.text()}`);
        } finally { await stopServer(server); }
      }
    } finally { await rm(outDir, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
console.log(`${passes} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(`failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
