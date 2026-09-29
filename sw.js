/* =========================================================================
   SERVICE WORKER -- juego sin conexión
   -------------------------------------------------------------------------
   - Al instalarse guarda todos los archivos del juego (APP_FILES).
   - Archivos del juego: primero la red (siempre la versión más reciente si
     hay conexión) y, si no hay red, la copia guardada.
   - Tipografías de Google: se guardan la primera vez que se cargan y luego
     se sirven desde la copia (cambian muy poco).
   Si se añade un archivo nuevo al juego, hay que añadirlo a APP_FILES y
   subir CACHE_VERSION para que se guarde en la próxima visita.
   ========================================================================= */

const CACHE_VERSION = 'v1';
const APP_CACHE = `ajedrez-accesible-app-${CACHE_VERSION}`;
const FONT_CACHE = 'ajedrez-accesible-fuentes';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/styles.css',
  './js/vendor/chess.js',
  './js/pawn-battle.js',
  './js/clock.js',
  './js/accessibility.js',
  './js/feedback.js',
  './js/ai.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('ajedrez-accesible-app-') && k !== APP_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }
  if (url.origin === self.location.origin){
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request){
  const cache = await caches.open(APP_CACHE);
  try{
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch(e){
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Sin red y sin copia: para una página, se devuelve el juego guardado.
    if (request.mode === 'navigate'){
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try{
    const response = await fetch(request);
    // Las fuentes llegan como respuestas "opacas" (status 0): también se guardan.
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch(e){
    return new Response('', { status: 504, statusText: 'Sin conexión' });
  }
}
