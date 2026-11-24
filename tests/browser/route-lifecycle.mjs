// 非同期ルートの古い結果と、破棄済みコントローラーのリスナー復活を実 App / Router で確かめる (#106)。
//
// 外部取得 (Gist / OpenProcessing の API) と作品 HTML の応答を context.route で保留し、
// 完了の順をテストが決める。遷移は同一ドキュメント内の SPA 遷移 (リンクのクリックと
// history.back) で起こす。page.goto だとドキュメントごと作り直されて競合が消えるため。
// 本番コードには手を入れず、リスナーの数え上げだけ addInitScript で包む。
// あわせて、secure context でない LAN の HTTP オリジンでも各ルートが初期化できることを確かめる (#170)。
// 同じ Gist の差し替え経路で、作品の組み立てが script / CSS の意味を変えないことも確かめる (#110)。
// ホーム (ギャラリー) のヘッダーは、どの幅でも見出しとボタン列が重ならず、ボタンが押せることを確かめる (#178)。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const GIST_A = 'a'.repeat(32);
const GIST_B = 'b'.repeat(32);
const OP_ID = '1234567';
// 保留を解いた後、古い結果が描画されうる間だけ待つ (iframe の差し込みは応答から数十 ms 以内)
const SETTLE_MS = 600;
const HOME = '.gallery-grid, #op-id-input-hero';

const catalog = [{ id: 'a', title: 'Local A', path: 'sketches/a/index.html' }]
  .map(s => ({ description: '', type: 'html', tags: [], interactiveElements: [], lastModified: '2026-11-15', ...s }));
const markerHtml = (marker) => `<!doctype html><html><head><title>${marker}</title></head><body><p id="marker">${marker}</p></body></html>`;
const gistJson = (id, marker) => ({
  id, description: marker, owner: { login: 'tester' }, html_url: `https://gist.github.com/${id}`, updated_at: '2026-11-15T00:00:00Z',
  files: { 'index.html': { filename: 'index.html', content: markerHtml(marker), truncated: false } },
});

// #110: 埋め込みで実行・適用の意味が変わると、対応するマーカーが期待とずれる作品
const embedFiles = {
  'index.html': [
    '<!doctype html><html><head>',
    '<link rel="stylesheet" href="screen.css">',
    '<link rel="stylesheet" href="print.css" media="print">',
    '<script defer src="defer.js"></script>',
    '<script type="module" src="./module.js"></script>',
    '<script nomodule src="legacy.js"></script>',
    '</head><body><div id="target"></div><script src="tricky.js"></script><p id="after">after</p></body></html>',
  ].join('\n'),
  // </style の後ろの規則も同じ <style> に残っていれば width が効く
  'screen.css': '#target::after { content: "</style><p id=leak>"; }\n#target { width: 7px; color: rgb(0, 128, 0); }',
  'print.css': '#target { color: rgb(255, 0, 0); }',
  // body の解析後に走るなら #target がある
  'defer.js': "document.getElementById('target').dataset.defer = 'ran';",
  'module.js': "await Promise.resolve();\nexport const ok = true;\ndocument.getElementById('target').dataset.module = 'ran';",
  'legacy.js': "document.documentElement.dataset.legacy = 'ran';",
  'tricky.js': "window.tricky = \"<!--<script>\";\ndocument.getElementById('target').dataset.tricky = 'ran';",
};
// #110: 埋め込んだ script の相対パスの import は未対応 (README に明記)。絶対 URL なら通る
const ABS_MODULE_URL = 'https://cdn.example.test/dc-abs.js';
const importFiles = {
  'index.html': [
    '<!doctype html><html><head>',
    '<script type="module" src="rel-static.js"></script>',
    '<script type="module" src="abs-static.js"></script>',
    '<script src="rel-dynamic.js"></script>',
    '</head><body><div id="target"></div></body></html>',
  ].join('\n'),
  'util.js': 'export const v = 1;',
  'rel-static.js': "import { v } from './util.js';\ndocument.getElementById('target').dataset.relStatic = 'ran' + v;",
  'abs-static.js': `import { abs } from '${ABS_MODULE_URL}';\ndocument.getElementById('target').dataset.absStatic = abs;`,
  'rel-dynamic.js': "import('./util.js').then(\n  () => { document.documentElement.dataset.relDynamic = 'resolved'; },\n  (e) => { document.documentElement.dataset.relDynamic = 'rejected:' + e.name; },\n);",
};

