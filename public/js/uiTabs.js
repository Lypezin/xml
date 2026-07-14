Object.assign(window.AppUi = window.AppUi || {}, {
switchTab(activeNav, activeContent, title, subtitle, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const skipData = Boolean(options.skipData);
    const now = Date.now();
    // Soft cache de aba: so forca rede se stale ou dirty (UI sempre troca na hora)
    const cacheTtlMs = 120000;

    const navs = [
      window.navDashboard || document.getElementById('nav-dashboard'),
      window.navDownload || document.getElementById('nav-download'),
      window.navCertificado || document.getElementById('nav-certificado'),
      window.navRegras || document.getElementById('nav-regras')
    ];
    const contents = [
      window.viewDashboardContent || document.getElementById('view-dashboard-content'),
      window.viewDownloadContent || document.getElementById('view-download-content'),
      window.viewCertificadoContent || document.getElementById('view-certificado-content'),
      window.viewRegrasContent || document.getElementById('view-regras-content')
    ];

    // Troca visual IMEDIATA (nunca espera rede)
    navs.forEach(nav => {
      if (nav) {
        nav.classList.remove('active');
        nav.removeAttribute('aria-current');
      }
    });
    contents.forEach(content => {
      if (content) {
        content.classList.remove('active-tab', 'active');
        content.style.display = 'none';
      }
    });

    if (activeNav) {
      activeNav.classList.add('active');
      activeNav.setAttribute('aria-current', 'page');
    }
    if (activeContent) {
      activeContent.style.removeProperty('display');
      requestAnimationFrame(() => {
        activeContent.classList.add('active-tab', 'active');
      });
    }
    const titleEl = window.pageTitle || document.getElementById('page-title');
    const subtitleEl = window.pageSubtitle || document.getElementById('page-subtitle');
    if (titleEl) titleEl.innerText = title;
    if (subtitleEl) subtitleEl.innerText = subtitle;

    window._tabCache = window._tabCache || {};
    const activeId = activeContent?.id || '';
    const crumb = document.getElementById('page-breadcrumb');
    if (crumb) {
      const section =
        activeId === 'view-dashboard-content' ? 'Visão geral' :
        activeId === 'view-download-content' ? 'Operação' :
        activeId === 'view-certificado-content' ? 'Operação' :
        activeId === 'view-regras-content' ? 'Sistema' : 'NFS-e Ops';
      crumb.textContent = `${section} / ${title || 'NFS-e Ops'}`;
    }

    // Boot/deep-link pode pintar a rota correta antes de carregar dados.
    if (skipData) return;

    // Dados em background (nao bloqueia pintura da aba)
    const schedule = (fn, urgent = false) => {
      if (urgent) {
        requestAnimationFrame(fn);
        return;
      }
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 400 });
      else setTimeout(fn, 0);
    };

    if (activeId === 'view-dashboard-content' && window.AppSyncController?.loadDashboard) {
      const lastDash = window._tabCache.dashboardAt || 0;
      const hasCards = Boolean(document.querySelector('#dashboard-cities-grid .city-card'));
      if (forceRefresh || !hasCards || !lastDash || now - lastDash > cacheTtlMs) {
        window._tabCache.dashboardAt = now;
        schedule(
          () => window.AppSyncController.loadDashboard(0, { forceRefresh }),
          forceRefresh || !hasCards
        );
      }
    }

    if (activeId === 'view-download-content' && window.AppSyncController) {
      const lastSync = window._tabCache.syncAt || 0;
      const lastNsu = window._tabCache.nsuAt || 0;
      const lastStorage = window._tabCache.storageAt || 0;
      const hasRows = Boolean(window.AppUiTable?.documents?.length);
      // Se o certificado da UI diverge do último carregado, força reload da lista
      const uiCertId = (window.selectCertificate && window.selectCertificate.value)
        || window.activeCertificateId
        || '';
      const certChanged = Boolean(uiCertId)
        && Boolean(window._lastHistoryCertId)
        && String(uiCertId) !== String(window._lastHistoryCertId);
      const needHistory = forceRefresh || certChanged || !hasRows || !lastSync
        || now - lastSync > cacheTtlMs || window._historyReloadDirty;
      const needNsu = forceRefresh || certChanged || !lastNsu || now - lastNsu > cacheTtlMs;
      const needStorage = forceRefresh || certChanged || !lastStorage || now - lastStorage > 300000;

      schedule(() => {
        const jobs = [];
        if (needHistory) {
          const wasDirty = Boolean(window._historyReloadDirty);
          window._tabCache.syncAt = now;
          window._historyReloadDirty = false;
          // Não manter linhas da cidade anterior quando o certificado mudou
          const keep = hasRows && !forceRefresh && !certChanged && !wasDirty;
          jobs.push(window.AppSyncController.loadPersistedHistory(1, {
            quiet: true,
            keepVisible: keep
          }));
        }
        if (needNsu) {
          window._tabCache.nsuAt = now;
          jobs.push(window.AppSyncController.loadSavedStartNsu());
        }
        if (jobs.length) Promise.allSettled(jobs);
        if (needStorage) {
          window._tabCache.storageAt = now;
          window.AppSyncController.loadStorageSummary();
        }
        window.AppInsights?.refreshOpsInsights?.();
      }, forceRefresh || certChanged || !hasRows);
    }

    if (activeId === 'view-dashboard-content' && window.AppInsights && !window.AppSyncController?.loadDashboard) {
      schedule(() => {
        window.AppInsights.refreshDashboardExtras([]).catch(() => {});
      });
    }
  },

  /** Prefetch de dados da aba (hover na nav) */
  prefetchTab(tabId) {
    if (!window.AppSyncController) return;
    if (tabId === 'view-dashboard-content' && window.AppApi?.fetchDashboardSummary) {
      window.AppApi.fetchDashboardSummary().catch(() => {});
    }
    if (tabId === 'view-download-content') {
      const hasRows = Boolean(window.AppUiTable?.documents?.length);
      if (!hasRows) {
        window.AppSyncController.loadPersistedHistory(1, { quiet: true, keepVisible: true }).catch(() => {});
      }
      window.AppSyncController.loadSavedStartNsu?.().catch(() => {});
    }
  },

  updateSchedulerUI(settings) {
    if (!schedulerEnabled) return;
    schedulerEnabled.checked = settings.autoSyncEnabled;
    schedulerInterval.value = settings.autoSyncIntervalHours || 12;
    schedulerEnv.value = settings.autoSyncEnvironment || 'producao';
    if (schedulerMaxBatches) schedulerMaxBatches.value = settings.autoSyncMaxBatchesPerRun || 1;
    if (schedulerDelaySeconds) schedulerDelaySeconds.value = 2;
    schedulerLastRun.innerText = settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : 'Nunca';
    schedulerStatus.innerText = 'Manual';
    schedulerStatus.className = 'metric-value text-primary';
  },

  updateManualSyncProgress(current, max, message) {
    if (!manualSyncProgressBar || !manualSyncProgressPercentage || !manualSyncProgressText) return;
    const safeCurrent = Number(current || 0);
    const safeMax = Number(max || 0);
    const percentage = safeMax > 0 ? Math.min(Math.round((safeCurrent / safeMax) * 100), 100) : 0;
    manualSyncProgressBar.style.width = `${percentage}%`;
    manualSyncProgressPercentage.innerText = `${percentage}%`;
    manualSyncProgressText.innerText = message || (safeMax > 0 ? `NSU ${safeCurrent} de ${safeMax}` : 'Aguardando atualização manual...');
  }
});
