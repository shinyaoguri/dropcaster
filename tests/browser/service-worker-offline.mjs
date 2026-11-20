// 生成した Service Worker を実 Chromium で動かし、作品 iframe のナビゲーションが
// ホームのシェル用キャッシュを上書きしないことを確かめる (#105)。
//
// viewer はビルドしない。SW の振り分けは request.destination の実値に依存するので、
// mock ではなくブラウザに navigate させる。ホームは #app を持つ最小のシェルで代用し、
// 未知のパスはシェルを返す (SPA fallback と同じ)。ルート配信とサブパス配信の両方を見る。
// 作品の URL は実カタログと同じ sketches/<id>/ (src/core/modules/sketch-analyzer.js) の形にする。
//
// あわせて、作品のサブリソース (sketches/<id>/sketch.js) とカタログ (sketches.json) が、どちらの配信でも
// LOCAL のバケットだけに入ることを確かめる (#179)。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
import { generateServiceWorker } from '../../src/cli/utils/service-worker.js';

const TIMEOUT_MS = 15_000;
const SKETCHES = ['a', 'b'];
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// 実アプリと同じく、シェルは作品カタログ (sketches.json) を取りにいく
const shellHtml = (base) => `<!doctype html><html><head><title>dc-shell</title></head>
<body><div id="app">gallery</div><script>
  const BASE = ${JSON.stringify(base)};
  navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE });
  fetch(BASE + 'sketches.json').catch(() => {});
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  const src = open ? 'sketches/' + open + '/' : params.get('frame');
  if (src) {
    const frame = document.createElement('iframe');
    frame.src = BASE + src;
    document.body.appendChild(frame);
  }
</script></body></html>`;

// ユーザーの public/ に置かれうる、シェルでも作品でもない HTML
const extraHtml = '<!doctype html><html><head><title>extra-page</title></head><body>extra</body></html>';

// 作品は自分のサブリソース (sketch.js) を読み、読めたことを #marker に残す
const sketchHtml = (id) => `<!doctype html><html><head><title>sketch-${id}</title></head>
<body><p id="marker">sketch-${id}</p><script src="sketch.js"></script></body></html>`;

const sketchScript = (id) => `document.getElementById('marker').dataset.script = ${JSON.stringify(`ran-${id}`)};\n`;

// バケット名はテンプレートの定数を正とする (テストに写さない)
function bucketName(sw, constant) {
  const name = sw.match(new RegExp(`const ${constant}\\s*= '([^']+)';`))?.[1];
  assert.ok(name, `sw.js に ${constant} が無い`);
  return name;
}

async function prepareRoot(base) {
  const root = await mkdtemp(join(tmpdir(), 'dc-sw-offline-'));
  const sw = await readFile(await generateServiceWorker(root, { cacheVersion: 'test' }), 'utf-8');
  await writeFile(join(root, 'index.html'), shellHtml(base));
  await writeFile(join(root, 'extra.html'), extraHtml);
  await writeFile(join(root, 'sketches.json'), JSON.stringify(SKETCHES.map((id) => ({ id, path: `sketches/${id}/index.html` }))));
  for (const id of SKETCHES) {
    await mkdir(join(root, 'sketches', id), { recursive: true });
    await writeFile(join(root, 'sketches', id, 'index.html'), sketchHtml(id));
    await writeFile(join(root, 'sketches', id, 'sketch.js'), sketchScript(id));
  }
  return { root, buckets: { local: bucketName(sw, 'LOCAL_CACHE'), runtime: bucketName(sw, 'RUNTIME_CACHE') } };
}

function startServer(root, base) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    const rel = pathname.slice(base.length);
    const file = rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel;
    try {
      const body = await readFile(join(root, file));
      // 別オリジンとして立てたときにページから読めるよう、CORS を許可する
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      }).end(body);
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
  // 作品のサブリソースも読めている
  await frame.waitForSelector(`#marker[data-script="ran-${id}"]`, { timeout: TIMEOUT_MS });
}

// url を持っている dropcaster のバケット名。SW の cache.put は応答と非同期なので、どこかに載るまで待つ
async function bucketsHolding(page, url) {
  await page.waitForFunction(async (u) => Boolean(await caches.match(u)), url);
  return page.evaluate(async (u) => {
    const holding = [];
    for (const name of await caches.keys()) {
      if (await (await caches.open(name)).match(u)) holding.push(name);
    }
    return holding.sort();
  }, url);
}

