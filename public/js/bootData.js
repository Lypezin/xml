const BOOT_ROUTES = {
  '#dashboard': {
    navId: 'nav-dashboard',
    viewId: 'view-dashboard-content',
    title: 'Dashboard',
    subtitle: 'Resumo das cidades e total de XMLs persistidos'
  },
  '#xmls': {
    navId: 'nav-download',
    viewId: 'view-download-content',
    title: 'XMLs por unidade',
    subtitle: 'XMLs da NFS-e persistidos por certificado e unidade'
  },
  '#certificados': {
    navId: 'nav-certificado',
    viewId: 'view-certificado-content',
    title: 'Certificados',
    subtitle: 'Gerencie certificados A1 e nomes internos'
  },
  '#regras': {
    navId: 'nav-regras',
    viewId: 'view-regras-content',
    title: 'Regras ADN',
    subtitle: 'Limites de consulta e boas práticas da NFS-e Nacional'
  }
};

function normalizeBootRoute(hash = window.location.hash) {
  return BOOT_ROUTES[hash] ? hash : '#dashboard';
}

function activateInitialRoute() {
  const hash = normalizeBootRoute();
  const route = BOOT_ROUTES[hash];
  if (!window.location.hash || !BOOT_ROUTES[window.location.hash]) {
    window.history.replaceState({ tab: hash }, '', hash);
  }
  window.AppUi?.switchTab(
    document.getElementById(route.navId),
    document.getElementById(route.viewId),
    route.title,
    route.subtitle,
    { skipData: true }
  );
  return hash;
}

function finishBootSplash() {
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.classList.contains('is-hidden')) return;
  splash.classList.add('is-hidden');
  window.setTimeout(() => splash.remove(), 220);
}

function markBootRouteLoaded(route, now = Date.now()) {
  window._tabCache = window._tabCache || {};
  if (route === '#dashboard') {
    window._tabCache.dashboardAt = now;
  }
  if (route === '#xmls') {
    window._tabCache.syncAt = now;
    window._tabCache.nsuAt = now;
    window._tabCache.storageAt = now;
    window._historyReloadDirty = false;
  }
}

async function bootDataParallel(initialRoute = normalizeBootRoute()) {
  const certTask = (async () => {
    try {
      await window.AppSyncController.checkCertStatus({ skipSecondary: true });
    } catch (err) {
      console.warn('checkCertStatus:', err);
    }
  })();

  const schedulerTask = (async () => {
    try {
      if (window.loadSchedulerSettings) await window.loadSchedulerSettings();
    } catch (err) {
      console.warn('scheduler:', err);
    }
  })();

  let dashboardTask = Promise.resolve();
  const startedRoutes = new Set();
  if (initialRoute === '#dashboard' && window.AppSyncController?.loadDashboard) {
    markBootRouteLoaded('#dashboard');
    startedRoutes.add('#dashboard');
    dashboardTask = window.AppSyncController.loadDashboard().catch((err) => {
      console.warn('dashboard:', err);
    });
  }

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

  // A tela correta já está pintada; dados dependentes do certificado entram depois.
  await certTask;
  // O usuário pode navegar enquanto o certificado é verificado. Prioriza sempre
  // a tela que está ativa agora, sem deixar um deep link vazio ou carregar duplicado.
  const activeRoute = normalizeBootRoute(window.location.hash);
  const routeTasks = [];
  if (activeRoute === '#dashboard' && !startedRoutes.has('#dashboard') && window.AppSyncController?.loadDashboard) {
    markBootRouteLoaded('#dashboard');
    routeTasks.push(window.AppSyncController.loadDashboard().catch((err) => {
      console.warn('dashboard:', err);
    }));
  }
  if (activeRoute === '#xmls') {
    markBootRouteLoaded('#xmls');
    if (window.AppSyncController?.loadPersistedHistory) {
      routeTasks.push(window.AppSyncController.loadPersistedHistory(1, { quiet: true }));
    }
    if (window.AppSyncController?.loadSavedStartNsu) {
      routeTasks.push(window.AppSyncController.loadSavedStartNsu().catch(() => null));
    }
    if (window.AppSyncController?.loadStorageSummary) {
      routeTasks.push(window.AppSyncController.loadStorageSummary().catch(() => null));
    }
    if (window.AppInsights?.refreshOpsInsights) {
      routeTasks.push(window.AppInsights.refreshOpsInsights().catch(() => null));
    }
  }

  await Promise.allSettled([schedulerTask, dashboardTask, ...routeTasks]);
}

