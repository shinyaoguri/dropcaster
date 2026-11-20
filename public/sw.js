// dropcaster Service Worker
//
// 6 つのキャッシュバケットに振り分ける:
//   shell    アプリ本体の HTML / JS / CSS / 画像 (same-origin の navigate + assets)
//   local    ローカル sketch (scope 相対の sketches/*, sketches.json)
//   op-meta  OpenProcessing API (/api/sketch/* / /code)
//   gist     GitHub Gist API (api.github.com/gists/* と、ホスト版の同一オリジン中継 /gist-api/*)
//   op-cdn   外部 CDN (cdn.jsdelivr.net 等) と asset proxy のレスポンス
//   runtime  上記いずれにも該当しない GET (大網)
//
// キャッシュ戦略は概ね:
//   navigate (top)    NetworkFirst → 失敗時は cached '/' (scope ルートの応答だけを '/' に保存)
//   navigate (作品)   scope 内 sketches/ の iframe 等: 自分の URL で LOCAL に SWR
//   navigate (他)     上記以外の iframe 等: ネットのみ → 失敗時は自分の URL のキャッシュか 503
//   shell (assets)    CacheFirst (URL に hash が乗っているので immutable 扱い)
//   local catalog     StaleWhileRevalidate
//   op-meta           CacheFirst (24h 後にネット往復、それまでは即返し)
//   gist              NetworkFirst → 失敗時 cached (下記の理由で鮮度優先)
//   op-cdn            CacheFirst (URL に content hash が乗るので immutable)
//   runtime           StaleWhileRevalidate (ベストエフォート)
//
// gist だけ NetworkFirst なのは、OP の作品が実質固定なのに対し Gist は同じ ID の
// まま更新されるため (canvastage の「Share to Gist」は同じ Gist を PATCH で
// 上書きする)。作者が直して投影し直す動線を壊さないよう鮮度を優先し、
// キャッシュはオフライン時の保険として持つ。
//
// キャッシュ世代管理: 版 (CACHE_VERSION) を持つのは shell だけで、版を上げると activate で
// 古い shell を消す。中身のバケット (local / op-meta / gist / op-cdn / runtime) は版を持たず、
// 版をまたいで同じものを使う。デプロイでは中身を消さず、中身は各戦略の再取得 (SWR・NetworkFirst・
// op-meta の 24h) で新しくなる。消したいときは利用者がブラウザでサイトのデータを削除する (#164)。
// クォータ管理は browser に委ねる (HTTP cache のように LRU evict される)。
//
// このファイルは src/cli/utils/sw-template.js の正本。public/sw.js と
// apps/web/public/sw.js は scripts/sync-sw.js でここから生成される。

/* eslint-env serviceworker */
/* global self, caches, fetch, Response */

const CACHE_VERSION = 'v1';
const SHELL_PREFIX  = 'dropcaster-shell-';
const SHELL_CACHE   = `${SHELL_PREFIX}${CACHE_VERSION}`;
// 中身のバケットは版を持たない (上の「キャッシュ世代管理」)。新しい版は旧版のページが開いている間に入り、
// 閉じた時点で有効になるので、版ごとに分けて activate で消すと、閉じた後にオフラインで開いたとき
// 作品カタログなどが消えている (#164)。
const LOCAL_CACHE   = 'dropcaster-local';
const OP_META_CACHE = 'dropcaster-op-meta';
const GIST_CACHE    = 'dropcaster-gist';
const OP_CDN_CACHE  = 'dropcaster-op-cdn';
const RUNTIME_CACHE = 'dropcaster-runtime';
const CONTENT_CACHES = [LOCAL_CACHE, OP_META_CACHE, GIST_CACHE, OP_CDN_CACHE, RUNTIME_CACHE];

// 更新の適用時期: install では skipWaiting しない。新しい版はブラウザ標準のライフサイクルどおり、
// そのオリジンのタブ・ウィンドウがすべて閉じたときに有効になる (#164)。上演中に切り替えると
// 操作画面の再読み込みで出力ウィンドウが閉じ、activate で旧版のキャッシュも消えるため。
// 利用者が操作画面の通知で適用を選んだときだけ、ページから APPLY_UPDATE_MESSAGE が届く。
// SKIP_WAITING は受けない: この変更より前の版のページは、新しい版が installed になると自動で
// SKIP_WAITING を送って再読み込みしていたので、それに応じると移行時の上演が止まる。
const APPLY_UPDATE_MESSAGE = 'DC_APPLY_UPDATE';

