const CACHE_NAME = 'dropcaster-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/src/main.ts',
  '/src/style.css',
  '/manifest.json',
  '/vite.svg'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome extension requests and dev server requests
  if (event.request.url.includes('chrome-extension://') || 
      event.request.url.includes('/@vite') ||
      event.request.url.includes('/@fs') ||
      event.request.url.includes('/__vite') ||
      event.request.url.includes('/node_modules')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // For navigation requests (HTML pages), always fetch from network
        // This ensures SPA routing works correctly
        if (event.request.mode === 'navigate') {
          return fetch(event.request).catch(() => {
            // If offline, return cached index.html for any navigation
            return caches.match('/index.html');
          });
        }

        // For other resources, return cached response if found
        if (response) {
          return response;
        }

        // Clone the request
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Don't cache navigation requests or API calls
          const url = new URL(event.request.url);
          if (url.pathname.startsWith('/api/') || 
              url.pathname.endsWith('.json') ||
              event.request.mode === 'navigate') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          // Cache the response for future use
          caches.open(CACHE_NAME)
            .then((cache) => {
              // Only cache same-origin requests
              if (event.request.url.startsWith(self.location.origin)) {
                cache.put(event.request, responseToCache);
              }
            });

          return response;
        });
      })
      .catch(() => {
        // Offline fallback
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});