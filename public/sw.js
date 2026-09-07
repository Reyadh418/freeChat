const CACHE_NAME = 'freechat-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/variables.css',
  '/css/glass.css',
  '/css/main.css',
  '/css/imessage.css',
  '/js/crypto.js',
  '/js/api.js',
  '/js/socket.js',
  '/js/ui.js',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only cache GET requests, pass socket.io and API requests directly to network
  if (e.request.method !== 'GET' || e.request.url.includes('/socket.io/') || e.request.url.includes('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});