// install 時にシェル (ルート HTML) と、シェルが読み込む資産を取りにいく。
// 新しい版の資産は、旧版のページが開いている間は誰も取りにいかない。install で揃えておかないと、
// 全ウィンドウを閉じて新しい版が有効になった後、オフラインで開いたときに JS / CSS が無く何も出ない (#164)。
//   必須  シェル HTML と、そこから辿った JS / CSS (CSS の url() を含む)。1 つでも取れなければ install を
//         失敗させる。新しい版は待機に入らず、旧版のまま動き続け、次の更新確認でやり直す
//   任意  manifest とアイコン (HTML の <link rel="manifest|icon|apple-touch-icon">)。無くてもアプリは
//         動くので、取れなくても install は続ける (アイコンを置いていないギャラリーで更新が止まらないように)
const SHELL_HTML = './';
const SHELL_OPTIONAL = ['./manifest.json'];
// 必須の資産の上限。超えたら辿り方の誤検出とみなし、install を失敗させる (黙って一部だけ入れない)
const SHELL_ASSET_LIMIT = 200;

// オフラインで navigate された時のフォールバック先 (キャッシュ済みの shell '/')
const OFFLINE_NAVIGATION_FALLBACK = new URL('./', self.registration.scope).toString();

// scope のパス (例: '/' や '/gallery/')。ローカル作品の判定をサブパス配信でも効かせるため、
// ルート前提の判定ではなくこれを基準にする。
const SCOPE_PATH = new URL(self.registration.scope).pathname;

