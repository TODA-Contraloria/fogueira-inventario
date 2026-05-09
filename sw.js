// ====================================================
// FOGUEIRA PWA - Service Worker v0.4
// ----------------------------------------------------
// Estrategia:
//   - HTML: network-first (siempre la versión nueva si hay red)
//   - JS/CSS/imágenes: cache-first (rápido)
//   - API: pasa directo a la red (no se cachea)
// ====================================================

const CACHE_VERSION = 'fogueira-pwa-v0.4';
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './app.js',
  './api.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Instalar: cachear archivos base
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando ' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ARCHIVOS_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando ' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((nombres) => {
      return Promise.all(
        nombres
          .filter((n) => n !== CACHE_VERSION)
          .map((n) => {
            console.log('[SW] Borrando cache viejo:', n);
            return caches.delete(n);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: estrategias por tipo
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No interceptar peticiones a Apps Script (siempre red, sin cache)
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('googleusercontent.com')) {
    return;
  }

  // Solo GET
  if (event.request.method !== 'GET') return;

  // HTML: network-first (para que actualizaciones lleguen rápido)
  if (event.request.mode === 'navigate' || 
      event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((respuesta) => {
          // Guardar copia en cache
          const clon = respuesta.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clon));
          return respuesta;
        })
        .catch(() => caches.match(event.request)
          .then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // JS, CSS, imágenes: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((respuesta) => {
        // Solo cachear respuestas válidas del mismo origen
        if (respuesta && respuesta.status === 200 && respuesta.type === 'basic') {
          const clon = respuesta.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clon));
        }
        return respuesta;
      });
    })
  );
});

// Mensaje desde la app: forzar actualización
self.addEventListener('message', (event) => {
  if (event.data && event.data.tipo === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
