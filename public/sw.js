// Service worker : garde l'application en cache pour un rechargement sans réseau.
// Actif seulement en contexte sécurisé (localhost ou HTTPS).
const CACHE = 'table-v2';
const SHELL = ['/', '/css/sheet.css', '/css/app.css', '/app/main.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Les données de l'API dépendent du compte : jamais en cache (sauf 5etools, publiques et lourdes).
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/5e/')) return;
  if (url.pathname.startsWith('/ws')) return;
  // Réseau d'abord (le serveur est toujours à jour), cache en secours.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
