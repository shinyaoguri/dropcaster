import { promises as fs } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

export async function generateServiceWorker(config, outputDir) {
  // Generate unique cache name based on config
  const hash = crypto.createHash('md5')
    .update(config.title + Date.now())
    .digest('hex')
    .substring(0, 8);
  
  const cacheName = `dropcaster-${hash}`;
  
  const swContent = `
const CACHE_NAME = '${cacheName}';
const CACHE_STRATEGY = '${config.cache_strategy || 'network-first'}';
const OFFLINE_MODE = ${config.offline_mode !== false};
const OFFLINE_FALLBACK = new URL('index.html', self.registration.scope).toString();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        if (!OFFLINE_MODE) return undefined;
        return cache.add(OFFLINE_FALLBACK).catch(() => undefined);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return undefined;
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (!OFFLINE_MODE) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(OFFLINE_FALLBACK, responseClone);
          });
          return response;
        })
        .catch(() => caches.match(OFFLINE_FALLBACK))
    );
    return;
  }

  if (CACHE_STRATEGY === 'cache-first') {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetchAndCache(event.request);
        })
    );
    return;
  }

  event.respondWith(
    fetchAndCache(event.request)
      .catch(() => caches.match(event.request))
  );
});

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response && response.status === 200 && response.type === 'basic') {
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, responseClone);
      });
    }
    return response;
  });
}`;
  
  const swPath = join(outputDir, 'sw.js');
  await fs.writeFile(swPath, swContent, 'utf-8');
  
  return swPath;
}
