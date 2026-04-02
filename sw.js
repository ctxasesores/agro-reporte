const CACHE = 'ctx-cartera-v1';
const ASSETS = [
  '/agro-reporte/',
  '/agro-reporte/index.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
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
  // Solo cachea el HTML principal, el resto va a la red
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/agro-reporte/index.html'))
    );
  }
  // Recursos externos (Supabase, Chart.js, etc.) siempre van a la red
});