async function runCase(browser, base) {
  const { root, buckets } = await prepareRoot(base);
  const server = await startServer(root, base);
  const origin = `http://127.0.0.1:${server.address().port}`;
  // 同じ中身を別のポート (= 別オリジン) でも配信する
  const otherServer = await startServer(root, base);
  const otherOrigin = `http://127.0.0.1:${otherServer.address().port}`;
  const context = await browser.newContext({ locale: 'en-US' });
  context.setDefaultTimeout(TIMEOUT_MS);
  let serverStopped = false;
  try {
    const page = await context.newPage();

    // オンライン: ホームで SW の制御を得てから、シェル以外の HTML を iframe で、作品 A・B を
    // iframe で開き、最後にシェル以外の HTML をトップレベルで開く。SPA のルートを開くとシェルの
    // 応答で上書きし直されて汚染が隠れるので、トップレベルの別 HTML は最後に置く。
    // 振り分けがルート前提だったころの版が残した状態を作る: SW を登録しないページから、作品のサブリソースを
    // runtime に置いておく。中身のバケットは版をまたいで残るので、有効化のときに LOCAL へ移らないと、
    // 更新後にオフラインで開いた作品がこれを引けない (#179)
    const legacy = { sketch: `${origin}${base}sketches/a/legacy.js`, other: `${origin}${base}legacy.txt` };
    await page.goto(`${origin}${base}extra.html`);
    await page.evaluate(async ({ runtime, urls }) => {
      const cache = await caches.open(runtime);
      for (const url of urls) await cache.put(url, new Response('legacy'));
    }, { runtime: buckets.runtime, urls: Object.values(legacy) });

    await page.goto(origin + base);
    // 有効化の最後に clients.claim() するので、制御が始まった時点で移し終えている
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    assert.deepEqual(await bucketsHolding(page, legacy.sketch), [buckets.local],
      `[${base}] 以前の版が runtime に入れた作品のサブリソースが LOCAL へ移っていない`);
    assert.deepEqual(await bucketsHolding(page, legacy.other), [buckets.runtime],
      `[${base}] 作品でないものまで runtime から動かした`);
    await page.goto(`${origin}${base}x?frame=extra.html`);
    await (await page.waitForSelector('iframe').then((el) => el.contentFrame())).waitForSelector('text=extra');
    await openSketchInFrame(page, `${origin}${base}a?open=a`, 'a');
    await openSketchInFrame(page, `${origin}${base}b?open=b`, 'b');

    // SW の cache.put は応答と非同期なので、最後の作品が何らかの形でキャッシュに載るまで待つ
    // (修正前はシェルのキーへ、修正後は作品自身の URL へ入る)
    await page.waitForFunction(async ({ shellUrl, sketchUrl }) => {
      if (await caches.match(sketchUrl)) return true;
      const shell = await caches.match(shellUrl);
      return shell ? (await shell.text()).includes('sketch-b') : false;
    }, { shellUrl: origin + base, sketchUrl: `${origin}${base}sketches/b/` });

    // 振り分け (#179): 作品の HTML・サブリソースとカタログは、ルート配信でもサブパス配信でも LOCAL だけに入る。
    // サブパス配信でサブリソースが runtime に落ちると、作品の HTML と JS の置き場が分かれる
    for (const path of ['sketches/a/', 'sketches/a/sketch.js', 'sketches/b/sketch.js', 'sketches.json']) {
      assert.deepEqual(await bucketsHolding(page, `${origin}${base}${path}`), [buckets.local],
        `[${base}] ${path} の入ったバケットが LOCAL だけでない`);
    }
    // 別オリジンの同じパスは、ローカル作品として扱わない
    const foreign = `${otherOrigin}${base}sketches/a/sketch.js`;
    assert.equal(await page.evaluate(async (url) => (await fetch(url)).status, foreign), 200);
    assert.deepEqual(await bucketsHolding(page, foreign), [buckets.runtime],
      `[${base}] 別オリジンの sketches/ が runtime 以外に入った`);

    await page.goto(`${origin}${base}extra.html`);
    assert.equal(await page.title(), 'extra-page');
    // 誤ってシェルへ保存される場合も put は非同期なので、汚染が現れうる間だけ待つ (正しければ待ち切る)
    await page.waitForFunction(async (url) => !(await (await caches.match(url))?.text())?.includes('id="app"'),
      origin + base, { timeout: 2_000 }).catch(() => {});

    const shellText = await page.evaluate(async (url) => (await caches.match(url))?.text(), origin + base);
    assert.ok(shellText?.includes('id="app"'), `[${base}] シェルのキャッシュがシェルでない: ${shellText?.slice(0, 120)}`);

    // オフライン (配信停止)
    await stopServer(server);
    await stopServer(otherServer);
    serverStopped = true;

    await page.goto(origin + base);
    assert.equal(await page.locator('#app').count(), 1, `[${base}] オフラインのホームに #app が無い (title: ${await page.title()})`);
    assert.equal(await page.title(), 'dc-shell');

    await page.goto(`${origin}${base}a`);
    assert.equal(await page.locator('#app').count(), 1, `[${base}] オフラインの作品ルートにシェルが返らない`);

    for (const id of SKETCHES) {
      await page.goto(`${origin}${base}sketches/${id}/`);
      assert.equal(await page.title(), `sketch-${id}`, `[${base}] オフラインの作品 ${id} に別の HTML が返った`);
    }

    // 実際の使い方: オフラインのシェルの中で作品を iframe で開き直す
    await openSketchInFrame(page, `${origin}${base}b?open=a`, 'a');
    // 以前の版が取っておいた作品のサブリソースも、オフラインで引ける
    assert.equal(await page.evaluate(async (url) => (await fetch(url)).text(), legacy.sketch), 'legacy',
      `[${base}] 以前の版が取った作品のサブリソースをオフラインで引けない`);

    // 作品以外の iframe は、オフラインで未キャッシュならシェルではなく 503 になる
    // (iframe の中にギャラリー全体を出さない)
    await page.goto(`${origin}${base}x?frame=missing.html`);
    const missing = await page.waitForSelector('iframe').then((el) => el.contentFrame());
    await missing.waitForLoadState();
    assert.equal(await missing.locator('#app').count(), 0, `[${base}] 作品以外の iframe にシェルが返った`);
    assert.match(await missing.textContent('body'), /オフラインです/);
    console.log(`ok: service worker offline navigation (base ${base})`);
  } finally {
    await context.close();
    if (!serverStopped) {
      await stopServer(server);
      await stopServer(otherServer);
    }
    await rm(root, { recursive: true, force: true });
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const base of ['/', '/sub/']) await runCase(browser, base);
} finally {
  await browser.close();
}