// op-meta の鮮度。これより新しい cached レスポンスはネット往復をスキップ。
const OP_META_FRESH_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // dropcaster-* で始まるバケットだけ扱う (他アプリの cache を触らない)。
    // 版を上げたときに消すのは古い shell だけ。
    const oldShells = names.filter(name => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE);
    await migrateVersionedContentCaches(names);
    // 古い shell を消す前に、そこへ入っていた作品のファイルを LOCAL へ移す (#179)
    await rehomeSketchFiles(oldShells);
    await Promise.all(oldShells.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === APPLY_UPDATE_MESSAGE) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigate = req.mode === 'navigate';

  // ナビゲーション。'/' (OFFLINE_NAVIGATION_FALLBACK) にはアプリのシェルだけを入れる。
  // 作品 iframe も navigate なので、ここで振り分けないと作品の HTML がシェルを上書きし、
  // オフラインのホームに作品が出る (#105)。
  if (isNavigate) {
    if (sameOrigin && isLocalSketchPath(url)) {
      event.respondWith(sketchNavigationStrategy(req));
    } else if (req.destination === 'document') {
      event.respondWith(navigationStrategy(req));
    } else {
      event.respondWith(nestedNavigationStrategy(req));
    }
    return;
  }

  // 同一オリジン: パスで分岐
  if (sameOrigin) {
    // /op-cdn/* は dropcaster Worker が OpenProcessing CDN への proxy として返す。
    // URL に content hash (h<32hex>) が乗るので immutable 扱いで CacheFirst。
    if (url.pathname.startsWith('/op-cdn/')) {
      event.respondWith(cacheFirst(req, OP_CDN_CACHE));
      return;
    }
    // /gist-api/* は dropcaster Worker の GitHub Gist API 中継 (ホスト版)。
    // api.github.com 直と同じく NetworkFirst。下の SWR に落とすと、作者が
    // 直した後も古い Gist を返してしまう。
    if (url.pathname.startsWith('/gist-api/')) {
      event.respondWith(networkFirst(req, GIST_CACHE));
      return;
    }
    // local sketch 系 (scope 相対の sketches.json, sketches/*)。サブパス配信 (例 /gallery/sketches/*) でも
    // 作品の HTML (上の navigate) と同じ LOCAL に入れる (#179)
    if (isLocalSketchResource(url)) {
      event.respondWith(staleWhileRevalidate(req, LOCAL_CACHE));
      return;
    }
    // assets/ 配下と ico/manifest は CacheFirst (vite が hash 付きで吐く)。
    // サブパス配信 (例 /gallery/assets/*) も shell に載せる。install が事前キャッシュした
    // 資産 (precacheShellAssets) を、オフラインで引けるようにするため (#164)。
    // どちらも scope 相対で見る。scope の外の /assets/ や、作品以外の場所にある同名のファイル
    // (例 docs/manifest.json) を、版が変わるまで更新されない shell に入れない (#179)
    if (isScopeAsset(url) || isScopeShellFile(url)) {
      event.respondWith(cacheFirst(req, SHELL_CACHE));
      return;
    }
    // それ以外の same-origin GET は SWR で大網に入れる
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // OP API: openprocessing.org/api/sketch/...
  if (url.host === 'openprocessing.org' && url.pathname.startsWith('/api/')) {
    event.respondWith(opMetaStrategy(req));
    return;
  }

  // Gist API: api.github.com/gists/...
  if (url.host === 'api.github.com' && url.pathname.startsWith('/gists/')) {
    event.respondWith(networkFirst(req, GIST_CACHE));
    return;
  }

  // 外部 CDN (jsdelivr, fonts, deckard など) は CacheFirst。
  // URL に content hash が乗っている前提で immutable 扱い。
  if (isExternalImmutableCdn(url)) {
    event.respondWith(cacheFirst(req, OP_CDN_CACHE));
    return;
  }

  // それ以外のクロスオリジン GET は SWR (フォントなど)
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

// --- ストラテジ実装 ----------------------------------------------------------

// トップレベルの navigate。オフラインでは SPA のどのルートにもシェルを返す。
async function navigationStrategy(req) {
  try {
    const networkRes = await fetch(req);
    // scope ルートの navigate が成功したら shell キャッシュも更新しておく (オフライン時の fallback 用)。
    // ルートだけ: ユーザーの public/ にある別の HTML や画像を開いた応答もトップレベルの
    // navigate なので、URL を問わず保存するとオフラインのホームにそれが出る。
    // 2xx のみ: サーバの 404/500 ページで '/' の fallback を上書きすると、
    // 以後オフライン時にエラーページが出続けてしまう。
    if (networkRes.ok && isScopeRoot(new URL(req.url))) {
      const clone = networkRes.clone();
      caches.open(SHELL_CACHE).then(c => c.put(OFFLINE_NAVIGATION_FALLBACK, clone)).catch(() => {});
    }
    return networkRes;
  } catch {
    const fallback = await caches.match(OFFLINE_NAVIGATION_FALLBACK);
    if (fallback) return fallback;
    return offlineResponse();
  }
}

// ローカル作品の navigate (主に iframe)。サブリソースと同じく LOCAL に SWR で置き、
// オフラインで未キャッシュならシェルではなく 503 を返す。
async function sketchNavigationStrategy(req) {
  const res = await staleWhileRevalidate(req, LOCAL_CACHE);
  return res.status === 504 ? offlineResponse() : res;
}

// 作品以外の入れ子の navigate (iframe 等)。シェルの保存にも fallback にも使わない。
async function nestedNavigationStrategy(req) {
  try {
    return await fetch(req);
  } catch {
    return (await caches.match(req)) || offlineResponse();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (isCacheable(res)) {
    cache.put(req, res.clone()).catch(() => {});
  }
  return res;
}

// 更新されうるリソース向け。ネットを先に試し、失敗 (オフライン / DNS) のときだけ
// キャッシュへ落とす。レート制限の 403 のようなエラー応答は isCacheable が弾くので、
// 制限に当たっても直前の成功レスポンスが残り続ける。
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (isCacheable(res)) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkP = fetch(req).then(res => {
    if (isCacheable(res)) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => null);
  // cached を即返す。なければネット待ち。
  return cached || (await networkP) || new Response('', { status: 504 });
}

async function opMetaStrategy(req) {
  const cache = await caches.open(OP_META_CACHE);
  const cached = await cache.match(req);
  if (cached) {
    const ts = parseInt(cached.headers.get('x-dc-cached-at') || '0', 10);
    if (Date.now() - ts < OP_META_FRESH_MS) return cached;
    // 期限切れだけど stale を返しつつ裏で更新（失敗は無視 — unhandled rejection 防止）
    refreshOpMeta(req, cache).catch(() => {});
    return cached;
  }
  // 未キャッシュは普通にネット → 保存して返す
  return refreshOpMeta(req, cache);
}

async function refreshOpMeta(req, cache) {
  const res = await fetch(req);
  if (isCacheable(res)) {
    // タイムスタンプを header に焼いて新しい Response として保存
    const body = await res.clone().arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set('x-dc-cached-at', String(Date.now()));
    const stamped = new Response(body, { status: res.status, statusText: res.statusText, headers });
    cache.put(req, stamped.clone()).catch(() => {});
    return stamped;
  }
  return res;
}

// --- 更新 -------------------------------------------------------------------

// シェル HTML と、そこから辿れる資産を shell に入れる (上の SHELL_HTML の説明)。必須のものが
// 1 つでも取れなければ例外で install を失敗させ、この install で作った shell を消す。
async function precacheShell() {
  const existed = await caches.has(SHELL_CACHE);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const html = await fetchRequired(new Request(SHELL_HTML, { cache: 'reload' }), 'text/html');
    await cache.put(OFFLINE_NAVIGATION_FALLBACK, html.clone());
    const { required, optional } = refsInHtml(await html.text(), OFFLINE_NAVIGATION_FALLBACK);
    // 任意のもの: 取れなければ (SPA fallback の HTML が返っても) 入れずに続ける
    await Promise.all([...new Set([...SHELL_OPTIONAL.map(u => new URL(u, OFFLINE_NAVIGATION_FALLBACK).href), ...optional])]
      .map(url => fetchRequired(url, 'not-html').then(res => cache.put(url, res)).catch(() => undefined)));
    const queue = required;
    const seen = new Set();
    while (queue.length > 0) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      if (seen.size > SHELL_ASSET_LIMIT) throw new Error(`shell precache: more than ${SHELL_ASSET_LIMIT} assets`);
      const path = new URL(url).pathname;
      const res = await fetchRequired(url, path.endsWith('.js') || path.endsWith('.css') ? 'not-html' : null);
      if (path.endsWith('.js')) queue.push(...refsInScript(await res.clone().text(), url));
      else if (path.endsWith('.css')) queue.push(...refsInStyle(await res.clone().text(), url));
      await cache.put(url, res);
    }
  } catch (err) {
    // 一部だけ入った shell を残さない (同じ版を使っている有効な shell は消さない)
    if (!existed) await caches.delete(SHELL_CACHE);
    throw err;
  }
}