async function initializeAuthenticatedApp() {
  if (window.AppAuthGate) window.AppAuthGate.beginBoot();

  try {
    try {
      await withTimeout(window.AppApi.loadAuthConfig(), 8000, 'auth-config');
    } catch (err) {
      console.error(err);
      window.authConfig = window.authConfig || { authRequired: false };
    }

    if (!window.authConfig.authRequired) {
      if (typeof showAppShell === 'function') showAppShell();
      if (window.AppAuthGate) window.AppAuthGate.endBoot();
      const initialRoute = activateInitialRoute();
      finishBootSplash();
      await bootDataParallel(initialRoute);
      return;
    }

    // Sem config de Supabase no frontend → login impossível
    if (!window.authConfig.supabaseUrl || !window.authConfig.publishableKey) {
      finishBootSplash();
      if (window.AppUi?.showLogin) window.AppUi.showLogin();
      if (window.AppUi?.setAuthMessage) {
        window.AppUi.setAuthMessage(
          'Configuração de auth incompleta no servidor (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).',
          'error'
        );
      }
      return;
    }

    const storedSession = window.AppUtils.loadStoredAuthSession();

    if (!storedSession?.access_token) {
      finishBootSplash();
      if (window.AppUi?.showLogin) {
        window.AppUi.showLogin();
      } else if (window.authScreen) {
        window.authScreen.style.display = 'grid';
      }
      return;
    }

    // 1) Define sessão e VALIDA/RENOVA antes de qualquer chamada /api/*
    window.authSession = storedSession;
    if (window.authUserEmail && storedSession.user?.email) {
      window.authUserEmail.textContent = storedSession.user.email;
    }

    let user = null;
    try {
      user = await withTimeout(
        window.AppApi.validateAuthSession(storedSession),
        15000,
        'validate-session'
      );
    } catch (err) {
      console.warn('validate-session timeout/erro:', err.message);
      // tenta refresh direto
      try {
        const refreshed = await window.AppApi.refreshAuthSession(storedSession);
        if (refreshed?.access_token) {
          user = refreshed.user || { email: storedSession.user?.email || '' };
        }
      } catch (e2) {
        console.warn('refresh fallback falhou:', e2.message);
      }
    }

    if (!user) {
      window.AppUtils.clearAuthSession();
      finishBootSplash();
      if (window.AppUi?.showLogin) window.AppUi.showLogin();
      if (window.AppUi?.setAuthMessage) {
        window.AppUi.setAuthMessage('Sessão expirada. Faça login novamente.', 'error');
      }
      return;
    }

    // 2) Libera o gate e só depois carrega dados autenticados
    if (window.AppAuthGate) window.AppAuthGate.endBoot();

    if (typeof showAppShell === 'function') showAppShell();
    if (window.AppUi?.showAuthenticatedApp) {
      window.AppUi.showAuthenticatedApp(user);
    } else if (window.authUserEmail && user.email) {
      window.authUserEmail.textContent = user.email;
    }

    const initialRoute = activateInitialRoute();
    finishBootSplash();
    await bootDataParallel(initialRoute);
  } finally {
    // Garante que o gate não fica pendurado se houver early return
    if (window.AppAuthGate) window.AppAuthGate.endBoot();
  }
}
