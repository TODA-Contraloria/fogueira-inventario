// Service Worker - Fogueira Inventario PWA v0.1
const CACHE_NAME = 'fogueira-inv-v0.1';
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Instalar SW y cachear archivos base
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando v0.1');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cacheando archivos base');
      return cache.addAll(ARCHIVOS_CACHE);
    })
  );
  self.skipWaiting();
});

// Activar y limpiar caches viejos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys().then((nombres) => {
      return Promise.all(
        nombres.map((nombre) => {
          if (nombre !== CACHE_NAME) {
            console.log('[SW] Borrando cache viejo:', nombre);
            return caches.delete(nombre);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia: cache primero, luego red
self.addEventListener('fetch', (event) => {
  // Solo cachear peticiones GET
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request).then((respuesta) => {
      // Si está en cache, devuélvelo
      if (respuesta) {
        return respuesta;
      }
      // Si no, ve a la red
      return fetch(event.request).catch(() => {
        // Si red falla y es navegación, devolver index
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
