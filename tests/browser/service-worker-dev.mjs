// dev サーバでは Service Worker を使わないこと (#180) を、実際の dev サーバと実 Chromium で確かめる。
//
// dev サーバは 3 経路:
//   cli      利用者の `dropcaster dev` (一時ギャラリーを cwd にして CLI を起動する)
//   gallery  このリポジトリの vite.config.ts (`npm run dev`)
//   hosted   apps/web/vite.config.ts (`npm run dev:web`)
// どの経路でも、作品 (index.html と sketch.js) を書き換えて 1 回再読み込みすれば新しい内容が出ること、
// SW が登録されないこと、以前の版の dev が同じオリジンに残した SW とキャッシュがあっても同じであることを見る。
// あわせて `dropcaster build` + `dropcaster preview` (localhost) では今までどおり登録されることを見る (cli-preview)。
//
// 「以前の版の dev が残した SW」は、同じポートで先に静的サーバを立て、テンプレートの sw.js を登録して
// 作品と viewer のエントリをキャッシュさせて作る (以前の版の dev そのものは起動しない)。残った SW は
// viewer のモジュールをキャッシュから返すので、dev サーバで開いた最初の読み込みでは古いエントリが動き、
// いまの viewer のコードは動かない。古いエントリは応答の返らない要求を 1 つ出し、残った SW を処理中のままにする
// (実際の viewer でも、外部のスタイルシートが返らない環境で同じことが起きた)。
//
// 絞り込み: SW_DEV_ENTRY=cli|gallery|hosted|cli-preview、SW_DEV_CASE=<ケース名>。
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';
import { generateServiceWorker } from '../../src/cli/utils/service-worker.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = resolve(root, 'src/cli/index.js');
const TIMEOUT_MS = 30_000;
// SW の登録・有効化や、それによる再読み込みが起きうる間だけ待つ (正しければ何も起きずに待ち切る)
const SETTLE_MS = 1_500;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

const catalog = [{ id: 'a', title: 'A', path: 'sketches/a/index.html' }]
  .map(s => ({ description: '', type: 'html', tags: [], interactiveElements: [], lastModified: '2026-11-24', ...s }));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(fn, label, timeout = TIMEOUT_MS) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { if (await fn()) return; } catch (err) { last = err; }
    if (Date.now() > end) throw new Error(`timeout: ${label}${last ? ` (${last.message})` : ''}`);
    await sleep(100);
  }
}

/** 空いているポートを 1 つ得る (同じポートで「以前の版」と dev サーバを順に立てるので、先に決める)。 */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createHttpServer();
    probe.once('error', fail);
    probe.listen(0, 'localhost', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

// --- 作品の fixture -----------------------------------------------------------

let version = 0;
/**
 * 作品 A の index.html と sketch.js を新しい版に書き換え、表示されるはずのマーカーを返す。
 * マーカーは HTML の版と JS の版を並べたもので、どちらか一方だけ古くても分かる。
 */
async function editSketch(publicDir) {
  version += 1;
  const dir = join(publicDir, 'sketches', 'a');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'),
    `<!doctype html><html><body><p id="marker" data-html="h${version}"></p><script src="sketch.js"></script></body></html>\n`);
  await writeFile(join(dir, 'sketch.js'),
    `const m = document.querySelector('#marker'); m.dataset.js = 'j${version}'; m.textContent = m.dataset.html + '/' + m.dataset.js;\n`);
  return `h${version}/j${version}`;
}

/** 一時ギャラリー (dropcaster.config.js と public/) を作る。staticFrom の配布用の静的ファイルも置く。 */
async function createGallery(staticFrom) {
  const dir = await mkdtemp(join(tmpdir(), 'dc-sw-dev-gallery-'));
  const publicDir = join(dir, 'public');
  await mkdir(publicDir);
  await writeFile(join(dir, 'dropcaster.config.js'), 'export default {};\n');
  await writeFile(join(publicDir, 'sketches.json'), JSON.stringify(catalog));
  if (staticFrom) {
    // このリポジトリの public/ にはテンプレートと同期した本物の sw.js が置いてある
    for (const file of ['sw.js', 'manifest.json', 'icon.svg']) await copyFile(join(staticFrom, file), join(publicDir, file));
  } else {
    // 利用者のギャラリーには、以前の版の dev が書いた sw.js が残っている
    await generateServiceWorker(publicDir, { cacheVersion: 'dev-left-in-public' });
  }
  return { dir, publicDir };
}

// --- サーバ -------------------------------------------------------------------