const gistFilesJson = (id, files) => ({
  id, description: 'embed', owner: { login: 'tester' }, html_url: `https://gist.github.com/${id}`, updated_at: '2026-11-16T00:00:00Z',
  files: Object.fromEntries(Object.entries(files).map(([filename, content]) => [filename, { filename, content, truncated: false }])),
});

/** route を保留し、テストから応答 (fulfill の引数) を渡すまで返さない。 */
function holdRoutes(context, pattern) {
  const pending = new Map();
  const waiters = new Map();
  const keyOf = (url) => new URL(url).pathname;
  context.route(pattern, (route) => {
    const key = keyOf(route.request().url());
    pending.set(key, route);
    waiters.get(key)?.();
  });
  return {
    /** その path の要求がブラウザから届くまで待つ。 */
    arrived(path) {
      if (pending.has(path)) return Promise.resolve();
      return new Promise((r) => waiters.set(path, r));
    },
    async release(path, response) {
      await this.arrived(path);
      const route = pending.get(path);
      pending.delete(path);
      await route.fulfill(response);
    },
  };
}

async function setup(browser, base) {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' });
  context.setDefaultTimeout(15_000);
  const errors = [];
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  await context.route('**/sketches.json', (r) => r.fulfill({ json: catalog }));
  const gist = holdRoutes(context, 'https://api.github.com/gists/**');
  const op = holdRoutes(context, 'https://openprocessing.org/api/**');
  const sketchHtml = holdRoutes(context, '**/sketches/a/index.html');
  // window の beforeunload / pagehide に今付いているリスナーを数える (重複登録は addEventListener と同じく 1 件)
  await context.addInitScript(() => {
    const live = { beforeunload: new Set(), pagehide: new Set() };
    const add = window.addEventListener, remove = window.removeEventListener;
    window.addEventListener = function (type, fn, ...rest) { live[type]?.add(fn); return add.call(this, type, fn, ...rest); };
    window.removeEventListener = function (type, fn, ...rest) { live[type]?.delete(fn); return remove.call(this, type, fn, ...rest); };
    window.__dcListeners = () => ({ beforeunload: live.beforeunload.size, pagehide: live.pagehide.size });
  });
  const page = await context.newPage();
  await page.goto(base.url + '/');
  await page.waitForSelector(HOME);
  // Vite のクライアントも beforeunload を付けるので、ホーム表示直後の件数を基準にする
  const baseline = await page.evaluate(() => window.__dcListeners());
  return { context, page, errors, gist, op, sketchHtml, baseline };
}

/** 同一ドキュメント内で Router のリンク遷移を起こす。 */
async function clickLink(page, path) {
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    document.body.append(a);
    a.click();
    a.remove();
  }, path);
}

async function backToHome(page) {
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.pathname === '/');
  await page.waitForSelector(HOME);
}

async function settle(page) {
  await page.waitForTimeout(SETTLE_MS);
}

/** 作品ページ由来のリスナー数 (基準からの増分) */
async function pageListeners({ page, baseline }) {
  const now = await page.evaluate(() => window.__dcListeners());
  return { beforeunload: now.beforeunload - baseline.beforeunload, pagehide: now.pagehide - baseline.pagehide };
}

