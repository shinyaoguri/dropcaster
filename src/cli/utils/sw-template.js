// dropcaster Service Worker
//
// 5 つのキャッシュバケットに振り分ける:
//   shell    アプリ本体の HTML / JS / CSS / 画像 (same-origin の navigate + assets)
//   local    ローカル sketch (/sketches/*, /sketches.json)
//   op-meta  OpenProcessing API (/api/sketch/* / /code)
//   op-cdn   外部 CDN (cdn.jsdelivr.net 等) と asset proxy のレスポンス
//   runtime  上記いずれにも該当しない GET (大網)
//
// キャッシュ戦略は概ね:
//   navigate          NetworkFirst → 失敗時は cached '/'
//   shell (assets)    CacheFirst (URL に hash が乗っているので immutable 扱い)
//   local catalog     StaleWhileRevalidate
//   op-meta           CacheFirst (24h 後にネット往復、それまでは即返し)
//   op-cdn            CacheFirst (URL に content hash が乗るので immutable)
//   runtime           StaleWhileRevalidate (ベストエフォート)
//
// キャッシュ世代管理: CACHE_VERSION を変えれば古い bucket を activate 時に一掃。
// クォータ管理は browser に委ねる (HTTP cache のように LRU evict される)。
//
// このファイルは src/cli/utils/sw-template.js の正本。public/sw.js と
// apps/web/public/sw.js は scripts/sync-sw.js でここから生成される。

/* eslint-env serviceworker */
/* global self, caches, fetch, Response */

const CACHE_VERSION = 'v1';
const SHELL_CACHE   = `dropcaster-shell-${CACHE_VERSION}`;
const LOCAL_CACHE   = `dropcaster-local-${CACHE_VERSION}`;
const OP_META_CACHE = `dropcaster-op-meta-${CACHE_VERSION}`;
const OP_CDN_CACHE  = `dropcaster-op-cdn-${CACHE_VERSION}`;
const RUNTIME_CACHE = `dropcaster-runtime-${CACHE_VERSION}`;

const ALL_CACHES = [SHELL_CACHE, LOCAL_CACHE, OP_META_CACHE, OP_CDN_CACHE, RUNTIME_CACHE];

// install 時に最低限のシェル (ルート HTML) を取りにいく。/assets/* はハッシュ付きなので
// 実際のリクエストが来てから cache-first で取り込む。
const SHELL_PRECACHE = [
  './',
  './manifest.json',
];

// オフラインで navigate された時のフォールバック先 (キャッシュ済みの shell '/')
const OFFLINE_NAVIGATION_FALLBACK = new URL('./', self.registration.scope).toString();

// op-meta の鮮度。これより新しい cached レスポンスはネット往復をスキップ。
const OP_META_FRESH_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_PRECACHE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => {
      // dropcaster-* で始まる古いバケットだけ捨てる (他アプリの cache を触らない)
      if (name.startsWith('dropcaster-') && !ALL_CACHES.includes(name)) {
        return caches.delete(name);
      }
      return undefined;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigate = req.mode === 'navigate';

  // ナビゲーション: NetworkFirst → 失敗時 cached '/' fallback
  if (isNavigate) {
    event.respondWith(navigationStrategy(req));
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
    // local sketch 系 (/sketches.json, /sketches/*)
    if (matchSegment(url.pathname, 'sketches')) {
      event.respondWith(staleWhileRevalidate(req, LOCAL_CACHE));
      return;
    }
    // assets/ 配下と ico/manifest は CacheFirst (vite が hash 付きで吐く)
    if (
      matchSegment(url.pathname, 'assets') ||
      url.pathname.endsWith('/manifest.json') ||
      url.pathname.endsWith('/icon.svg') ||
      url.pathname.endsWith('/favicon.ico')
    ) {
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

async function navigationStrategy(req) {
  try {
    const networkRes = await fetch(req);
    // navigate が成功したら shell キャッシュも更新しておく (オフライン時の fallback 用)。
    // 2xx のみ: サーバの 404/500 ページで '/' の fallback を上書きすると、
    // 以後オフライン時にエラーページが出続けてしまう。
    if (networkRes.ok) {
      const clone = networkRes.clone();
      caches.open(SHELL_CACHE).then(c => c.put(OFFLINE_NAVIGATION_FALLBACK, clone)).catch(() => {});
    }
    return networkRes;
  } catch {
    const fallback = await caches.match(OFFLINE_NAVIGATION_FALLBACK);
    if (fallback) return fallback;
    return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
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

// --- ヘルパ -----------------------------------------------------------------

function isCacheable(res) {
  if (!res) return false;
  // opaque (no-cors) も put 自体は可能だが、サイズが計上されてクォータ消費が大きいので
  // 明示的に basic / cors のみ受け入れる。
  if (res.status !== 200) return false;
  if (res.type === 'opaque' || res.type === 'opaqueredirect') return false;
  return true;
}

function matchSegment(pathname, segment) {
  return pathname === `/${segment}` || pathname === `/${segment}/` ||
         pathname.startsWith(`/${segment}/`) || pathname.endsWith(`/${segment}.json`);
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
