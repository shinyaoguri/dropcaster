// 非同期ルートの古い結果と、破棄済みコントローラーのリスナー復活を実 App / Router で確かめる (#106)。
//
// 外部取得 (Gist / OpenProcessing の API) と作品 HTML の応答を context.route で保留し、
// 完了の順をテストが決める。遷移は同一ドキュメント内の SPA 遷移 (リンクのクリックと
// history.back) で起こす。page.goto だとドキュメントごと作り直されて競合が消えるため。
// 本番コードには手を入れず、リスナーの数え上げだけ addInitScript で包む。
// 同じ Gist の差し替え経路で、作品の組み立てが script / CSS の意味を変えないことも確かめる (#110)。
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
  const context = await browser.newContext({ serviceWorkers: 'block' });
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const config of ['vite.config.ts', 'apps/web/vite.config.ts']) {
    const hosted = config.startsWith('apps/'), name = hosted ? 'hosted' : 'gallery';
    const server = await createServer({ configFile: resolve(root, config), root: hosted ? resolve(root, 'apps/web') : root,
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, watch: null, hmr: false }, logLevel: 'error' });
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
    } finally { await server.close(); }
  }
} finally { await browser.close(); }
