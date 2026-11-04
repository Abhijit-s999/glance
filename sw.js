/* Glance service worker: makes the site and reader work offline.
   Bump VERSION whenever you deploy so visitors pick up the new files. */
const VERSION = 'glance-2026-11-04-1';
const CORE = [
  './', 'index.html', 'read/', 'read/index.html', '404.html', 'manifest.webmanifest',
  'assets/glance.css', 'assets/site.css', 'assets/app.css',
  'assets/core.js', 'assets/site.js', 'assets/app.js',
  'assets/icon.svg', 'assets/icon-192.png', 'assets/apple-touch-icon.png',
  'assets/fonts/fonts.css',
  'assets/fonts/atkinson-hyperlegible-mono-latin-064fcb.woff2',
  'assets/fonts/atkinson-hyperlegible-mono-latin-ext-59c279.woff2',
  'assets/fonts/atkinson-hyperlegible-next-latin-066569.woff2',
  'assets/fonts/atkinson-hyperlegible-next-latin-ddbafd.woff2',
  'assets/fonts/atkinson-hyperlegible-next-latin-ext-0dade4.woff2',
  'assets/fonts/atkinson-hyperlegible-next-latin-ext-a79107.woff2',
  'assets/fonts/lexend-latin-2be22f.woff2',
  'assets/fonts/lexend-latin-ext-753ac0.woff2',
  'assets/fonts/literata-latin-a65693.woff2',
  'assets/fonts/literata-latin-ext-a8f67d.woff2',
  'assets/vendor/jszip.min.js', 'assets/vendor/pdf.min.js', 'assets/vendor/pdf.worker.min.js',
  'books/catalog.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('glance-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // pages: try the network first so updates show up, fall back to the saved copy offline
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('404.html'))));
    return;
  }
  // everything else: answer from the cache straight away and refresh it in the background
  e.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })));
});
