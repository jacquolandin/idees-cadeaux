// =============================================================================
//  Service worker : met en cache la « coquille » de l'application pour un
//  démarrage rapide. Les données (Supabase) ne sont jamais mises en cache.
//  Changer VERSION à chaque mise à jour importante force le renouvellement.
// =============================================================================
const VERSION = 'idees-cadeaux-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './js/app.js',
  './js/api.js',
  './js/lib.js',
  './js/screens/welcome.js',
  './js/screens/events.js',
  './js/screens/event-form.js',
  './js/screens/event-detail.js',
  './js/screens/person-list.js',
  './js/screens/ideas-ui.js',
  './js/screens/my-ideas.js',
  './js/screens/idea-form.js',
  './js/screens/my-claims.js',
  './js/screens/profile.js',
];
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Bibliothèque supabase-js (version figée) : le cache d'abord
  if (req.url.startsWith(CDN)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  // Fichiers du site : le réseau d'abord (mises à jour immédiates), le cache sinon
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || caches.match('./index.html'))),
    );
  }
  // Tout le reste (Supabase) : comportement normal, jamais de cache
});