function spawnCli(args, cwd) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, DROPCASTER_LANG: 'en' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((done) => child.once('exit', done));
  return {
    output: () => output,
    exited: () => child.exitCode !== null || child.signalCode !== null,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        await exited;
        clearTimeout(timer);
      }
    },
  };
}

async function waitForHttp(url, proc) {
  await until(async () => {
    if (proc?.exited()) throw new Error(`server exited: ${proc.output()}`);
    return (await fetch(url)).ok;
  }, `${url} が応答する`);
}

async function startCliDev(gallery, port) {
  const proc = spawnCli(['dev', '--port', String(port)], gallery.dir);
  try {
    await waitForHttp(`http://localhost:${port}/`, proc);
  } catch (err) {
    await proc.stop();
    throw new Error(`dropcaster dev が起動しない: ${err.message}\n${proc.output()}`);
  }
  return proc;
}

function startVite(config, viteRoot) {
  return async (gallery, port) => {
    const server = await createViteServer({
      configFile: resolve(root, config), root: viteRoot, publicDir: gallery.publicDir, logLevel: 'error',
      server: { host: 'localhost', port, strictPort: true, open: false, watch: null, hmr: false },
    });
    await server.listen();
    return { stop: () => server.close() };
  };
}

/** 接続は受けるが応答を返さないサーバ。 */
function startHangingServer() {
  const server = createHttpServer(() => {});
  return new Promise((done) => server.listen(0, 'localhost', () => done(server)));
}

/**
 * 以前の版の dev の代わりになる静的サーバ。テンプレートの sw.js、作品、viewer のエントリを返す。
 * エントリは、このサーバのページ (#legacy がある) では SW を登録し、それ以外 (後で同じポートに立つ
 * dev サーバのページ) では hangUrl を取りにいく。
 */
function startLegacyServer(gallery, port, entry, sw, hangUrl) {
  const page = `<!doctype html><html><body><p id="legacy">legacy</p><script type="module" src="${entry.entryModule}"></script></body></html>`;
  const server = createHttpServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/sw.js') { res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-cache' }).end(sw); return; }
    if (pathname === entry.entryModule) {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.js'] }).end(`document.documentElement.dataset.legacyViewer = 'ran';
if (document.querySelector('#legacy')) navigator.serviceWorker.register('/sw.js');
else fetch(${JSON.stringify(hangUrl)}, { mode: 'no-cors' }).catch(() => {});
`);
      return;
    }
    const file = normalize(join(gallery.publicDir, pathname));
    if (file.startsWith(gallery.publicDir) && extname(pathname)) {
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream' }).end(body);
      } catch { res.writeHead(404).end(); }
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] }).end(page);
  });
  return new Promise((done) => server.listen(port, 'localhost', () => done(server)));
}

function stopHttpServer(server) {
  server.closeAllConnections();
  return new Promise((done) => server.close(() => done()));
}

// --- ブラウザ -----------------------------------------------------------------

async function newContext(browser) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(TIMEOUT_MS);
  // 操作画面の読み込み回数と、ページが SW の登録を頼んだ回数をタブごとに数える (作品の iframe は数えない)
  await context.addInitScript(() => {
    if (window.top !== window || !location.protocol.startsWith('http')) return;
    const bump = (key) => sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || 0) + 1));
    bump('dcLoads');
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (...args) {
      bump('dcRegisterCalls');
      return register.apply(this, args);
    };
  });
  return context;
}

const loads = (page) => page.evaluate(() => Number(sessionStorage.getItem('dcLoads') || 0));
const registerCalls = (page) => page.evaluate(() => Number(sessionStorage.getItem('dcRegisterCalls') || 0));
const registrations = (page) => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname));
const hasController = (page) => page.evaluate(() => navigator.serviceWorker.controller !== null);
const cachedIn = (page, bucket, path) => page.evaluate(async ([b, p]) => !!(await (await caches.open(b)).match(p)), [bucket, path]);

/** いま表示されている作品 A のマーカー (HTML の版 / JS の版)。 */
async function sketchMarker(page) {
  const frame = await page.waitForSelector('iframe').then((el) => el.contentFrame());
  assert.ok(frame, '作品 A の iframe が無い');
  await frame.waitForSelector('#marker[data-js]', { state: 'attached' });
  return frame.textContent('#marker');
}

/** 作品を書き換えて 1 回だけ再読み込みし、その読み込みで新しい内容が出ることを確かめる。 */
async function assertEditShowsOnFirstReload(page, gallery, label) {
  const before = await loads(page);
  const expected = await editSketch(gallery.publicDir);
  await page.reload();
  assert.equal(await sketchMarker(page), expected, `${label}: 書き換え後の 1 回目の再読み込みで古い作品が出た`);
  assert.equal(await loads(page), before + 1, `${label}: 再読み込みが 1 回でない`);
}

async function assertNoServiceWorker(page, label) {
  assert.equal(await registerCalls(page), 0, `${label}: ページが SW の登録を頼んだ`);
  assert.deepEqual(await registrations(page), [], `${label}: SW が登録されている`);
  assert.equal(await hasController(page), false, `${label}: ページが SW に制御されている`);
}

/**
 * 以前の版の dev を使っていたブラウザを作る: 同じオリジンに SW が登録され、作品 (書き換え前の版) と
 * viewer のエントリ (古い版) がキャッシュに入っている。そのコンテキストを返す。
 */
async function seedLeftover(browser, entry, gallery, port, hangUrl) {
  const origin = `http://localhost:${port}`;
  const swDir = await mkdtemp(join(tmpdir(), 'dc-sw-dev-legacy-'));
  let server;
  const context = await newContext(browser);
  try {
    await generateServiceWorker(swDir, { cacheVersion: 'dev-legacy' });
    server = await startLegacyServer(gallery, port, entry, await readFile(join(swDir, 'sw.js'), 'utf-8'), hangUrl);
    const page = await context.newPage();
    await page.goto(origin + '/');
    await until(() => hasController(page), '以前の版の SW がページを制御する');
    // 制御された状態で開き直し、viewer のエントリと作品を SW のキャッシュに入れる
    await page.goto(origin + '/');
    await until(() => cachedIn(page, 'dropcaster-runtime', entry.entryModule), 'viewer のエントリが runtime に入る');
    await page.goto(origin + '/sketches/a/index.html');
    await until(() => cachedIn(page, 'dropcaster-local', '/sketches/a/index.html'), '作品の HTML が local に入る');
    await until(() => cachedIn(page, 'dropcaster-local', '/sketches/a/sketch.js'), '作品の JS が local に入る');
    await page.close();
    return context;
  } catch (err) {
    await context.close();
    throw err;
  } finally {
    if (server) await stopHttpServer(server);
    await rm(swDir, { recursive: true, force: true });
  }
}

