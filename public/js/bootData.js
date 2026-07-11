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