async function assertHomeIntact({ page, baseline }, label) {
  assert.equal(await page.evaluate(() => location.pathname), '/', `${label}: URL がホームでない`);
  assert.equal(await page.locator('#sketch-stage').count(), 0, `${label}: 古い作品の画面が描画された`);
  assert.equal(await page.locator('.sketch-error').count(), 0, `${label}: 古いエラー画面が描画された`);
  assert.equal(await page.locator(HOME).count(), 1, `${label}: ホームが残っていない`);
  assert.deepEqual(await pageListeners({ page, baseline }), { beforeunload: 0, pagehide: 0 },
    `${label}: 破棄済みのリスナーが残った`);
}

const cases = {
  // 再現 A: Gist の取得中にホームへ戻り、その後で取得が成功する
  async gistSuccessAfterLeave(env) {
    const { page, gist } = env;
    await clickLink(page, `/gist/${GIST_A}`);
    await gist.arrived(`/gists/${GIST_A}`);
    await backToHome(page);
    await gist.release(`/gists/${GIST_A}`, { json: gistJson(GIST_A, 'gist-A') });
    await settle(page);
    await assertHomeIntact(env, 'Gist 成功');
  },

  // 失敗結果も同じく、遷移後の画面を上書きしない
  async gistFailureAfterLeave(env) {
    const { page, gist } = env;
    await clickLink(page, `/gist/${GIST_A}`);
    await gist.arrived(`/gists/${GIST_A}`);
    await backToHome(page);
    await gist.release(`/gists/${GIST_A}`, { status: 404, json: { message: 'Not Found' } });
    await settle(page);
    await assertHomeIntact(env, 'Gist 失敗');
  },

  async opFailureAfterLeave(env) {
    const { page, op } = env;
    await clickLink(page, `/op/${OP_ID}`);
    await op.arrived(`/api/sketch/${OP_ID}`);
    await backToHome(page);
    await op.release(`/api/sketch/${OP_ID}`, { status: 404, json: { message: 'Not Found' } });
    await settle(page);
    await assertHomeIntact(env, 'OP 失敗');
  },

  // A→B と開き、取得が B→A の逆順で完了しても、最後に開いた B だけが表示される
  async gistReverseCompletion(env) {
    const { page, gist } = env;
    await clickLink(page, `/gist/${GIST_A}`);
    await gist.arrived(`/gists/${GIST_A}`);
    await clickLink(page, `/gist/${GIST_B}`);
    await gist.arrived(`/gists/${GIST_B}`);
    await gist.release(`/gists/${GIST_B}`, { json: gistJson(GIST_B, 'gist-B') });
    await page.frameLocator('#sketch-iframe').locator('#marker').waitFor();
    // B の描画が終わる (離脱警告まで付く) のを待ち、B だけが持つリスナーの数を控える
    await page.waitForFunction((base) => window.__dcListeners().beforeunload > base, env.baseline.beforeunload);
    const listenersOfB = await pageListeners(env);
    await gist.release(`/gists/${GIST_A}`, { json: gistJson(GIST_A, 'gist-A') });
    await settle(page);
    assert.equal(await page.evaluate(() => location.pathname), `/gist/${GIST_B}`);
    assert.equal(await page.locator('#sketch-iframe').count(), 1, '逆順完了: 作品の iframe が 1 枚でない');
    assert.equal(await page.frameLocator('#sketch-iframe').locator('#marker').textContent(), 'gist-B',
      '逆順完了: 先に開いた A が B を上書きした');
    assert.deepEqual(await pageListeners(env), listenersOfB,
      '逆順完了: 表示中の B 以外のリスナーが残った');
  },

  // #110: Gist の作品で module・defer・nomodule・<!--<script>・media 付き CSS・</style が元のファイル構成と同じに働く
  async gistEmbedsKeepSemantics(env) {
    const { page, gist } = env;
    await clickLink(page, `/gist/${GIST_A}`);
    await gist.release(`/gists/${GIST_A}`, { json: gistFilesJson(GIST_A, embedFiles) });
    const target = page.frameLocator('#sketch-iframe').locator('#target');
    await target.waitFor({ state: 'attached' });
    await settle(page);
    const observed = await target.evaluate((t) => ({
      module: t.dataset.module ?? null,
      defer: t.dataset.defer ?? null,
      legacy: document.documentElement.dataset.legacy ?? null,
      tricky: t.dataset.tricky ?? null,
      after: !!document.getElementById('after'),
      leak: !!document.getElementById('leak'),
      width: getComputedStyle(t).width,
      color: getComputedStyle(t).color,
      afterContent: getComputedStyle(t, '::after').content,
    }));
    assert.deepEqual(observed, {
      module: 'ran', defer: 'ran', legacy: null, tricky: 'ran', after: true, leak: false,
      width: '7px', color: 'rgb(0, 128, 0)', afterContent: '"</style><p id=leak>"',
    }, '埋め込み後の作品が元のファイル構成と違う動きをした');
  },

  // #110: 相対パスの static import / import() は解決できない (未対応として固定)。絶対 URL の import は通る
  async gistEmbedsRelativeImportUnsupported(env) {
    const { page, gist, context } = env;
    await context.route(ABS_MODULE_URL, (r) => r.fulfill({
      contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: "export const abs = 'ran';",
    }));
    await clickLink(page, `/gist/${GIST_A}`);
    await gist.release(`/gists/${GIST_A}`, { json: gistFilesJson(GIST_A, importFiles) });
    const target = page.frameLocator('#sketch-iframe').locator('#target');
    await target.waitFor({ state: 'attached' });
    await settle(page);
    const observed = await target.evaluate((t) => ({
      relStatic: t.dataset.relStatic ?? null,
      absStatic: t.dataset.absStatic ?? null,
      relDynamic: document.documentElement.dataset.relDynamic ?? null,
    }));
    assert.deepEqual(observed, { relStatic: null, absStatic: 'ran', relDynamic: 'rejected:TypeError' },
      '相対 import の扱いが README の記述 (未対応・絶対 URL は可) と違う');
    // static import の解決失敗は module の読み込みエラーとして出る。想定したこの 1 件だけを除き、残りは共通の検査に回す
    const expected = env.errors.filter((m) => /Failed to resolve module specifier "\.\/util\.js"/.test(m));
    assert.equal(expected.length, 1, `相対 static import の解決失敗が出ていない: ${JSON.stringify(env.errors)}`);
    env.errors.splice(0, env.errors.length, ...env.errors.filter((m) => !expected.includes(m)));
  },

  // 再現 B: 作品 iframe の読み込み中に離脱しても、破棄済みコントローラーがリスナーを付け直さない
  async leaveWhileIframeLoading(env) {
    const { page, sketchHtml } = env;
    await clickLink(page, '/a');
    await page.waitForSelector('#sketch-stage');
    await sketchHtml.arrived('/sketches/a/index.html');
    await backToHome(page);
    await sketchHtml.release('/sketches/a/index.html', { contentType: 'text/html', body: markerHtml('local-a') });
    await settle(page);
    await assertHomeIntact(env, 'iframe 読み込み中の離脱');
  },
};

