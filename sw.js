/* ============================================================
   Context — Service Worker
   ------------------------------------------------------------
   ESTRATEGIA: network-first, cache solo como red de seguridad.

   POR QUE ASI Y NO CACHE-FIRST:
   Esta app muestra precios de mercado, posiciones y margenes.
   Un cache agresivo haria que el productor vea numeros viejos
   creyendo que son de hoy. Dato viejo sin aviso es peor que
   pantalla de "sin conexion".

   El SW existe por dos razones:
     1) Chrome/Android exige un SW con handler de fetch para
        disparar el prompt de instalacion (beforeinstallprompt).
     2) Dar un fallback digno cuando el productor esta en el
        campo sin senal.

   IMPORTANTE AL DEPLOYAR:
   Subir CACHE_VERSION en cada deploy del index.html.
   Si no lo subis, los usuarios que ya instalaron pueden quedar
   con el shell anterior en el fallback.
   ============================================================ */

const CACHE_VERSION = 'ctx-v14';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

// Solo el shell. Nada de datos.
const SHELL_ASSETS = [
  './',
  './index.html',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Todo lo que NUNCA debe cachearse: datos vivos.
const NUNCA_CACHEAR = [
  'version.json',        // el chequeo de version nueva: siempre a la red
  'supabase.co',
  'supabase.in',
  'api.anthropic.com',
  '/rest/v1/',
  '/auth/v1/',
  '/functions/v1/'
];

function esDatoVivo(url) {
  return NUNCA_CACHEAR.some(p => url.includes(p));
}

/* ---------- INSTALL ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        // Si falla el precache no bloqueamos la instalacion del SW.
        console.warn('[SW] precache incompleto:', err);
        return self.skipWaiting();
      })
  );
});

/* ---------- ACTIVATE: limpiar versiones viejas ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !k.startsWith(CACHE_VERSION))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- FETCH: network-first ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Solo GET. POST/PATCH van derecho a la red.
  if (req.method !== 'GET') return;

  // Datos vivos: red y nada mas. Sin fallback silencioso.
  if (esDatoVivo(req.url)) return;

  // Distinto origen (fuentes, CDNs): dejar pasar.
  if (!req.url.startsWith(self.location.origin)) return;

  // La página en sí (navegación) se pide revalidando con el servidor: sin esto,
  // fetch() respeta la cache HTTP del navegador (GitHub Pages cachea ~10 min) y
  // el usuario ve la version vieja. 'no-cache' revalida por ETag (304, liviano).
  //
  // OJO Safari: pedir una navegacion con init {cache} puede rechazar. Si eso
  // pasa, reintentamos con el pedido normal ANTES de caer al fallback de cache
  // (si no, serviriamos el shell viejo justamente cuando queremos el nuevo).
  const esPagina = req.mode === 'navigate';
  const pedirALaRed = () => {
    if (!esPagina) return fetch(req);
    // Plan B para navegadores que rechazan el init {cache} en una navegacion:
    // armamos un pedido nuevo con la misma URL, que si acepta 'no-cache'.
    // Igual revalida por ETag, asi que si no cambio nada responde 304.
    const alterno = () => fetch(new Request(req.url, {
      cache: 'no-cache', credentials: 'same-origin'
    }));
    let p;
    try { p = fetch(req, { cache: 'no-cache' }); }
    catch (e) { return alterno(); }
    return p.catch(() => alterno());
  };

  event.respondWith(
    pedirALaRed()
      .then(res => {
        // Guardamos copia fresca del shell para el fallback.
        if (res && res.status === 200 && res.type === 'basic') {
          const copia = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, copia));
        }
        return res;
      })
      .catch(() => {
        // Sin red: servimos lo ultimo que vimos.
        return caches.match(req).then(hit => {
          if (hit) return hit;
          // Navegacion sin cache: devolvemos el shell.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Sin conexion' });
        });
      })
  );
});

/* ---------- Permitir actualizacion forzada desde la app ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  // Responder que version esta corriendo (para diagnostico desde la consola).
  if (event.data === 'VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
