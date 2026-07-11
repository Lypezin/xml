/* Service Worker — cache apenas CSS/JS estáticos (sem API/HTML) */
const CACHE = 'nfse-static-v1';
const PRECACHE = [
  '/css/variables.css',
  '/css/buttons.css',
  '/css/auth.css',
  '/css/layout.css',
  '/css/sidebar.css',
  '/css/metrics.css',
  '/css/components.css',
  '/css/certificates.css',
  '/css/table.css',
  '/css/responsive.css',
  '/js/utils.js',
  '/js/dataCache.js',
  '/js/panels-bundle.js',
  '/js/api.js',
  '/js/uiElements.js',
  '/js/uiTable.js',
  '/js/ui.js',
  '/js/syncController.js',
  '/js/eventsCert.js',
  '/js/events.js',
  '/app.js',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  const path = url.pathname;
  if (path.startsWith('/api/')) return false;
  if (path === '/' || path.endsWith('.html')) return false;
  return (
    path.startsWith('/css/') ||
    path.startsWith('/js/') ||
    path === '/app.js' ||
    path === '/favicon.svg' ||
    path.endsWith('.css') ||
    path.endsWith('.js')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Só same-origin estáticos
  if (url.origin !== self.location.origin) return;
  if (!isStaticAsset(url)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      // Stale-while-revalidate: devolve cache se houver, senão rede
      return cached || network;
    })
  );
});
