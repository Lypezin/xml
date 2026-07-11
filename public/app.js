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
  const components = [
    { id: 'auth-screen-container', path: 'components/auth-screen.html' },
    { id: 'sidebar-container', path: 'components/sidebar.html' },
    { id: 'view-dashboard-container', path: 'components/dashboard-panel.html' },
    { id: 'view-download-container', path: 'components/sync-panel.html' },
    { id: 'view-certificado-container', path: 'components/certificates-panel.html' },
    { id: 'view-regras-container', path: 'components/rules-panel.html' }
  ];

  // Todos em paralelo (mais rapido que cascata), mas so binda DEPOIS
  const results = await Promise.all(components.map(async (component) => {
    const el = document.getElementById(component.id);
    if (!el) return null;
    try {
      const res = await fetch(component.path, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${component.path}`);
      return { el, html: await res.text() };
    } catch (err) {
      console.error('Falha ao carregar componente:', component.path, err);
      return null;
    }
  }));

  results.forEach(result => {
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
    window.AppSyncController.checkCertStatus();
    if (window.loadSchedulerSettings) window.loadSchedulerSettings();
    window.AppUi.updateProgress(0, 0);
    updateEnvBadge();
    if (window.navDashboard && window.viewDashboardContent) {
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
  // 1) Carrega TODOS os HTMLs em paralelo
  await loadAllComponents();
  // 2) So entao mapeia DOM e binda eventos (elementos ja existem)
  window.AppUi.initElements();
  window.AppEvents.bindEvents();
  // 3) Auth + dados
  await initializeAuthenticatedApp();
}

window.addEventListener('DOMContentLoaded', bootstrap);
