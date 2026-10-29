// Service worker nav Lyon bus : coquille de l'appli hors ligne, données lignes et tuiles en cache.
const VERSION = 'nav-lyon-bus-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/geo.js',
  'js/nav.js',
  'js/services.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const DATA = 'nav-lyon-bus-data-v1';
const TILES = 'nav-lyon-bus-tiles-v1';
const MAX_TILES = 600;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![VERSION, DATA, TILES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tuiles de carte : cache d'abord, rafraîchi en arrière-plan
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).then(() => trim(TILES, MAX_TILES));
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }

  if (url.origin !== location.origin) return; // Overpass etc. : réseau direct

  // Données lignes : réseau d'abord (mises à jour), repli sur le cache
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(DATA).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Coquille : cache d'abord
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
