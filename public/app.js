// Estado Global do Frontend
window.isQuerying = false;
window.isPaused = false;
window.currentNsu = 0;
window.maxNsu = 0;
window.totalDownloaded = 0;
window.activeQueryRunId = 0;
window.queryLoopTimer = null;
window.transientRetryCount = 0;
window.selectedFile = null;
window.certificates = [];
window.units = [];
window.activeCertificateId = null;
window.authConfig = { authRequired: false, supabaseUrl: null, publishableKey: null };
window.authSession = null;
window._tabCache = { dashboardAt: 0, syncAt: 0, storageAt: 0, nsuAt: 0 };

// Crawler State
window.crawlerQueue = [];
window.crawlerVisited = new Set();
window.isCrawlerActive = false;
window.currentCrawlerCnpj = '';

async function loadAllComponents() {
  // Core primeiro (auth + sidebar + dashboard) para first paint mais rapido
  const core = [
    { id: 'auth-screen-container', path: 'components/auth-screen.html' },
    { id: 'sidebar-container', path: 'components/sidebar.html' },
    { id: 'view-dashboard-container', path: 'components/dashboard-panel.html' }
  ];
  const secondary = [
    { id: 'view-download-container', path: 'components/sync-panel.html' },
    { id: 'view-certificado-container', path: 'components/certificates-panel.html' },
    { id: 'view-regras-container', path: 'components/rules-panel.html' }
  ];

  const loadOne = async (component) => {
    const el = document.getElementById(component.id);
    if (!el) return null;
    const res = await fetch(component.path, { cache: 'force-cache' });
    const html = await res.text();
    return { el, html };
  };

  const coreResults = await Promise.all(core.map(loadOne));
  coreResults.forEach(result => {
    if (result) result.el.outerHTML = result.html;
  });

  // Secundarios em paralelo logo apos (nao bloqueia initElements do core se falhar)
  const secondaryResults = await Promise.all(secondary.map(loadOne));
  secondaryResults.forEach(result => {
    if (result) result.el.outerHTML = result.html;
  });
}

async function initializeAuthenticatedApp() {
  await window.AppApi.loadAuthConfig();

  const updateEnvBadge = () => {
    const selectEnv = window.selectEnvironment;
    if (!selectEnv) return;
    const envText = selectEnv.value === 'producao' ? 'Produção' : 'Homologação';
    const statAmbiente = document.getElementById('stat-ambiente');
    if (statAmbiente) {
      statAmbiente.innerText = envText;
      statAmbiente.className = selectEnv.value === 'producao'
        ? 'metric-value text-primary'
        : 'metric-value text-warning';
    }
  };

  const bootData = () => {
    // Fire-and-forget em paralelo (sem await em cadeia)
    window.AppSyncController.checkCertStatus();
    if (window.loadSchedulerSettings) window.loadSchedulerSettings();
    window.AppUi.updateProgress(0, 0);
    updateEnvBadge();
    if (window.navDashboard) {
      window.AppUi.switchTab(
        window.navDashboard,
        window.viewDashboardContent,
        'Dashboard',
        'Resumo de cidades e total de XMLs persistidos'
      );
    }
  };

  if (!window.authConfig.authRequired) {
    if (window.appLayout) window.appLayout.style.display = 'flex';
    if (window.authScreen) window.authScreen.style.display = 'none';
    bootData();
    return;
  }

  const storedSession = window.AppUtils.loadStoredAuthSession();
  const user = await window.AppApi.validateAuthSession(storedSession);
  if (!user) {
    window.AppUtils.clearAuthSession();
    window.AppUi.showLogin();
    return;
  }

  window.AppUi.showAuthenticatedApp(user);
  bootData();
}

async function bootstrap() {
  // Carrega core; inicia UI; carrega o resto em paralelo com auth
  const corePromise = (async () => {
    const core = [
      { id: 'auth-screen-container', path: 'components/auth-screen.html' },
      { id: 'sidebar-container', path: 'components/sidebar.html' },
      { id: 'view-dashboard-container', path: 'components/dashboard-panel.html' }
    ];
    const results = await Promise.all(core.map(async (component) => {
      const el = document.getElementById(component.id);
      if (!el) return null;
      const res = await fetch(component.path, { cache: 'force-cache' });
      return { el, html: await res.text() };
    }));
    results.forEach(r => { if (r) r.el.outerHTML = r.html; });
  })();

  await corePromise;
  window.AppUi.initElements();
  window.AppEvents.bindEvents();

  // Painéis secundarios + auth em paralelo
  const secondaryPromise = (async () => {
    const secondary = [
      { id: 'view-download-container', path: 'components/sync-panel.html' },
      { id: 'view-certificado-container', path: 'components/certificates-panel.html' },
      { id: 'view-regras-container', path: 'components/rules-panel.html' }
    ];
    const results = await Promise.all(secondary.map(async (component) => {
      const el = document.getElementById(component.id);
      if (!el) return null;
      const res = await fetch(component.path, { cache: 'force-cache' });
      return { el, html: await res.text() };
    }));
    results.forEach(r => { if (r) r.el.outerHTML = r.html; });
    // Re-scan DOM para elementos dos paineis novos
    window.AppUi.initElements();
  })();

  await Promise.all([initializeAuthenticatedApp(), secondaryPromise]);
}

window.addEventListener('DOMContentLoaded', bootstrap);
