// Visual Interface Controller

window.AppUi = {
  initElements() {
    window.AppUiElements.initElements();
  },

  log(message, type = 'system') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;

    let icon = '●';
    if (type === 'success') icon = '✔';
    if (type === 'warning') icon = '▲';
    if (type === 'error') icon = '✖';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.innerText = `[${timestamp}]`;

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `log-badge ${type}`;
    badgeSpan.innerText = icon;

    const textSpan = document.createElement('span');
    textSpan.className = 'log-text';
    textSpan.innerText = message;

    line.appendChild(timeSpan);
    line.appendChild(badgeSpan);
    line.appendChild(textSpan);

    if (window.consoleLog) {
      consoleLog.appendChild(line);
      consoleLog.scrollTop = consoleLog.scrollHeight;
    }
  },

  logNationalApiContext(nationalApi) {
    if (!nationalApi) return;
    this.log(`ADN: HTTP=${nationalApi.httpStatus || 'N/A'} | StatusProcessamento=${nationalApi.statusProcessamento || 'N/A'} | ambiente=${nationalApi.environment || 'N/A'} | cnpjConsulta=${nationalApi.cnpjConsulta || 'N/A'}`, 'warning');
    if (nationalApi.endpoint) {
      this.log(`ADN endpoint: ${nationalApi.endpoint}`, 'warning');
    }
    if (Array.isArray(nationalApi.errors) && nationalApi.errors.length > 0) {
      nationalApi.errors.forEach(err => {
        this.log(`ADN erro ${err.code || 'sem codigo'}: ${err.description || 'sem descricao'}`, 'error');
      });
    }
  },

  setAuthMessage(message, type = '') {
    if (!authMessage) return;
    authMessage.textContent = message || '';
    authMessage.className = `auth-message ${type}`.trim();
  },

  showAuthenticatedApp(user) {
    const screen = window.authScreen || document.getElementById('auth-screen');
    const layout = window.appLayout || document.getElementById('app-layout');
    const emailEl = window.authUserEmail || document.getElementById('auth-user-email');
    if (screen) screen.style.display = 'none';
    if (layout) layout.style.display = 'flex';
    if (emailEl) emailEl.textContent = user?.email || 'Sessão ativa';
  },

  showLogin() {
    const screen = window.authScreen || document.getElementById('auth-screen');
    const layout = window.appLayout || document.getElementById('app-layout');
    if (layout) layout.style.display = 'none';
    // auth-screen.html vem com display:none inline — forca grid
    if (screen) screen.style.setProperty('display', 'grid', 'important');
  },

  renderCertificateSelector() {
    if (!selectCertificate) return;

    selectCertificate.innerHTML = '';
    if (window.certificates.length === 0) {
      selectCertificate.innerHTML = '<option value="">Nenhum certificado cadastrado</option>';
      return;
    }

    window.certificates.forEach(cert => {
      const option = document.createElement('option');
      option.value = cert.id;
      option.textContent = `${cert.cnpj || 'CNPJ não informado'} - ${cert.filename}`;
      option.selected = cert.id === window.activeCertificateId;
      selectCertificate.appendChild(option);
    });
  },

  renderCertificateList() {
    if (!certList) return;

    if (certCountLabel) {
      certCountLabel.innerText = `${window.certificates.length} certificado${window.certificates.length === 1 ? '' : 's'}`;
    }

    if (window.certificates.length === 0) {
      certList.innerHTML = '<div class="empty-cert-list">Nenhum certificado cadastrado.</div>';
      return;
    }

    certList.innerHTML = '';
    const esc = window.AppUtils.escapeHtml;
    window.certificates.forEach(cert => {
      const item = document.createElement('div');
      item.className = `cert-list-item ${cert.id === window.activeCertificateId ? 'active' : ''}`;
      const safeId = esc(cert.id);
      item.innerHTML = `
        <div class="cert-list-main">
          <strong>${esc(cert.filename)}</strong>
          <span>CNPJ: ${esc(cert.cnpj || 'Não informado')}</span>
        </div>
        <div class="cert-list-actions">
          <button class="btn btn-secondary btn-sm" data-action="select-cert" data-id="${safeId}" ${cert.id === window.activeCertificateId ? 'disabled' : ''}>Usar</button>
          <button class="btn btn-secondary btn-sm" data-action="rename-cert" data-id="${safeId}">Renomear</button>
          <button class="btn btn-secondary btn-sm text-danger" data-action="remove-cert" data-id="${safeId}">Remover</button>
        </div>
      `;
      certList.appendChild(item);
    });
  },

  setBtnStartActive(active, isResume = false) {
    if (active) {
      btnStart.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        <span>Pausar Consulta</span>
      `;
      btnStart.className = 'btn btn-danger';
    } else {
      btnStart.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>${isResume ? 'Continuar Consulta' : 'Iniciar Consulta'}</span>
      `;
      btnStart.className = 'btn btn-success';
    }
  },

  updateCrawlerUI() {
    if (window.isCrawlerActive) {
      crawlerStatusContainer.style.display = 'block';
      crawlerCurrentCnpj.innerText = window.currentCrawlerCnpj || 'CNPJ do Certificado';
      crawlerVisitedCount.innerText = window.crawlerVisited.size;
      crawlerQueueCount.innerText = window.crawlerQueue.length;
    } else {
      crawlerStatusContainer.style.display = 'none';
    }
  },

  updateProgress(current, max) {
    if (max === 0) {
      progressBar.style.width = '0%';
      progressPercentage.innerText = '0%';
      progressText.innerText = 'Nenhuma nota disponível';
      return;
    }
    
    const percentage = Math.min(Math.round((current / max) * 100), 100);
    progressBar.style.width = `${percentage}%`;
    progressPercentage.innerText = `${percentage}%`;
    
    if (percentage >= 100) {
      progressText.innerText = 'Totalmente sincronizado';
    } else {
      progressText.innerText = `Sincronizando: NSU ${current} de ${max}`;
    }
  },

  appendDocumentsToTable(docs) {
    window.AppUiTable.appendDocumentsToTable(docs);
  },

  switchTab(activeNav, activeContent, title, subtitle, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
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
      if (nav) nav.classList.remove('active');
    });
    contents.forEach(content => {
      if (content) {
        content.classList.remove('active-tab', 'active');
        content.style.display = 'none';
      }
    });

    if (activeNav) activeNav.classList.add('active');
    if (activeContent) {
      activeContent.style.display = 'block';
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

    // Dados em background (nao bloqueia pintura da aba)
    const schedule = (fn) => {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 400 });
      else setTimeout(fn, 0);
    };

    if (activeId === 'view-dashboard-content' && window.AppSyncController?.loadDashboard) {
      const lastDash = window._tabCache.dashboardAt || 0;
      const hasCards = Boolean(document.querySelector('#dashboard-cities-grid .city-card'));
      if (forceRefresh || !hasCards || !lastDash || now - lastDash > cacheTtlMs) {
        window._tabCache.dashboardAt = now;
        schedule(() => window.AppSyncController.loadDashboard());
      }
    }

    if (activeId === 'view-download-content' && window.AppSyncController) {
      const lastSync = window._tabCache.syncAt || 0;
      const lastNsu = window._tabCache.nsuAt || 0;
      const lastStorage = window._tabCache.storageAt || 0;
      const hasRows = Boolean(window.AppUiTable?.documents?.length);
      const needHistory = forceRefresh || !hasRows || !lastSync || now - lastSync > cacheTtlMs || window._historyReloadDirty;
      const needNsu = forceRefresh || !lastNsu || now - lastNsu > cacheTtlMs;
      const needStorage = forceRefresh || !lastStorage || now - lastStorage > 300000;

      schedule(() => {
        const jobs = [];
        if (needHistory) {
          window._tabCache.syncAt = now;
          window._historyReloadDirty = false;
          jobs.push(window.AppSyncController.loadPersistedHistory(1, { quiet: true, keepVisible: hasRows }));
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
    manualSyncProgressText.innerText = message || (safeMax > 0 ? `NSU ${safeCurrent} de ${safeMax}` : 'Aguardando atualizacao manual...');
  }
};
