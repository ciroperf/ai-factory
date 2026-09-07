/* Service worker minimo: rende l'app installabile e apribile offline.
 *
 * Regole:
 *  - il guscio (html/css/js/icone) sta in cache, cosi' l'app si apre subito;
 *  - config.json e tutto cio' che viene da GitHub NON viene mai messo in
 *    cache: uno stato vecchio spacciato per attuale sarebbe peggio di un
 *    errore di rete.
 */

const CACHE = 'officina-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;          // GitHub: sempre rete
  if (url.pathname.endsWith('config.json')) return;         // sempre fresco

  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
