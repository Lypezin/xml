/* Service Worker — cache apenas CSS/JS estáticos (sem API/HTML) */
const CACHE = 'nfse-static-v2';
const PRECACHE = [
  '/css/variables.css',
  '/css/buttons.css',
  '/css/auth.css',
  '/css/layout-shell-a.css',
  '/css/layout-shell-b.css',
  '/css/layout-panels-a.css',
  '/css/layout-panels-b.css',
  '/css/sidebar.css',
  '/css/metrics.css',
  '/css/components.css',
  '/css/console.css',
  '/css/dashboard-cards.css',
  '/css/dashboard-skeletons.css',
  '/css/certificates.css',
  '/css/table-list.css',
  '/css/table-item.css',
  '/css/responsive-a.css',
  '/css/responsive-b.css',
  '/js/utils.js',
  '/js/dataCache.js',
  '/js/panels-bundle.js',
  '/js/apiAuth.js',
  '/js/apiCerts.js',
  '/js/apiData.js',
  '/js/apiDownloads.js',
  '/js/uiElements.js',
  '/js/uiTableCore.js',
  '/js/uiTableLoading.js',
  '/js/uiTableRender.js',
  '/js/uiCore.js',
  '/js/uiCerts.js',
  '/js/uiProgress.js',
  '/js/uiTabs.js',
  '/js/unitsController.js',
  '/js/historyController.js',
  '/js/certStatusController.js',
  '/js/syncController.js',
  '/js/queryLoop.js',
  '/js/dashboardController.js',
  '/js/eventsCert.js',
  '/js/eventsAuth.js',
  '/js/eventsSync.js',
  '/js/eventsTable.js',
  '/js/eventsFilters.js',
  '/js/eventsNsu.js',
  '/js/eventsNav.js',
  '/js/eventsScheduler.js',
  '/js/events.js',
  '/js/bootComponents.js',
  '/js/bootData.js',
  '/js/boot.js',
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

      return cached || network;
    })
  );
});