const cases = {
  // dev サーバで開いたページは SW を登録しない
  async noRegistration({ browser, origin }) {
    const context = await newContext(browser);
    try {
      const page = await context.newPage();
      await page.goto(origin + '/');
      await page.waitForFunction(() => (document.querySelector('#app')?.innerHTML.length ?? 0) > 0);
      await sleep(SETTLE_MS);
      await assertNoServiceWorker(page, 'ホームを開いた後');
      assert.equal(await loads(page), 1, 'ホームが自動で再読み込みされた');
    } finally { await context.close(); }
  },

  // 作品を開いたまま書き換えを繰り返しても、毎回 1 回目の再読み込みで反映される
  async editShowsOnFirstReload({ browser, origin, gallery }) {
    const context = await newContext(browser);
    try {
      const expected = await editSketch(gallery.publicDir);
      const page = await context.newPage();
      await page.goto(origin + '/a');
      assert.equal(await sketchMarker(page), expected);
      // 修正前は、SW が制御を得た後の 2 回目の書き換えで古い版が出た (1 回目はまだキャッシュに無い)
      for (let round = 1; round <= 3; round++) {
        await sleep(SETTLE_MS);
        await assertEditShowsOnFirstReload(page, gallery, `${round} 回目の書き換え`);
      }
      await assertNoServiceWorker(page, '書き換えを繰り返した後');
    } finally { await context.close(); }
  },

  // 以前の版の dev が SW とキャッシュを残したブラウザでも、開けば SW が外れていまの作品が出て、
  // その後の書き換えも 1 回目の再読み込みで反映される
  async leftoverWorker({ origin, gallery, leftover }) {
    // dev サーバを止めている間に作品を書き換えた (キャッシュには書き換え前の版が残っている)
    const expected = await editSketch(gallery.publicDir);
    const page = await leftover.newPage();
    // 読み込みの途中でページが自分を読み込み直すので、読み込みの完了は待たない
    await page.goto(origin + '/a', { waitUntil: 'commit' });
    await until(async () => (await registrations(page)).length === 0 && !(await hasController(page)), '残っていた SW が外れる');
    await sleep(SETTLE_MS);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.legacyViewer ?? null), null, 'キャッシュにあった古い viewer のまま動いている');
    assert.equal(await sketchMarker(page), expected, 'SW が外れた後もキャッシュにあった古い作品が出ている');
    assert.equal(await loads(page), 2, 'SW を外すための読み込み直しが 1 回でない');
    await assertEditShowsOnFirstReload(page, gallery, 'SW が残っていたブラウザ');
    await assertNoServiceWorker(page, 'SW が残っていたブラウザで再読み込みした後');
  },
};

