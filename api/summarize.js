const CACHE = 'zyra-v3';
const ASSETS = ['/', '/manifest.json', '/icon.svg', '/og.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase Login Popup-ஐத் தடுக்க வேண்டாம்
  if (url.pathname.startsWith('/__/auth/') || url.pathname.startsWith('/__/firebase/')) {
    return;
  }

  // API calls → network only
  if (url.pathname.startsWith('/api/')) return;

  // HTML → network first
  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static → cache first
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
