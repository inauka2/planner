// Service worker: precaches the whole app so it opens and works fully offline.
// To ship an update, change VERSION. Your data (IndexedDB) is never touched by updates.
const VERSION = '1.3.0';
const CACHE = `planner-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/backup.js',
  './js/db.js',
  './js/defaults.js',
  './js/icons.js',
  './js/ledger.js',
  './js/lock.js',
  './js/money.js',
  './js/store.js',
  './js/ui.js',
  './js/views/budget.js',
  './js/views/daily.js',
  './js/views/home.js',
  './js/views/lockscreen.js',
  './js/views/buy.js',
  './js/views/plan.js',
  './js/views/settings.js',
  './js/views/summary.js',
  './js/views/todo.js',
  './js/views/txsheet.js',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('planner-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the app never talks to other servers

  if (req.mode === 'navigate') {
    // App shell: always answer from cache so it opens offline.
    event.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req)),
  );
});
