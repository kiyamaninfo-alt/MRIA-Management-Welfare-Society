const CACHE_NAME = 'mria-welfare-v9';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/unauthorized.html',
  '/dashboard.html',
  '/admin.html',
  '/manifest.json',
  '/favicon.ico',
  '/assets/mria-logo.svg',
  '/assets/default-bank-qr.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/styles.css',
  '/assets/docs/constitution_si.pdf',
  '/assets/docs/constitution_en.pdf',
  '/js/config.js',
  '/js/i18n.js',
  '/js/auth.js',
  '/js/api.js',
  '/js/storage.js',
  '/js/receipt.js',
  '/js/ui.js',
  '/js/treasury-export.js',
  '/js/page-index.js',
  '/js/page-dashboard.js',
  '/js/page-admin.js',
  '/js/page-unauthorized.js'
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

  // Cache-First for web fonts and static images
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Network-First for HTML navigations and scripts
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
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
