// Estado Global do Frontend
window.isQuerying = false;
window.isPaused = false;
window.currentNsu = 0;
window.maxNsu = 0;
window.totalDownloaded = 0;
window.activeQueryRunId = 0;
window.queryLoopTimer = null;
window.selectedFile = null;
window.certificates = [];
window.units = [];
window.activeCertificateId = null;
window.authConfig = { authRequired: false, supabaseUrl: null, publishableKey: null };
window.authSession = null;

// Crawler State
window.crawlerQueue = [];
window.crawlerVisited = new Set();
window.isCrawlerActive = false;
window.currentCrawlerCnpj = '';

async function initializeAuthenticatedApp() {
  await window.AppApi.loadAuthConfig();

  if (!window.authConfig.authRequired) {
    if (window.appLayout) window.appLayout.style.display = 'flex';
    if (window.authScreen) window.authScreen.style.display = 'none';
    window.AppSyncController.checkCertStatus();
    if (window.loadSchedulerSettings) window.loadSchedulerSettings();
    window.AppUi.updateProgress(0, 0);
    window.selectEnvironment.dispatchEvent(new Event('change'));
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
  window.AppSyncController.checkCertStatus();
  if (window.loadSchedulerSettings) window.loadSchedulerSettings();
  window.AppUi.updateProgress(0, 0);
  window.selectEnvironment.dispatchEvent(new Event('change'));
}

async function loadAllComponents() {
  const components = [
    { id: 'auth-screen-container', path: 'components/auth-screen.html' },
    { id: 'sidebar-container', path: 'components/sidebar.html' },
    { id: 'view-download-container', path: 'components/sync-panel.html' },
    { id: 'view-certificado-container', path: 'components/certificates-panel.html' },
    { id: 'view-regras-container', path: 'components/rules-panel.html' }
  ];

  for (const component of components) {
    const el = document.getElementById(component.id);
    if (el) {
      const res = await fetch(component.path);
      el.outerHTML = await res.text();
    }
  }
}

// Inicialização do Bootstrap
async function bootstrap() {
  await loadAllComponents();
  window.AppUi.initElements();
  window.AppEvents.bindEvents();
  await initializeAuthenticatedApp();
}

window.addEventListener('DOMContentLoaded', bootstrap);
