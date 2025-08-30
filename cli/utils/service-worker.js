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
const urlsToCache = [
  '/',
  '/index.html',
  '/assets/index.js',
  '/assets/index.css',
  '/manifest.json',
  '/sketches.json'
];

// Configure cache strategy
const CACHE_STRATEGY = '${config.cache_strategy || 'network-first'}';
const OFFLINE_MODE = ${config.offline_mode !== false};

self.addEventListener('install', (event) => {
  if (OFFLINE_MODE) {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => {
          return cache.addAll(urlsToCache);
        })
    );
  } else {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (!OFFLINE_MODE) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  if (CACHE_STRATEGY === 'cache-first') {
    // Cache first, fallback to network
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          return fetch(event.request)
            .then((response) => {
              // Cache new resources
              if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseClone);
                });
              }
              return response;
            });
        })
    );
  } else {
    // Network first, fallback to cache
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  }
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});`;
  
  const swPath = join(outputDir, 'sw.js');
  await fs.writeFile(swPath, swContent, 'utf-8');
  
  return swPath;
}