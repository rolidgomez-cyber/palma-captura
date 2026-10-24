/* Guarda el formulario en el teléfono para que abra sin señal. */
const CACHE = 'captura-v1.0';
const ARCHIVOS = ['./', './index.html', './css/app.css?v=1.0', './config.js?v=1.0', './js/app.js?v=1.0',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // La hoja nunca se guarda en caché: siempre se pregunta en vivo
  if (/script\.google|googleusercontent/.test(url.hostname)) return;
  // Letra: se guarda la primera vez que se descarga
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      c.put(e.request, res.clone()); return res;
    }).catch(() => r))));
    return;
  }
  if (url.origin !== location.origin) return;
  // Archivos propios: primero la red (para recibir cambios), si no hay señal, lo guardado
  e.respondWith(fetch(e.request).then((res) => {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copia));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: false }).then((r) => r || caches.match('./index.html'))));
});