// `dropcaster dev` / `preview --host` が案内する LAN の http://<IP>:<port> は secure context ではない。
// 127.0.0.1 は secure context 扱いなので、ループバックでない名前を 127.0.0.1 へ向けて同じ状況を作り、
// secure context 限定 API (crypto.randomUUID 等) に依存せずマッピング・会場が初期化できることを確かめる (#170)。
const INSECURE_HOST = 'insecure.test';
const canvasHtml = `<!doctype html><body><script>addEventListener('load',()=>{const c=document.createElement('canvas');
  c.width=640;c.height=360;document.body.append(c);const x=c.getContext('2d');
  (function d(){x.fillStyle='#dc9030';x.fillRect(0,0,640,360);requestAnimationFrame(d)})()})</script>`;
const videoFlows = () => document.querySelector('#source-video')?.videoWidth > 0;
const insecureRoutes = [
  ['/mapping', (p) => p.locator('#preview-tab').click(), videoFlows],
  ['/slideshow', async (p) => {
    await p.locator('#play-pause-btn').click();
    await p.locator('#open-windows-btn, #mapping-btn').first().click();
    await p.locator('#preview-tab').click();
  }, videoFlows],
  ['/venue', async () => {}, () => !!document.querySelector('#venue-canvas')],
];

async function insecureOrigin(browser, base) {
  const url = base.url.replace('127.0.0.1', INSECURE_HOST);
  for (const [path, open, ready] of insecureRoutes) {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' });
    context.setDefaultTimeout(15_000);
    try {
      const errors = [];
      await context.route('**/sketches.json', (r) => r.fulfill({ json: catalog }));
      await context.route('**/sketches/a/index.html', (r) => r.fulfill({ contentType: 'text/html', body: canvasHtml }));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url + path);
      assert.equal(await page.evaluate(() => isSecureContext), false, 'the origin must not be a secure context');
      await open(page);
      await page.waitForFunction(ready);
      assert.deepEqual(errors, [], `${base.name}/insecureOrigin ${path}: browser errors`);
      console.log(`${base.name}/insecureOrigin ${path}: PASS`);
    } finally { await context.close(); }
  }
}

