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
window._tabCache = { dashboardAt: 0, syncAt: 0, storageAt: 0, nsuAt: 0, dashboardData: null, historyData: null };

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

/**
 * Injeta paineis a partir do bundle embutido (sem 6 round-trips HTTP).
 * Fallback: fetch individual se bundle nao estiver disponivel.
 */
async function loadAllComponents() {
  const map = [
    'auth-screen-container',
    'sidebar-container',
    'view-dashboard-container',
    'view-download-container',
    'view-certificado-container',
    'view-regras-container'
  ];

  if (window.PANEL_HTML && typeof window.PANEL_HTML === 'object') {
    map.forEach(id => {
      const el = document.getElementById(id);
      const html = window.PANEL_HTML[id];
      if (el && html) el.outerHTML = html;
    });
    return;
  }

  // Fallback lento: 6 fetches em paralelo
  await Promise.all(map.map(async (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const file = {
      'auth-screen-container': 'components/auth-screen.html',
      'sidebar-container': 'components/sidebar.html',
      'view-dashboard-container': 'components/dashboard-panel.html',
      'view-download-container': 'components/sync-panel.html',
      'view-certificado-container': 'components/certificates-panel.html',
      'view-regras-container': 'components/rules-panel.html'
    }[id];
    try {
      const res = await fetch(file, { cache: 'force-cache' });
      if (res.ok) el.outerHTML = await res.text();
    } catch (err) {
      console.error('Falha componente', file, err);
    }
  }));
}

function showBootError(message) {
  const existing = document.getElementById('boot-error');
  if (existing) {
    const p = existing.querySelector('p');
    if (p) p.textContent = String(message || 'Erro desconhecido');
    return;
  }
  const box = document.createElement('div');
  box.id = 'boot-error';
  box.className = 'boot-error-overlay';
  const panel = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'Falha ao iniciar';
  const p = document.createElement('p');
  p.textContent = String(message || 'Erro desconhecido');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = 'Recarregar';
  btn.addEventListener('click', () => location.reload());
  panel.appendChild(h2);
  panel.appendChild(p);
  panel.appendChild(btn);
  box.appendChild(panel);
  document.body.appendChild(box);
}

function showAppShell() {
  if (window.authScreen) window.authScreen.style.display = 'none';
  if (window.appLayout) window.appLayout.style.display = 'flex';

  // Garante uma unica aba visivel no boot (evita dashboard + XMLs juntos no F5)
  const tabIds = [
    'view-dashboard-content',
    'view-download-content',
    'view-certificado-content',
    'view-regras-content'
  ];
  tabIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isDash = id === 'view-dashboard-content';
    el.classList.toggle('active-tab', isDash);
    el.classList.toggle('active', isDash);
    el.style.display = isDash ? 'block' : 'none';
  });

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navDash = document.getElementById('nav-dashboard');
  if (navDash) navDash.classList.add('active');
}

/**
 * Carrega dados iniciais em PARALELO (cert + units + dashboard).
 */
async function bootDataParallel() {
  const tasks = [];

  // Cert + units (sequencia interna leve, mas paralelo ao dashboard)
  tasks.push(
    (async () => {
      try {
        await window.AppSyncController.checkCertStatus({ skipSecondary: true });
      } catch (err) {
        console.warn('checkCertStatus:', err);
      }
    })()
  );

  tasks.push(
    (async () => {
      try {
        if (window.loadSchedulerSettings) await window.loadSchedulerSettings();
      } catch (err) {
        console.warn('scheduler:', err);
      }
    })()
  );

  tasks.push(
    (async () => {
      try {
        if (window.AppSyncController?.loadDashboard) {
          await window.AppSyncController.loadDashboard();
        }
      } catch (err) {
        console.warn('dashboard:', err);
      }
    })()
  );

  if (window.AppUi?.updateProgress) window.AppUi.updateProgress(0, 0);

  const selectEnv = window.selectEnvironment;
  if (selectEnv) {
    const envText = selectEnv.value === 'producao' ? 'Produção' : 'Homologação';
    const statAmbiente = document.getElementById('stat-ambiente');
    if (statAmbiente) {
      statAmbiente.innerText = envText;
      statAmbiente.className = selectEnv.value === 'producao'
        ? 'metric-value text-primary'
        : 'metric-value text-warning';
    }
  }

  // Marca nav dashboard
  const nav = window.navDashboard || document.getElementById('nav-dashboard');
  if (nav) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    nav.classList.add('active');
  }
  const titleEl = window.pageTitle || document.getElementById('page-title');
  const subtitleEl = window.pageSubtitle || document.getElementById('page-subtitle');
  if (titleEl) titleEl.innerText = 'Dashboard';
  if (subtitleEl) subtitleEl.innerText = 'Resumo de cidades e total de XMLs persistidos';

  await Promise.allSettled(tasks);
}

async function initializeAuthenticatedApp() {
  try {
    await withTimeout(window.AppApi.loadAuthConfig(), 8000, 'auth-config');
  } catch (err) {
    console.error(err);
    window.authConfig = window.authConfig || { authRequired: false };
  }

  if (!window.authConfig.authRequired) {
    showAppShell();
    await bootDataParallel();
    return;
  }

  // Otimista: se ha sessao local, mostra shell ja e valida em paralelo
  const storedSession = window.AppUtils.loadStoredAuthSession();
  if (storedSession?.access_token) {
    window.authSession = storedSession;
    showAppShell();
    if (window.authUserEmail && storedSession.user?.email) {
      window.authUserEmail.textContent = storedSession.user.email;
    }

    const [userResult] = await Promise.allSettled([
      withTimeout(window.AppApi.validateAuthSession(storedSession), 6000, 'validate-session'),
      bootDataParallel()
    ]);

    if (userResult.status === 'fulfilled' && userResult.value) {
      if (window.AppUi?.showAuthenticatedApp) {
        window.AppUi.showAuthenticatedApp(userResult.value);
      }
      return;
    }

    // Sessao invalida: limpa e pede login
    window.AppUtils.clearAuthSession();
    if (window.AppUi?.showLogin) window.AppUi.showLogin();
    return;
  }

  // Sem sessao
  if (window.AppUi?.showLogin) {
    window.AppUi.showLogin();
  } else if (window.authScreen) {
    window.authScreen.style.display = 'grid';
  }
}

async function bootstrap() {
  const t0 = performance.now();
  try {
    // Tema antes dos paineis (evita flash)
    if (window.AppUtils?.restoreTheme) window.AppUtils.restoreTheme();

    // 1) Painels do bundle (sincrono, instantaneo)
    await loadAllComponents();
    window.AppUi.initElements();
    if (window.AppUtils?.restoreTheme) window.AppUtils.restoreTheme();

    try {
      window.AppEvents.bindEvents();
    } catch (err) {
      console.error('bindEvents:', err);
    }

    // 2) Auth + dados
    await initializeAuthenticatedApp();

    console.info(`[boot] ready in ${Math.round(performance.now() - t0)}ms`);
  } catch (err) {
    console.error('bootstrap fatal:', err);
    showBootError(err.message || String(err));
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
