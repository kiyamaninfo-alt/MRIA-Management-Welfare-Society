const CACHE_NAME = 'mria-welfare-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/unauthorized.html',
  '/dashboard.html',
  '/admin.html',
  '/manifest.json',
  '/assets/mria-logo.svg',
  '/assets/default-bank-qr.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/js/config.js',
  '/js/i18n.js',
  '/js/auth.js',
  '/js/api.js',
  '/js/storage.js',
  '/js/receipt.js',
  '/js/ui.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Financial write mutations (POST, PUT, PATCH, DELETE) must never be cached
  if (request.method !== 'GET') {
    return;
  }

  // Network-first strategy for navigation requests and Supabase REST reads, falling back to cache
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Cache successful responses for local static files
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          url.origin === self.location.origin
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If HTML navigation fails offline, fallback to cached dashboard or index
          if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/dashboard.html') || caches.match('/index.html');
          }
          return new Response('Offline: Resource not available in cache.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        });
      })
  );
});