// ギャラリーのホームは、見出しの文字にヘッダーのボタン列 (言語切替・会場・スライドショー) が被さらない (#178)。
// 幅と言語を変えて実際の矩形を測る。期待値は「交差しない・画面内にある・クリックが届く」という性質で、
// レイアウトの計算は写さない。日本語は見出しもボタンも英語より幅が広い。
// 961px は 1 行に並ぶいちばん狭い幅 (960px 以下はボタン列が下の行へ回る)。
const HEADER_WIDTHS = [1600, 1280, 961, 960, 800, 375];
const HEADER_TITLES = { en: 'Sketch Gallery', ja: 'スケッチギャラリー' };
const headerControls = '.header-actions .dc-lang-toggle, .header-actions a';

function measureHeader(selector) {
  const box = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('.header h1'));
  return {
    // 見出しは箱ではなく文字そのものの範囲で見る (箱は行いっぱいに広がることがある)
    title: box(range.getBoundingClientRect()),
    header: box(document.querySelector('.header').getBoundingClientRect()),
    actions: box(document.querySelector('.header-actions').getBoundingClientRect()),
    controls: [...document.querySelectorAll(selector)].map((el) => ({
      name: el.getAttribute('aria-label') ?? el.textContent.trim(), ...box(el.getBoundingClientRect()) })),
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  };
}

const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
const span = (r) => `x ${Math.round(r.left)}..${Math.round(r.right)}, y ${Math.round(r.top)}..${Math.round(r.bottom)}`;

async function assertHeaderLayout(page, label, width) {
  const m = await page.evaluate(measureHeader, headerControls);
  assert.equal(m.controls.length, 3, `${label}: ヘッダーの操作は言語切替・会場・スライドショーの 3 つ`);
  for (const [i, control] of m.controls.entries()) {
    assert.ok(!intersects(m.title, control),
      `${label}: 見出し (${span(m.title)}) に「${control.name}」(${span(control)}) が重なっている`);
    assert.ok(control.left >= 0 && control.right <= m.viewport,
      `${label}: 「${control.name}」(${span(control)}) が画面 (幅 ${m.viewport}) の外に出ている`);
    for (const other of m.controls.slice(i + 1)) {
      assert.ok(!intersects(control, other), `${label}: 「${control.name}」と「${other.name}」が重なっている`);
    }
  }
  assert.ok(m.scrollWidth <= m.viewport, `${label}: ページが横にはみ出している (${m.scrollWidth} > ${m.viewport})`);
  // 実際のクリックと同じ判定 (表示されていて、押す位置で一番手前にある) を、押さずに確かめる
  for (const control of await page.locator(headerControls).all()) await control.click({ trial: true, timeout: 3_000 });

  if (width >= 1280) {
    // 広い幅の並びは変えない: 見出しとボタン列は同じ行で、ボタン列は右端
    const middle = (m.actions.top + m.actions.bottom) / 2;
    assert.ok(middle > m.title.top && middle < m.title.bottom, `${label}: ボタン列が見出しと同じ行にない`);
    assert.ok(Math.abs(m.actions.right - m.header.right) <= 1, `${label}: ボタン列が右端にない`);
  }
  if (width >= 1600) {
    const center = (r) => (r.left + r.right) / 2;
    assert.ok(Math.abs(center(m.title) - center(m.header)) <= 1,
      `${label}: 見出しが中央にない (見出し ${center(m.title)}, ヘッダー ${center(m.header)})`);
  }
}

