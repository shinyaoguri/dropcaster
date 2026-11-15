// 生成した Service Worker を実 Chromium で動かし、作品 iframe のナビゲーションが
// ホームのシェル用キャッシュを上書きしないことを確かめる (#105)。
//
// viewer はビルドしない。SW の振り分けは request.destination の実値に依存するので、
// mock ではなくブラウザに navigate させる。ホームは #app を持つ最小のシェルで代用し、
// 未知のパスはシェルを返す (SPA fallback と同じ)。ルート配信とサブパス配信の両方を見る。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
import { generateServiceWorker } from '../../src/cli/utils/service-worker.js';

const TIMEOUT_MS = 15_000;
const SKETCHES = ['a', 'b'];
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const shellHtml = (base) => `<!doctype html><html><head><title>dc-shell</title></head>
<body><div id="app">gallery</div><script>
  const BASE = ${JSON.stringify(base)};
  navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE });
  const open = new URLSearchParams(location.search).get('open');
  if (open) {
    const frame = document.createElement('iframe');
    frame.src = BASE + 'sketches/' + open + '/index.html';
    document.body.appendChild(frame);
  }
</script></body></html>`;

const sketchHtml = (id) => `<!doctype html><html><head><title>sketch-${id}</title></head>
<body><p id="marker">sketch-${id}</p></body></html>`;

async function prepareRoot(base) {
  const root = await mkdtemp(join(tmpdir(), 'dc-sw-offline-'));
  await generateServiceWorker(root, { cacheVersion: 'test' });
  await writeFile(join(root, 'index.html'), shellHtml(base));
  for (const id of SKETCHES) {
    await mkdir(join(root, 'sketches', id), { recursive: true });
    await writeFile(join(root, 'sketches', id, 'index.html'), sketchHtml(id));
  }
  return root;
}

function startServer(root, base) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    const rel = pathname.slice(base.length);
    const file = rel === '' ? 'index.html' : rel;
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      if (rel.startsWith('sketches/')) { res.writeHead(404).end(); return; }
      // SPA fallback: /a のような作品ルートにはシェルを返す
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] }).end(await readFile(join(root, 'index.html')));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function stopServer(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function openSketchInFrame(page, url, id) {
  await page.goto(url);
  const frame = await page.waitForSelector('iframe').then((el) => el.contentFrame());
  assert.ok(frame, `作品 ${id} の iframe が無い`);
  await frame.waitForSelector('#marker', { timeout: TIMEOUT_MS });
  assert.equal(await frame.textContent('#marker'), `sketch-${id}`);
}

async function runCase(browser, base) {
  const root = await prepareRoot(base);
  const server = await startServer(root, base);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  context.setDefaultTimeout(TIMEOUT_MS);
  let serverStopped = false;
  try {
    const page = await context.newPage();

    // オンライン: ホームで SW の制御を得てから、作品 A・B を iframe で開く
    await page.goto(origin + base);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await openSketchInFrame(page, `${origin}${base}a?open=a`, 'a');
    await openSketchInFrame(page, `${origin}${base}b?open=b`, 'b');

    // SW の cache.put は応答と非同期なので、最後の作品が何らかの形でキャッシュに載るまで待つ
    // (修正前はシェルのキーへ、修正後は作品自身の URL へ入る)
    await page.waitForFunction(async ({ shellUrl, sketchUrl }) => {
      if (await caches.match(sketchUrl)) return true;
      const shell = await caches.match(shellUrl);
      return shell ? (await shell.text()).includes('sketch-b') : false;
    }, { shellUrl: origin + base, sketchUrl: `${origin}${base}sketches/b/index.html` });

    const shellText = await page.evaluate(async (url) => (await caches.match(url))?.text(), origin + base);
    assert.ok(shellText?.includes('id="app"'), `[${base}] シェルのキャッシュがシェルでない: ${shellText?.slice(0, 120)}`);

    // オフライン (配信停止)
    await stopServer(server);
    serverStopped = true;

    await page.goto(origin + base);
    assert.equal(await page.locator('#app').count(), 1, `[${base}] オフラインのホームに #app が無い (title: ${await page.title()})`);
    assert.equal(await page.title(), 'dc-shell');

    await page.goto(`${origin}${base}a`);
    assert.equal(await page.locator('#app').count(), 1, `[${base}] オフラインの作品ルートにシェルが返らない`);

    for (const id of SKETCHES) {
      await page.goto(`${origin}${base}sketches/${id}/index.html`);
      assert.equal(await page.title(), `sketch-${id}`, `[${base}] オフラインの作品 ${id} に別の HTML が返った`);
    }

    // 実際の使い方: オフラインのシェルの中で作品を iframe で開き直す
    await openSketchInFrame(page, `${origin}${base}b?open=a`, 'a');
    console.log(`ok: service worker offline navigation (base ${base})`);
  } finally {
    await context.close();
    if (!serverStopped) await stopServer(server);
    await rm(root, { recursive: true, force: true });
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const base of ['/', '/sub/']) await runCase(browser, base);
} finally {
  await browser.close();
}