// 200 で、期待する種類の応答だけを受け取る。SPA fallback が欠けた資産の代わりに HTML を返しても
// 資産として入れない。
async function fetchRequired(req, expect) {
  const res = await fetch(req);
  const type = res.headers.get('Content-Type') || '';
  const isHtml = /text\/html/i.test(type);
  if (!isCacheable(res) || (expect === 'text/html' && !isHtml) || (expect === 'not-html' && isHtml)) {
    throw new Error(`shell precache: ${res.status} ${type} for ${typeof req === 'string' ? req : req.url}`);
  }
  return res;
}

// <script src> と <link rel="stylesheet|modulepreload" href> の JS / CSS は必須、
// <link rel="manifest|icon|apple-touch-icon"> は任意
function refsInHtml(html, baseUrl) {
  const required = [];
  const optional = [];
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = m[0];
    const ref = tag.match(/\s(?:src|href)=["']([^"']+)["']/i)?.[1];
    const url = ref && inScope(ref, baseUrl);
    if (!url) continue;
    const rel = tag.match(/\srel=["']([^"']+)["']/i)?.[1].toLowerCase() ?? '';
    if (/\.(?:js|css)$/.test(new URL(url).pathname)) required.push(url);
    else if (/(?:^|\s)(?:manifest|icon|apple-touch-icon)(?:\s|$)/.test(rel)) optional.push(url);
  }
  return { required, optional };
}

