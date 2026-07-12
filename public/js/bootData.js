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
  if (subtitleEl) subtitleEl.innerText = 'Resumo das cidades e total de XMLs persistidos';
  const crumb = document.getElementById('page-breadcrumb');
  if (crumb) crumb.textContent = 'Visão geral / Dashboard';

  await Promise.allSettled(tasks);
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
      await bootDataParallel();
      return;
    }

    // Sem config de Supabase no frontend → login impossível
    if (!window.authConfig.supabaseUrl || !window.authConfig.publishableKey) {
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

    await bootDataParallel();
  } finally {
    // Garante que o gate não fica pendurado se houver early return
    if (window.AppAuthGate) window.AppAuthGate.endBoot();
  }
}
