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

function withTimeout(promise, ms, label = 'operacao') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout em ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchText(path, timeoutMs = 12000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(path, {
      cache: 'no-cache',
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
    return await res.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadAllComponents() {
  const components = [
    { id: 'auth-screen-container', path: 'components/auth-screen.html' },
    { id: 'sidebar-container', path: 'components/sidebar.html' },
    { id: 'view-dashboard-container', path: 'components/dashboard-panel.html' },
    { id: 'view-download-container', path: 'components/sync-panel.html' },
    { id: 'view-certificado-container', path: 'components/certificates-panel.html' },
    { id: 'view-regras-container', path: 'components/rules-panel.html' }
  ];

  const results = await Promise.all(components.map(async (component) => {
    const el = document.getElementById(component.id);
    if (!el) return null;
    try {
      const html = await fetchText(component.path);
      return { el, html };
    } catch (err) {
      console.error('Falha ao carregar componente:', component.path, err);
      el.innerHTML = `<div style="padding:16px;color:#b91c1c;">Falha ao carregar ${component.path}</div>`;
      return null;
    }
  }));

  results.forEach(result => {
    if (result) result.el.outerHTML = result.html;
  });
}

function showBootError(message) {
  const existing = document.getElementById('boot-error');
  if (existing) {
    existing.textContent = message;
    return;
  }
  const box = document.createElement('div');
  box.id = 'boot-error';
  box.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0b0f19;color:#fff;font-family:system-ui,sans-serif;padding:24px;z-index:9999;text-align:center;';
  box.innerHTML = `<div><h2 style="margin:0 0 12px;">Falha ao iniciar</h2><p style="opacity:.85;max-width:420px;">${String(message || 'Erro desconhecido')}</p><button onclick="location.reload()" style="margin-top:16px;padding:10px 16px;border:0;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer;">Recarregar</button></div>`;
  document.body.appendChild(box);
}

async function initializeAuthenticatedApp() {
  try {
    await withTimeout(window.AppApi.loadAuthConfig(), 10000, 'auth-config');
  } catch (err) {
    console.error(err);
    // Sem config de auth: tenta abrir app local
    window.authConfig = window.authConfig || { authRequired: false };
  }

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
    try {
      if (window.AppSyncController?.checkCertStatus) {
        window.AppSyncController.checkCertStatus().catch(err => console.warn('checkCertStatus:', err));
      }
      if (window.loadSchedulerSettings) {
        Promise.resolve(window.loadSchedulerSettings()).catch(err => console.warn('scheduler:', err));
      }
      if (window.AppUi?.updateProgress) window.AppUi.updateProgress(0, 0);
      updateEnvBadge();

      // Garante dashboard visivel
      const dash = window.viewDashboardContent || document.getElementById('view-dashboard-content');
      const nav = window.navDashboard || document.getElementById('nav-dashboard');
      if (dash) {
        dash.style.display = 'block';
        dash.classList.add('active-tab', 'active');
      }
      if (nav && dash && window.AppUi?.switchTab) {
        window.AppUi.switchTab(nav, dash, 'Dashboard', 'Resumo de cidades e total de XMLs persistidos');
      } else if (window.AppSyncController?.loadDashboard) {
        window.AppSyncController.loadDashboard();
      }
    } catch (err) {
      console.error('bootData:', err);
    }
  };

  if (!window.authConfig.authRequired) {
    if (window.appLayout) window.appLayout.style.display = 'flex';
    if (window.authScreen) window.authScreen.style.display = 'none';
    bootData();
    return;
  }

  // Auth obrigatoria: valida sessao com timeout para nao travar a tela em branco
  const storedSession = window.AppUtils.loadStoredAuthSession();
  let user = null;
  try {
    user = await withTimeout(
      window.AppApi.validateAuthSession(storedSession),
      8000,
      'validate-session'
    );
  } catch (err) {
    console.warn('Sessao nao validada a tempo:', err.message);
    user = null;
  }

  if (!user) {
    window.AppUtils.clearAuthSession();
    if (window.AppUi?.showLogin) {
      window.AppUi.showLogin();
    } else {
      if (window.appLayout) window.appLayout.style.display = 'none';
      if (window.authScreen) window.authScreen.style.display = 'grid';
    }
    return;
  }

  if (window.AppUi?.showAuthenticatedApp) {
    window.AppUi.showAuthenticatedApp(user);
  } else {
    if (window.authScreen) window.authScreen.style.display = 'none';
    if (window.appLayout) window.appLayout.style.display = 'flex';
  }
  bootData();
}

async function bootstrap() {
  try {
    await loadAllComponents();
    window.AppUi.initElements();

    try {
      window.AppEvents.bindEvents();
    } catch (err) {
      console.error('bindEvents falhou (continuando boot):', err);
    }

    await initializeAuthenticatedApp();

    // Safety: se apos boot nada ficou visivel, mostra login ou app
    const authVisible = window.authScreen && window.authScreen.style.display !== 'none' && window.authScreen.offsetParent !== null;
    const appVisible = window.appLayout && window.appLayout.style.display !== 'none';
    if (!authVisible && !appVisible) {
      if (window.authConfig?.authRequired) {
        window.AppUi.showLogin();
      } else if (window.appLayout) {
        window.appLayout.style.display = 'flex';
      }
    }
  } catch (err) {
    console.error('bootstrap fatal:', err);
    showBootError(err.message || String(err));
  }
}

// defer scripts: se DOM ja estiver pronto, inicia na hora
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