async function galleryHeader(browser, base) {
  for (const lang of ['en', 'ja']) {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
    context.setDefaultTimeout(15_000);
    try {
      const errors = [];
      await context.route('**/sketches.json', (r) => r.fulfill({ json: catalog }));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base.url + '/');
      await page.waitForSelector('.gallery-grid');
      assert.equal(await page.locator('.header h1').textContent(), HEADER_TITLES[lang]);
      for (const width of HEADER_WIDTHS) {
        await page.setViewportSize({ width, height: 600 });
        // Web フォントが後から入ると幅が変わるので、読み込みが落ち着いてから測る
        await page.evaluate(() => document.fonts.ready);
        await assertHeaderLayout(page, `${base.name}/galleryHeader ${lang} ${width}px`, width);
      }

      // 一番狭い幅で実際に押す。言語を切り替えると見出しとボタンの幅が変わるので、その後も測り直す
      const narrow = `${base.name}/galleryHeader ${lang} 375px`;
      const other = lang === 'ja' ? 'en' : 'ja';
      await page.locator(`.header-actions [data-lang-set="${other}"]`).click();
      await page.waitForFunction((title) => document.querySelector('.header h1')?.textContent === title, HEADER_TITLES[other]);
      await assertHeaderLayout(page, `${narrow} (${other} へ切り替えた後)`, 375);
      const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('.header-actions a[href$="/slideshow"]').click(),
      ]);
      await popup.waitForURL('**/slideshow');
      await popup.close();
      await page.locator('.header-actions a[href$="/venue"]').click();
      await page.waitForFunction(() => location.pathname === '/venue');
      assert.deepEqual(errors, [], `${narrow}: browser errors`);
      console.log(`${base.name}/galleryHeader ${lang}: PASS`);
    } finally { await context.close(); }
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] });
try {
  for (const config of ['vite.config.ts', 'apps/web/vite.config.ts']) {
    const hosted = config.startsWith('apps/'), name = hosted ? 'hosted' : 'gallery';
    const server = await createServer({ configFile: resolve(root, config), root: hosted ? resolve(root, 'apps/web') : root,
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: null, hmr: false, allowedHosts: [INSECURE_HOST] }, logLevel: 'error' });
    try {
      await server.listen();
      const base = { name, url: `http://127.0.0.1:${server.httpServer.address().port}` };
      for (const [caseName, run] of Object.entries(cases)) {
        if (process.env.ROUTES_CASE && process.env.ROUTES_CASE !== caseName) continue;
        const env = await setup(browser, base);
        try {
          await run(env);
          assert.deepEqual(env.errors, [], `${name}/${caseName}: browser errors`);
          console.log(`${name}/${caseName}: PASS`);
        } finally { await env.context.close(); }
      }
      if (!process.env.ROUTES_CASE || process.env.ROUTES_CASE === 'insecureOrigin') await insecureOrigin(browser, base);
      if (!process.env.ROUTES_CASE || process.env.ROUTES_CASE === 'galleryHeader') await galleryHeader(browser, base);
    } finally { await server.close(); }
  }
} finally { await browser.close(); }