const entries = [
  { name: 'cli', entryModule: '/src/viewer/main.ts', staticFrom: null, start: startCliDev },
  { name: 'gallery', entryModule: '/src/viewer/main.ts', staticFrom: resolve(root, 'public'), start: startVite('vite.config.ts', root) },
  { name: 'hosted', entryModule: '/src/viewer-entry.ts', staticFrom: resolve(root, 'apps/web/public'), start: startVite('apps/web/vite.config.ts', resolve(root, 'apps/web')) },
];

const selected = (kind, name) => !process.env[kind] || process.env[kind] === name;
const failures = [];

async function runDevEntry(browser, entry) {
  const gallery = await createGallery(entry.staticFrom);
  let leftover;
  let dev;
  const hanging = await startHangingServer();
  try {
    const port = await freePort();
    const origin = `http://localhost:${port}`;
    await editSketch(gallery.publicDir);
    if (selected('SW_DEV_CASE', 'leftoverWorker')) {
      leftover = await seedLeftover(browser, entry, gallery, port, `http://localhost:${hanging.address().port}/hang`);
    }
    dev = await entry.start(gallery, port);
    // 初回は Vite が依存の事前バンドルでページを読み込み直すことがあるので、1 度開いて済ませておく
    const warmup = await newContext(browser);
    try {
      const page = await warmup.newPage();
      await page.goto(origin + '/a');
      await sketchMarker(page);
      await sleep(SETTLE_MS);
    } finally { await warmup.close(); }
    for (const [caseName, run] of Object.entries(cases)) {
      if (!selected('SW_DEV_CASE', caseName)) continue;
      try {
        await run({ browser, origin, gallery, leftover });
        console.log(`${entry.name}/${caseName}: PASS`);
      } catch (err) {
        failures.push(`${entry.name}/${caseName}`);
        console.error(`${entry.name}/${caseName}: FAIL\n${err.stack}`);
      }
    }
  } catch (err) {
    failures.push(`${entry.name}/(setup)`);
    console.error(`${entry.name}/(setup): FAIL\n${err.stack}`);
  } finally {
    if (leftover) await leftover.close();
    if (dev) await dev.stop();
    await stopHttpServer(hanging);
    await rm(gallery.dir, { recursive: true, force: true });
  }
}

/** `dropcaster build` + `dropcaster preview` を localhost で開くと、今までどおり SW が登録されページを制御する。 */
async function runCliPreview(browser) {
  const caseName = 'registers';
  if (!selected('SW_DEV_CASE', caseName)) return;
  const gallery = await createGallery(null);
  let preview;
  const context = await newContext(browser);
  try {
    await editSketch(gallery.publicDir);
    const build = spawnSync(process.execPath, [cli, 'build'], { cwd: gallery.dir, encoding: 'utf-8', env: { ...process.env, DROPCASTER_LANG: 'en' } });
    assert.equal(build.status, 0, `dropcaster build failed: ${build.stderr}`);
    const port = await freePort();
    const origin = `http://localhost:${port}`;
    preview = spawnCli(['preview', '--port', String(port)], gallery.dir);
    await waitForHttp(origin + '/', preview);
    const page = await context.newPage();
    await page.goto(origin + '/');
    await until(() => hasController(page), 'preview のページを SW が制御する');
    assert.deepEqual(await registrations(page), ['/']);
    assert.ok((await page.evaluate(() => caches.keys())).some(n => n.startsWith('dropcaster-shell-')), 'shell のキャッシュが無い');
    console.log(`cli-preview/${caseName}: PASS`);
  } catch (err) {
    failures.push(`cli-preview/${caseName}`);
    console.error(`cli-preview/${caseName}: FAIL\n${err.stack}${preview ? `\n${preview.output()}` : ''}`);
  } finally {
    await context.close();
    if (preview) await preview.stop();
    await rm(gallery.dir, { recursive: true, force: true });
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const entry of entries) {
    if (selected('SW_DEV_ENTRY', entry.name)) await runDevEntry(browser, entry);
  }
  if (selected('SW_DEV_ENTRY', 'cli-preview')) await runCliPreview(browser);
} finally { await browser.close(); }
if (failures.length) {
  console.error(`failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
