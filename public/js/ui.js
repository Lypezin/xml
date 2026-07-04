// Visual Interface Controller

window.AppUi = {
  initElements() {
    window.AppUiElements.initElements();
  },

  log(message, type = 'system') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerText = `[${timestamp}] ${message}`;
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
    if (authScreen) authScreen.style.display = 'none';
    if (appLayout) appLayout.style.display = 'flex';
    if (authUserEmail) authUserEmail.textContent = user?.email || 'Sessão ativa';
  },

  showLogin() {
    if (appLayout) appLayout.style.display = 'none';
    if (authScreen) authScreen.style.display = 'grid';
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
    window.certificates.forEach(cert => {
      const item = document.createElement('div');
      item.className = `cert-list-item ${cert.id === window.activeCertificateId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="cert-list-main">
          <strong>${cert.filename}</strong>
          <span>CNPJ: ${cert.cnpj || 'Não informado'}</span>
        </div>
        <div class="cert-list-actions">
          <button class="btn btn-secondary btn-sm" data-action="select-cert" data-id="${cert.id}" ${cert.id === window.activeCertificateId ? 'disabled' : ''}>Usar</button>
          <button class="btn btn-secondary btn-sm" data-action="rename-cert" data-id="${cert.id}">Renomear</button>
          <button class="btn btn-secondary btn-sm text-danger" data-action="remove-cert" data-id="${cert.id}">Remover</button>
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

  switchTab(activeNav, activeContent, title, subtitle) {
    [navDownload, navCertificado, navRegras].forEach(nav => {
      if (nav) nav.classList.remove('active');
    });
    [viewDownloadContent, viewCertificadoContent, viewRegrasContent].forEach(content => {
      if (content) content.style.display = 'none';
    });

    if (activeNav) activeNav.classList.add('active');
    if (activeContent) activeContent.style.display = 'block';
    if (pageTitle) pageTitle.innerText = title;
    if (pageSubtitle) pageSubtitle.innerText = subtitle;
  },

  updateSchedulerUI(settings) {
    if (!schedulerEnabled) return;
    schedulerEnabled.checked = settings.autoSyncEnabled;
    schedulerInterval.value = settings.autoSyncIntervalHours || 12;
    schedulerEnv.value = settings.autoSyncEnvironment || 'producao';
    if (schedulerMaxBatches) schedulerMaxBatches.value = settings.autoSyncMaxBatchesPerRun || 1;
    if (schedulerDelaySeconds) schedulerDelaySeconds.value = settings.autoSyncDelaySeconds || 5;
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
