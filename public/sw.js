/* Service Worker — network-first para JS (evita auth/API quebrados por cache velho) */
const CACHE = 'nfse-static-v15';
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
  '/css/ops-screen.css',
  '/css/dashboard-premium.css',
  '/css/toast.css',
  '/css/rules-screen.css',
  '/css/mobile-shell.css',
  '/css/responsive-a.css',
  '/css/responsive-b.css',
  '/css/motion.css',
  '/css/insights.css',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  // Ativa imediatamente (não espera abas antigas)
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => null)
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  // JS: sempre network-first (auth/boot mudam com frequência)
  const isJs = url.pathname.endsWith('.js') || url.pathname.startsWith('/js/') || url.pathname === '/app.js';

  if (isJs) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          throw new Error('offline');
        })
    );
    return;
  }

  // CSS/assets: stale-while-revalidate
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

      return network.then((res) => res || cached);
    })
  );
});
