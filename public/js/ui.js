window.AppUi = {
  initElements() {
    window.authScreen = document.getElementById('auth-screen');
    window.appLayout = document.getElementById('app-layout');
    window.authForm = document.getElementById('auth-form');
    window.authEmail = document.getElementById('auth-email');
    window.authPassword = document.getElementById('auth-password');
    window.authSubmit = document.getElementById('auth-submit');
    window.authMessage = document.getElementById('auth-message');
    window.authUserEmail = document.getElementById('auth-user-email');
    window.btnLogout = document.getElementById('btn-logout');

    window.dropZone = document.getElementById('drop-zone-view');
    window.fileInput = document.getElementById('file-cert-view');
    window.fileNamePreview = document.getElementById('file-name-preview-view');
    window.formCert = document.getElementById('form-cert-view');
    window.passphraseInput = document.getElementById('passphrase-view');
    window.certCnpjInput = document.getElementById('cert-cnpj-view');
    window.certUploadState = document.getElementById('cert-upload-state-view');
    window.certActiveState = document.getElementById('cert-active-state-view');
    window.activeCertName = document.getElementById('active-cert-name-view');
    window.activeCertCnpj = document.getElementById('active-cert-cnpj-view');
    window.btnReplaceCert = document.getElementById('btn-replace-cert-view');
    window.btnDiagnoseCert = document.getElementById('btn-diagnose-cert-view');
    window.certList = document.getElementById('cert-list');
    window.certCountLabel = document.getElementById('cert-count-label');

    window.selectCertificate = document.getElementById('certificate-select');
    window.selectEnvironment = document.getElementById('environment');
    window.selectSearchMode = document.getElementById('search-mode');
    window.inputCnpjConsulta = document.getElementById('cnpj-consulta');
    window.inputStartNsu = document.getElementById('start-nsu');
    window.inputLimiteNotas = document.getElementById('limite-notas');
    window.btnStart = document.getElementById('btn-start');
    window.btnPause = document.getElementById('btn-pause');

    window.progressBar = document.getElementById('progress-bar');
    window.progressText = document.getElementById('progress-text');
    window.progressPercentage = document.getElementById('progress-percentage');
    window.statNsuAtual = document.getElementById('stat-nsu-atual');
    window.statNsuMax = document.getElementById('stat-nsu-max');
    window.statTotalNotas = document.getElementById('stat-total-notas');
    window.alertRateLimit = document.getElementById('alert-rate-limit');
    window.alertSyncSuccess = document.getElementById('alert-sync-success');
    window.crawlerStatusContainer = document.getElementById('crawler-status-container');
    window.crawlerCurrentCnpj = document.getElementById('crawler-current-cnpj');
    window.crawlerVisitedCount = document.getElementById('crawler-visited-count');
    window.crawlerQueueCount = document.getElementById('crawler-queue-count');
    window.consoleLog = document.getElementById('console-log');

    window.btnClearDownloads = document.getElementById('btn-clear-downloads');
    window.btnDownloadZip = document.getElementById('btn-download-zip');
    window.tableBody = document.getElementById('table-body');

    window.navDownload = document.getElementById('nav-download');
    window.navCertificado = document.getElementById('nav-certificado');
    window.navRegras = document.getElementById('nav-regras');

    window.viewDownloadContent = document.getElementById('view-download-content');
    window.viewCertificadoContent = document.getElementById('view-certificado-content');
    window.viewRegrasContent = document.getElementById('view-regras-content');

    window.pageTitle = document.getElementById('page-title');
    window.pageSubtitle = document.getElementById('page-subtitle');

    window.themeToggle = document.getElementById('theme-toggle');
    window.themeText = document.getElementById('theme-text');
    window.sunIcon = document.querySelector('.sun-icon');
    window.moonIcon = document.querySelector('.moon-icon');
  },

  log(message, type = 'system') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerText = `[${timestamp}] ${message}`;
    consoleLog.appendChild(line);
    consoleLog.scrollTop = consoleLog.scrollHeight;
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
    const emptyRow = document.getElementById('empty-row');
    if (emptyRow) emptyRow.remove();

    const mode = selectSearchMode ? selectSearchMode.value : 'asc';
    const orderedDocs = [...docs].sort((a, b) => {
      const aNsu = Number(a.nsu || 0);
      const bNsu = Number(b.nsu || 0);
      return mode === 'desc' ? bNsu - aNsu : aNsu - bNsu;
    });

    orderedDocs.forEach(doc => {
      const tr = document.createElement('tr');
      const valorFormatado = window.AppUtils.formatCurrency(doc.valorServico);

      tr.innerHTML = `
        <td>
          <strong>${doc.nsu}</strong>
          <div class="helper-text">${doc.tipo || 'N/A'}</div>
        </td>
        <td>
          <span class="tipo-badge ${doc.tipo.toLowerCase()}">${doc.tipo}</span>
          <span class="status-badge ${doc.status === 'Evento' ? 'event' : 'ok'}">${doc.status || 'Autorizada'}</span>
          <div class="helper-text">NFS-e: ${doc.numeroNfse || 'N/A'}</div>
          <div class="helper-text">DPS: ${doc.numeroDps || 'N/A'} / Série ${doc.serieDps || 'N/A'}</div>
        </td>
        <td><span class="cnpj-badge wrap">${doc.chave}</span></td>
        <td>
          <div><strong>Prestador</strong>: ${doc.prestadorNome || 'N/A'}</div>
          <div class="helper-text">CNPJ: ${doc.prestadorCnpj || 'N/A'}</div>
          <div style="height: 6px;"></div>
          <div><strong>Tomador</strong>: ${doc.tomadorNome || 'N/A'}</div>
          <div class="helper-text">CNPJ: ${doc.tomadorCnpj || 'Não cadastrado'}</div>
        </td>
        <td>
          <div class="descricao-texto expanded" title="${doc.descricao || 'N/A'}">${doc.descricao || 'N/A'}</div>
          <div class="helper-text">Município: ${doc.municipioPrestacao || 'N/A'}</div>
          <div class="helper-text">Cód. tributação: ${doc.codigoTributacao || 'N/A'}</div>
          <div class="helper-text">${doc.eventoMotivo && doc.eventoMotivo !== 'N/A' ? doc.eventoMotivo : doc.tributacaoNacional || ''}</div>
        </td>
        <td>
          <strong>${valorFormatado}</strong>
          <div class="helper-text">Emissão: ${doc.dataEmissao || 'N/A'}</div>
          <div class="helper-text">Competência: ${doc.competencia || 'N/A'}</div>
          <div class="helper-text">Processamento: ${doc.dataProcessamento || 'N/A'}</div>
        </td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-action="download-xml" data-token="${doc.token}" style="display:inline-flex; align-items:center; text-decoration:none; padding:4px 8px; gap: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>XML</span>
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    });
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
  }
};