// バンドラが出すチャンク間の参照: import("./x.js") / from "./x.js" (チャンクからの相対) と、
// Vite の preload 依存の "assets/x.css" (base からの相対)
function refsInScript(code, scriptUrl) {
  const refs = [];
  for (const m of code.matchAll(/["'`](\.{1,2}\/[^"'`\s]+?\.(?:js|css))["'`]/g)) {
    const url = inScope(m[1], scriptUrl);
    if (url) refs.push(url);
  }
  for (const m of code.matchAll(/["'`](assets\/[^"'`\s]+?\.(?:js|css))["'`]/g)) {
    const url = inScope(m[1], OFFLINE_NAVIGATION_FALLBACK);
    if (url) refs.push(url);
  }
  return refs;
}

function refsInStyle(css, styleUrl) {
  const refs = [];
  for (const m of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
    if (m[1].startsWith('data:')) continue;
    const url = inScope(m[1], styleUrl);
    if (url) refs.push(url);
  }
  return refs;
}

function inScope(ref, baseUrl) {
  try {
    const url = new URL(ref, baseUrl);
    url.hash = '';
    return url.href.startsWith(self.registration.scope) ? url.href : null;
  } catch {
    return null;
  }
}

// 中身のバケットが版を持っていたころ (dropcaster-local-<版> など) の中身を、版の無い名前へ 1 回だけ移して
// 旧名を消す。runtime にあるサブパス配信の assets/ は移さない (いまは shell から引くので読まれずに残る)。
async function migrateVersionedContentCaches(names) {
  for (const current of CONTENT_CACHES) {
    for (const name of names.filter(n => n.startsWith(`${current}-`))) {
      await copyMissing(name, current, (req) => current !== RUNTIME_CACHE || !isScopeAsset(new URL(req.url)))
        .catch(() => {});
      await caches.delete(name);
    }
  }
}

async function copyMissing(fromName, toName, keep) {
  const [from, to] = await Promise.all([caches.open(fromName), caches.open(toName)]);
  for (const req of await from.keys()) {
    if (!keep(req) || await to.match(req)) continue;
    const res = await from.match(req);
    if (res) await to.put(req, res);
  }
}

// 振り分けがルート前提だったころ、サブパス配信の作品のファイルは LOCAL 以外に入っていた (#179):
//   - サブリソース (sketch.js など) は runtime
//   - 作品の中の manifest.json・icon.svg・favicon.ico・assets.json は shell (版ごとに消える)
// いまは LOCAL から引くので、有効化のときに LOCAL へ移す。逆に、scope の外の /sketches/ や、作品の外にある
// **/sketches.json は LOCAL に入っていたが、いまは runtime から引くので runtime へ移す。
// 中身のバケットは版をまたいで残るため、移さないと、更新後にオフラインで引けず、読まれないまま残る。
async function rehomeSketchFiles(oldShellNames) {
  const isLocal = (req) => isLocalSketchResource(new URL(req.url));
  // 先に移したものを残すので、開くたびに取り直される runtime を、取り直されない古い shell より先に移す
  await moveEntries(RUNTIME_CACHE, LOCAL_CACHE, isLocal);
  for (const name of oldShellNames) await moveEntries(name, LOCAL_CACHE, isLocal);
  await moveEntries(LOCAL_CACHE, RUNTIME_CACHE, (req) => !isLocal(req));
}

// from の中で pick に当たるものを to へ移す。to に既にあるものは上書きしない。
// 1 件の失敗 (容量の超過など) で残りを諦めない。失敗したものは from に残る。
async function moveEntries(fromName, toName, pick) {
  try {
    if (!(await caches.has(fromName))) return;
    const from = await caches.open(fromName);
    const picked = (await from.keys()).filter(pick);
    if (picked.length === 0) return;
    const to = await caches.open(toName);
    for (const req of picked) {
      try {
        if (!(await to.match(req))) {
          const res = await from.match(req);
          if (res) await to.put(req, res);
        }
        await from.delete(req);
      } catch {
        // この 1 件は from に残す
      }
    }
  } catch {
    // 移せなくても有効化は続ける
  }
}

// --- ヘルパ -----------------------------------------------------------------

function isCacheable(res) {
  if (!res) return false;
  // opaque (no-cors) も put 自体は可能だが、サイズが計上されてクォータ消費が大きいので
  // 明示的に basic / cors のみ受け入れる。
  if (res.status !== 200) return false;
  if (res.type === 'opaque' || res.type === 'opaqueredirect') return false;
  return true;
}

function isScopeRoot(url) {
  return url.origin === self.location.origin &&
    (url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`);
}

function isScopeAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(`${SCOPE_PATH}assets/`);
}

// scope 直下の manifest とアイコン
const SCOPE_SHELL_FILES = ['manifest.json', 'icon.svg', 'favicon.ico'];
function isScopeShellFile(url) {
  return url.origin === self.location.origin &&
    SCOPE_SHELL_FILES.some(name => url.pathname === `${SCOPE_PATH}${name}`);
}

function isLocalSketchPath(url) {
  return url.pathname.startsWith(`${SCOPE_PATH}sketches/`);
}

// ローカル作品のファイルと作品カタログ。scope 相対で見るので、ルート配信でもサブパス配信でも同じ判定になり、
// 同じオリジンに同居する scope の外のサイトの /sketches/ は拾わない (#179)
function isLocalSketchResource(url) {
  return url.origin === self.location.origin &&
    (isLocalSketchPath(url) || url.pathname === `${SCOPE_PATH}sketches.json`);
}

function offlineResponse() {
  return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

const IMMUTABLE_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  // deckard.openprocessing.org を直接叩く経路は通常無い (同一オリジン /op-cdn/ 経由)。
  // 古いユーザ template や proxy 未設定構成のフォールバックとして残す。
  'deckard.openprocessing.org',
]);

function isExternalImmutableCdn(url) {
  if (IMMUTABLE_CDN_HOSTS.has(url.host)) return true;
  // OP の S3 で使われる content hash パス (例: /h<32hex>/) を持つレスポンスは immutable 扱い
  return /\/h[0-9a-f]{20,}\//i.test(url.pathname);
}
