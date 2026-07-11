// Controle de Consultas e Estado do Certificado

window.AppSyncController = {
  beginQueryRun() {
    window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
    if (window.queryLoopTimer) {
      clearTimeout(window.queryLoopTimer);
      window.queryLoopTimer = null;
    }
    return window.activeQueryRunId;
  },

  isActiveQueryRun(runId) {
    return window.isQuerying && !window.isPaused && runId === window.activeQueryRunId;
  },

  isTransientSyncError(errorMessage = '') {
    return /timeout|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|Retorno vazio|Erro 200 retornado/i.test(String(errorMessage));
  },

  scheduleRetry(runId, requestNsu, errorMessage) {
    if (!this.isActiveQueryRun(runId)) return;
    window.transientRetryCount = (window.transientRetryCount || 0) + 1;
    const retryCount = window.transientRetryCount;

    if (retryCount > 6) {
      window.AppUi.log('Limite de tentativas temporarias atingido. Consulta pausada para evitar insistir na API.', 'error');
      this.stopQuerying();
      return;
    }

    const retryDelaySeconds = Math.min(120, 10 * retryCount);
    window.currentNsu = requestNsu;
    inputStartNsu.value = requestNsu;
    window.AppUi.log(`Erro temporario na API (${errorMessage}). Tentativa ${retryCount}/6 em ${retryDelaySeconds}s no mesmo NSU ${requestNsu}.`, 'warning');

    if (window.queryLoopTimer) clearTimeout(window.queryLoopTimer);
    window.queryLoopTimer = setTimeout(() => {
      window.queryLoopTimer = null;
      this.runQueryLoop(runId);
    }, retryDelaySeconds * 1000);
  },

  async loadStorageSummary() {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!window.AppApi?.fetchStorageSummary || !statStoragePayloads || !statStorageSize) return;

    try {
      const data = await window.AppApi.fetchStorageSummary({
        certificateId: certId || '',
        environment: selectEnvironment ? selectEnvironment.value : ''
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar armazenamento.');

      const summary = data.summary || {};
      statStoragePayloads.innerText = window.AppUtils.formatInteger(summary.totalPayloads || 0);
      statStorageSize.innerText = `${window.AppUtils.formatBytes(summary.totalBytes || 0)} permanentes`;
      if (Number(summary.expiringPayloads || 0) > 0) {
        statStorageSize.innerText += ` | ${window.AppUtils.formatInteger(summary.expiringPayloads)} com expiracao`;
      }
    } catch (err) {
      statStorageSize.innerText = 'Falha ao consultar';
      window.AppUi.log(`Erro ao carregar armazenamento: ${err.message}`, 'warning');
    }
  },

  getSelectedUnitFilter() {
    const selectedOption = unitFilter?.selectedOptions?.[0];
    return {
      partyCnpj: unitFilter ? unitFilter.value.trim() : '',
      partyRole: unitPartyRole ? unitPartyRole.value : 'tomador',
      unitId: selectedOption?.dataset?.id || ''
    };
  },

  renderUnitSelector() {
    if (!unitFilter) return;
    const currentValue = unitFilter.value;
    unitFilter.innerHTML = '<option value="">CNPJ do certificado ativo</option>';
    (window.units || []).forEach(unit => {
      const option = document.createElement('option');
      option.value = unit.cnpj || '';
      option.dataset.id = unit.id || '';
      option.dataset.name = unit.name || '';
      option.dataset.city = unit.city || '';
      option.dataset.state = unit.state || '';
      const location = [unit.city, unit.state].filter(Boolean).join('/');
      option.textContent = `${unit.name} - ${unit.cnpj}${location ? ` (${location})` : ''}`;
      unitFilter.appendChild(option);
    });
    unitFilter.value = currentValue;
    if (currentValue && unitFilter.value !== currentValue) unitFilter.value = '';
  },

  fillUnitFormFromSelection() {
    const option = unitFilter?.selectedOptions?.[0];
    if (!option || !unitFilter.value) {
      if (unitName) unitName.value = '';
      if (unitCnpj) unitCnpj.value = '';
      if (unitCity) unitCity.value = '';
      if (unitState) unitState.value = '';
      return;
    }
    if (unitName) unitName.value = option.dataset.name || '';
    if (unitCnpj) unitCnpj.value = unitFilter.value || '';
    if (unitCity) unitCity.value = option.dataset.city || '';
    if (unitState) unitState.value = option.dataset.state || '';
  },

  async loadUnits() {
    if (!window.AppApi?.listUnits) return;
    try {
      const data = await window.AppApi.listUnits();
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar unidades.');
      window.units = data.units || [];
      this.renderUnitSelector();
    } catch (err) {
      window.AppUi.log(`Erro ao carregar unidades: ${err.message}`, 'warning');
    }
  },

  _historySnapshotKey(certId, page, unitFilterParams) {
    const env = selectEnvironment ? selectEnvironment.value : 'producao';
    const mode = window.AppUtils?.getCancelledMode?.() || 'active';
    const search = historySearch ? historySearch.value.trim() : '';
    const party = unitFilterParams?.partyCnpj || '';
    return `hist_snap:${certId}|${env}|${mode}|${party}|${search}|p${page}`;
  },

  _restoreHistorySnapshot(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.documents)) return false;
      // snapshot valido por 10 min
      if (snap.at && Date.now() - snap.at > 600000) return false;
      window.AppUiTable.setDocuments(snap.documents, snap.total || 0, snap.page || 1, snap.totalValue || 0);
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = !(snap.documents && snap.documents.length > 0);
      return true;
    } catch (e) {
      return false;
    }
  },

  _saveHistorySnapshot(key, documents, total, page, totalValue) {
    try {
      sessionStorage.setItem(key, JSON.stringify({
        at: Date.now(),
        documents,
        total,
        page,
        totalValue
      }));
    } catch (e) {
      // quota / private mode
    }
  },

  async loadPersistedHistory(page = 1, options = {}) {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!certId || !window.AppApi?.listDocuments || !window.AppUiTable?.setDocuments) return;

    const requestId = (window._historyRequestId = (window._historyRequestId || 0) + 1);
    const quiet = Boolean(options.quiet);
    const keepVisible = Boolean(options.keepVisible);
    const hasRows = Boolean(window.AppUiTable.documents?.length);
    const safePage = Math.max(1, Number(page || 1));
    const unitFilterParams = this.getSelectedUnitFilter();
    const snapKey = this._historySnapshotKey(certId, safePage, unitFilterParams);

    // Paint instantaneo a partir do sessionStorage (antes da rede)
    if (!hasRows) {
      const restored = this._restoreHistorySnapshot(snapKey);
      if (!restored && !keepVisible && window.AppUiTable.showLoading) {
        window.AppUiTable.showLoading();
      }
    }

    const limit = window.AppUiTable.pageSize || 10;
    const listParams = {
      certificateId: certId,
      environment: selectEnvironment ? selectEnvironment.value : 'producao',
      cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
      partyCnpj: unitFilterParams.partyCnpj,
      partyRole: unitFilterParams.partyRole,
      search: historySearch ? historySearch.value.trim() : '',
      cancelledMode: window.AppUtils.getCancelledMode(),
      includeCancelled: window.AppUtils.getIncludeCancelledParam(),
      onlyCancelled: window.AppUtils.getOnlyCancelledParam(),
      limit,
      offset: (safePage - 1) * limit,
      skipTotals: true
    };

    try {
      // 1) Página primeiro (sem count/sum)
      const data = await window.AppApi.listDocuments(listParams);

      if (requestId !== window._historyRequestId) return;

      if (!data.success) {
        if (!quiet) window.AppUi.log(`Erro ao carregar histórico: ${data.error}`, 'warning');
        return;
      }

      const docs = data.documents || [];
      const totalsPending = data.totalsPending !== false && (data.total == null || data.summary?.totalValue == null);
      const totalValue = data.summary?.totalValue ?? data.totalValue ?? null;
      window.AppUiTable.setDocuments(docs, totalsPending ? null : (data.total || 0), safePage, totalValue, {
        totalsPending
      });
      if (window.btnDownloadZip) window.btnDownloadZip.disabled = !(docs && docs.length > 0);

      // 2) Totais em segundo request (stats cache no banco)
      if (totalsPending && window.AppApi.getDocumentTotals) {
        this._loadHistoryTotals(requestId, listParams, snapKey, docs, safePage, quiet, unitFilterParams);
      } else {
        this._saveHistorySnapshot(snapKey, docs, data.total || 0, safePage, totalValue || 0);
        if (!quiet) {
          const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
          window.AppUi.log(`Histórico carregado${unitLabel}: ${docs.length} de ${data.total || 0} XML(s) salvos.`, 'success');
        }
      }

      // 3) Prefetch página 2 (só na 1ª página, se veio cheia)
      if (safePage === 1 && docs.length >= limit) {
        this._prefetchHistoryPage(2, { ...listParams, offset: limit });
      }
    } catch (err) {
      if (requestId !== window._historyRequestId) return;
      if (!quiet) window.AppUi.log(`Erro ao carregar histórico: ${err.message}`, 'warning');
    }
  },

  async _loadHistoryTotals(requestId, listParams, snapKey, docs, safePage, quiet, unitFilterParams) {
    try {
      const { limit, offset, skipTotals, ...totalsParams } = listParams;
      const totals = await window.AppApi.getDocumentTotals(totalsParams);
      if (requestId !== window._historyRequestId) return;
      if (!totals?.success) return;
      const total = totals.total || 0;
      const totalValue = totals.totalValue ?? totals.summary?.totalValue ?? 0;
      if (window.AppUiTable.updateTotals) {
        window.AppUiTable.updateTotals(total, totalValue);
      } else {
        window.AppUiTable.setDocuments(docs, total, safePage, totalValue);
      }
      this._saveHistorySnapshot(snapKey, docs, total, safePage, totalValue);
      if (!quiet) {
        const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
        window.AppUi.log(`Histórico carregado${unitLabel}: ${docs.length} de ${total} XML(s) salvos.`, 'success');
      }
    } catch (err) {
      if (requestId !== window._historyRequestId) return;
      // Página já está ok; totais falharam silenciosamente
      if (!quiet) window.AppUi.log(`Totais ainda calculando: ${err.message}`, 'warning');
    }
  },

  _prefetchHistoryPage(page, listParams) {
    if (!window.AppApi?.listDocuments) return;
    const params = { ...listParams, skipTotals: true };
    // Dispara e deixa no cache do AppDataCache (mesma key da navegação)
    window.AppApi.listDocuments(params).catch(() => {});
  },

  async loadSavedStartNsu() {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const unitFilterParams = this.getSelectedUnitFilter();
    const cnpjConsulta = unitFilterParams.partyCnpj || (inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '');

    const data = await window.AppApi.fetchSyncState({
      environment: selectEnvironment ? selectEnvironment.value : 'producao',
      cnpjConsulta,
      certificateId: certId
    });

    const lastReceivedNsu = Number(data.state?.last_received_nsu || 0);
    const lastNsu = Number(data.state?.last_nsu || 0);
    const savedNsu = data.state ? lastNsu : lastReceivedNsu;
    inputStartNsu.value = savedNsu;
    window.currentNsu = savedNsu;
    window.maxNsu = Math.max(window.maxNsu || 0, savedNsu);
    statNsuAtual.innerText = String(savedNsu);
    statNsuMax.innerText = String(window.maxNsu || savedNsu);
    return savedNsu;
  },

  async checkCertStatus(options = {}) {
    const skipSecondary = Boolean(options.skipSecondary);
    try {
      // Cert + units em paralelo
      const [data, unitsResult] = await Promise.all([
        window.AppApi.fetchCertStatus(),
        window.AppApi.listUnits().catch(() => ({ success: false, units: [] }))
      ]);

      const indicator = document.getElementById('navbar-cert-indicator');
      const txt = document.getElementById('navbar-cert-text');
      window.certificates = data.certificates || [];
      window.activeCertificateId = data.activeCertificateId || null;

      if (unitsResult?.success) {
        window.units = unitsResult.units || [];
        this.renderUnitSelector();
      } else {
        await this.loadUnits();
      }

      window.AppUi.renderCertificateSelector();
      window.AppUi.renderCertificateList();

      if (data.active) {
        if (certUploadState) certUploadState.classList.remove('active');
        if (certActiveState) certActiveState.classList.add('active');
        if (activeCertName) activeCertName.innerText = `Arquivo: ${data.filename}`;
        if (activeCertCnpj) activeCertCnpj.innerText = `CNPJ: ${data.cnpj || 'Não informado'}`;
        if (btnStart) btnStart.disabled = false;
        if (window.btnResetNsu) window.btnResetNsu.disabled = false;
        if (!skipSecondary) window.AppUi.log(`Certificado ativo CNPJ: ${data.cnpj}`);
        if (indicator && txt) {
          indicator.className = 'status-indicator online';
          txt.innerText = `Certificado Ativo: ${data.cnpj}`;
        }
        if (!skipSecondary) {
          const syncVisible = window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none'
            && window.viewDownloadContent.classList.contains('active-tab');
          if (syncVisible) {
            await Promise.allSettled([
              this.loadPersistedHistory(1, { quiet: true }),
              this.loadSavedStartNsu(),
              this.loadStorageSummary()
            ]);
          }
        }
      } else {
        if (certUploadState) certUploadState.classList.add('active');
        if (certActiveState) certActiveState.classList.remove('active');
        if (btnStart) btnStart.disabled = true;
        if (window.btnResetNsu) window.btnResetNsu.disabled = true;
        if (!skipSecondary) window.AppUi.log('Nenhum certificado carregado.', 'warning');
        if (indicator && txt) {
          indicator.className = 'status-indicator offline';
          txt.innerText = `Nenhum certificado carregado`;
        }
      }
    } catch (err) {
      console.error('Erro ao verificar status:', err);
    }
  },

  async selectCertificateById(certificateId) {
    if (!certificateId) return;
    try {
      const data = await window.AppApi.selectCertificate(certificateId);
      if (!data.success) {
        window.AppUi.log(`Erro ao selecionar: ${data.error}`, 'error');
        return;
      }
      window.activeCertificateId = data.activeCertificateId;
      window.AppUi.log('Certificado selecionado.', 'success');
      this.checkCertStatus();
    } catch (err) {
      window.AppUi.log(`Erro ao selecionar: ${err.message}`, 'error');
    }
  },

  async discoverAndStart(runId = window.activeQueryRunId) {
    try {
      const env = selectEnvironment.value, cnpj = window.currentCrawlerCnpj, certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
      const data = await window.AppApi.discoverNsu({ environment: env, cnpjConsulta: cnpj, certificateId: certId });
      if (!this.isActiveQueryRun(runId)) return;
      
      if (data.success && data.maxNSU > 0 && data.reliableMax) {
        window.maxNsu = data.maxNSU;
        window.currentNsu = Math.max(0, window.maxNsu - 50);
        inputStartNsu.value = window.currentNsu;
        window.AppUi.log(`NSU máximo API: ${window.maxNsu}. Consultando a partir do NSU ${window.currentNsu}...`, 'success');
        this.runQueryLoop(runId);
      } else if (data.success) {
        if (data.maxNSU > 0) {
          window.maxNsu = data.maxNSU;
          window.currentNsu = Math.max(0, window.maxNsu - 50);
          inputStartNsu.value = window.currentNsu;
          window.AppUi.log(`Estimado ${window.maxNsu}. Consultando a partir de ${window.currentNsu}.`, 'warning');
          this.runQueryLoop(runId);
          return;
        }
        window.currentNsu = parseInt(inputStartNsu.value) || 0;
        window.AppUi.log('Sem maxNSU confiável. Seguirá sequência por NSU.', 'warning');
        this.runQueryLoop(runId);
      } else {
        window.AppUi.log('Erro ao descobrir NSU: ' + (data.error || 'Nenhum documento encontrado.'), 'error');
        window.AppUi.logNationalApiContext(data.nationalApi);
        this.stopQuerying();
      }
    } catch (err) {
      window.AppUi.log('Falha na descoberta de NSU: ' + err.message, 'error');
      this.stopQuerying();
    }
  },

  stopQuerying() {
    window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
    if (window.queryLoopTimer) {
      clearTimeout(window.queryLoopTimer);
      window.queryLoopTimer = null;
    }
    window.isQuerying = false;
    window.isPaused = false;
    window.AppUi.setBtnStartActive(false, false);
    btnPause.disabled = true;
    if (window.btnResetNsu) window.btnResetNsu.disabled = false;
  },

  async runQueryLoop(runId = window.activeQueryRunId) {
    if (!this.isActiveQueryRun(runId)) return;

    const env = selectEnvironment.value, cnpj = window.currentCrawlerCnpj, certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const limiteNotas = parseInt(inputLimiteNotas.value) || 0;
    const requestNsu = Number(window.currentNsu || 0);

    if (!certId) {
      window.AppUi.log('Selecione um certificado.', 'error');
      this.stopQuerying();
      return;
    }

    window.AppUi.log(`Consultando bloco a partir do NSU ${requestNsu}...`);

    try {
      const data = await window.AppApi.fetchBatch({
        startNsu: requestNsu,
        environment: env,
        cnpjConsulta: cnpj,
        certificateId: certId,
        sortOrder: selectSearchMode ? selectSearchMode.value : 'asc'
      });

      if (!this.isActiveQueryRun(runId)) return;

      if (!data.success) {
        window.AppUi.log('Erro na NFS-e: ' + data.error, 'error');
        window.AppUi.logNationalApiContext(data.nationalApi);
        if (data.retryable || this.isTransientSyncError(data.error)) {
          this.scheduleRetry(runId, requestNsu, data.error);
          return;
        }
        if (data.error.includes('Consumo Indevido') || data.error.includes('429') || data.error.includes('656')) {
          alertRateLimit.style.display = 'block';
        } else {
          window.AppUi.log('Consulta interrompida: ' + data.error, 'error');
        }
        this.stopQuerying();
        return;
      }

      window.transientRetryCount = 0;

      const {
        ultNSU,
        maxNSU,
        totalFila,
        documentos,
        novos = 0,
        existentes = 0,
        canceladasNovas = 0,
        eventosCancelamento = 0
      } = data;
      window.maxNsu = Math.max(window.maxNsu, maxNSU);
      statNsuMax.innerText = window.maxNsu;
      statNsuAtual.innerText = ultNSU;
      
      if (documentos && documentos.length > 0) {
        let loteMsg = `Lote processado! ${novos} novo(s), ${existentes} já existiam, ${documentos.length} recebido(s) no lote.`;
        if (Number(canceladasNovas) > 0 || Number(eventosCancelamento) > 0) {
          loteMsg += ` Canceladas detectadas: ${canceladasNovas} (eventos de cancel: ${eventosCancelamento}).`;
        }
        window.AppUi.log(loteMsg, novos > 0 || canceladasNovas > 0 ? 'success' : 'warning');
        window.totalDownloaded += novos;
        if (window.btnDownloadZip) btnDownloadZip.disabled = false;
        // Throttle: nao recarrega a tabela a cada lote (melhora velocidade da varredura)
        window._historyReloadDirty = true;
        if (window.AppDataCache) {
          window.AppDataCache.invalidate('history:');
          window.AppDataCache.invalidate('storage:');
          window.AppDataCache.invalidate('dashboard-summary');
        }
        const now = Date.now();
        if (!window._lastHistoryReloadAt || now - window._lastHistoryReloadAt > 8000) {
          window._lastHistoryReloadAt = now;
          window._historyReloadDirty = false;
          this.loadPersistedHistory(1, { quiet: true });
        }
        
        if (window.isCrawlerActive) {
          let novosCnpjs = 0;
          documentos.forEach(doc => {
            [doc.prestadorCnpj, doc.tomadorCnpj].forEach(c => {
              if (c && c !== 'N/A' && c !== 'Não Informado') {
                const clean = c.replace(/\D/g, '');
                if (clean.length === 14 && !window.crawlerVisited.has(clean) && !window.crawlerQueue.includes(clean)) {
                  window.crawlerQueue.push(clean);
                  novosCnpjs++;
                }
              }
            });
          });
          if (novosCnpjs > 0) window.AppUi.updateCrawlerUI();
        }
      }

      window.AppUi.updateProgress(ultNSU, window.maxNsu);

      let deveParar = false;
      let motivoParada = '';
      const mode = selectSearchMode ? selectSearchMode.value : 'asc';

      if (mode === 'asc') {
        if (ultNSU >= window.maxNsu) {
          deveParar = true;
          motivoParada = `NSU Atual (${ultNSU}) atingiu o máximo (${window.maxNsu}).`;
        } else if (Number(ultNSU || 0) < requestNsu) {
          deveParar = true;
          motivoParada = `A API retornou ultNSU (${ultNSU}) menor que o NSU consultado (${requestNsu}); consulta interrompida para evitar voltar no historico.`;
        }
      } else {
        if (window.currentNsu <= 0) {
          deveParar = true;
          motivoParada = `Busca reversa atingiu o NSU 0.`;
        }
      }

      if (!deveParar) {
        if (totalFila === 0 && mode === 'asc') {
          deveParar = true;
          motivoParada = `Não há mais documentos disponíveis.`;
        } else if (limiteNotas > 0 && window.totalDownloaded >= limiteNotas) {
          deveParar = true;
          motivoParada = `Limite de ${limiteNotas} atingido.`;
        }
      }

      if (deveParar) {
        window.AppUi.log(`Sincronização concluída! ${motivoParada}`, 'success');
        alertSyncSuccess.style.display = 'block';
        if (window._historyReloadDirty) {
          window._historyReloadDirty = false;
          window._lastHistoryReloadAt = Date.now();
          await this.loadPersistedHistory(1);
        }
        this.loadStorageSummary();
        this.stopQuerying();
        return;
      }

      if (mode === 'asc') {
        window.currentNsu = Math.max(requestNsu, Number(ultNSU || requestNsu));
      } else {
        window.currentNsu = Math.max(0, window.currentNsu - 50);
        inputStartNsu.value = window.currentNsu;
      }

      const safeDelaySeconds = 2;
      const safeDelayMs = safeDelaySeconds * 1000;
      window.AppUi.log(`Aguardando ${safeDelaySeconds}s antes do proximo bloco...`, 'warning');
      window.queryLoopTimer = setTimeout(() => {
        window.queryLoopTimer = null;
        this.runQueryLoop(runId);
      }, safeDelayMs);

    } catch (err) {
      if (!this.isActiveQueryRun(runId)) return;
      const isTransientNetwork = err.message === 'Failed to fetch' || /fetch|network|connection|load failed|timeout/i.test(err.message);
      if (isTransientNetwork) {
        this.scheduleRetry(runId, requestNsu, `Falha de conexão: ${err.message}`);
        return;
      }
      window.AppUi.log(`Erro crítico: ${err.message}`, 'error');
      this.stopQuerying();
    }
  },

  cleanFilenameToCityName(filename) {
    if (!filename) return 'Desconhecido';
    let name = filename.replace(/\.(pfx|p12|cert|key)$/i, '');
    name = name.replace(/_\d{14}$/, '');
    name = name.replace(/\d{14}$/, '');
    name = name.replace(/[_-]+/g, ' ').trim();
    name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return name;
  },

  async loadDashboard(retryCount = 0) {
    if (!dashboardCitiesGrid) return;

    const hasCards = Boolean(dashboardCitiesGrid.querySelector('.city-card:not(.skeleton-row)'));

    // Skeleton so no primeiro load (sem cards reais) — troca de aba fica instantanea
    if (retryCount === 0 && !hasCards) {
      if (window.dashStatCities) window.dashStatCities.innerHTML = `<div class="skeleton-shimmer" style="width: 40px; height: 26px; vertical-align: middle;"></div>`;
      if (window.dashStatActive) window.dashStatActive.innerHTML = `<div class="skeleton-shimmer" style="width: 40px; height: 26px; vertical-align: middle;"></div>`;
      if (window.dashStatXmls) window.dashStatXmls.innerHTML = `<div class="skeleton-shimmer" style="width: 80px; height: 26px; vertical-align: middle;"></div>`;

      let skeletonHtml = '';
      for (let i = 0; i < 4; i++) {
        skeletonHtml += `
          <div class="city-card skeleton-row" style="opacity: ${1 - (i * 0.15)}; cursor: default;">
            <div class="city-card-header">
              <div>
                <div class="skeleton-shimmer" style="width: 130px; height: 18px; border-radius: 4px;"></div>
                <div class="skeleton-shimmer" style="width: 110px; height: 12px; margin-top: 6px; border-radius: 4px;"></div>
              </div>
            </div>
            <div class="city-card-stats" style="margin-top: auto;">
              <div class="city-card-stat-item">
                <div class="skeleton-shimmer" style="width: 60px; height: 10px; border-radius: 4px;"></div>
                <div class="skeleton-shimmer" style="width: 40px; height: 16px; margin-top: 4px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-shimmer" style="width: 140px; height: 16px; border-radius: 4px; align-self: flex-end;"></div>
            </div>
          </div>
        `;
      }

      dashboardCitiesGrid.innerHTML = skeletonHtml;
      dashboardCitiesGrid.style.display = 'grid';
      if (dashboardLoader) dashboardLoader.style.display = 'none';
    }

    if (btnRefreshDashboard) {
      btnRefreshDashboard.classList.add('loading');
      btnRefreshDashboard.onclick = (e) => {
        e.preventDefault();
        this.loadDashboard(0);
      };
    }

    try {
      const data = await window.AppApi.fetchDashboardSummary();
      if (!data.success) throw new Error(data.error || 'Erro ao carregar dados do painel.');

      // Calcular Métricas Gerais
      const citiesList = data.summary || [];
      
      // Ordenação específica solicitada pelo usuário
      const orderMap = {
        'sao paulo': 1,
        'salvador': 2,
        'sorocaba': 3,
        'sao bernardo': 4,
        'guarulhos': 5,
        'santo andre': 6,
        'manaus': 7
      };
      const normalizeName = (name) => {
        return String(name || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      };
      citiesList.sort((a, b) => {
        const nameA = normalizeName(this.cleanFilenameToCityName(a.filename));
        const nameB = normalizeName(this.cleanFilenameToCityName(b.filename));
        return (orderMap[nameA] || 99) - (orderMap[nameB] || 99);
      });

      const totalCities = citiesList.length;
      const activeCities = citiesList.filter(c => c.active).length;
      const totalXmls = citiesList.reduce((sum, c) => sum + Number(c.totalXmls || 0), 0);

      if (dashStatCities) dashStatCities.innerText = window.AppUtils.formatInteger(totalCities);
      if (dashStatActive) dashStatActive.innerText = window.AppUtils.formatInteger(activeCities);
      if (dashStatXmls) dashStatXmls.innerText = window.AppUtils.formatInteger(totalXmls);

      dashboardCitiesGrid.innerHTML = '';
      const esc = window.AppUtils.escapeHtml;
      const frag = document.createDocumentFragment();
      citiesList.forEach(city => {
        const card = document.createElement('div');
        card.className = `city-card ${city.active ? 'active' : ''}`;
        const cityName = this.cleanFilenameToCityName(city.filename);
        const safeName = esc(cityName);
        const safeCnpj = esc(window.AppUtils.formatCnpj(city.cnpj));
        const safeLast = esc(city.lastUpdate || 'N/A');
        const safeXmls = esc(window.AppUtils.formatInteger(city.totalXmls));

        card.innerHTML = `
          <div class="city-card-header">
            <div>
              <h3 class="city-card-title">${safeName}</h3>
              <span class="city-card-cnpj">${safeCnpj}</span>
            </div>
            ${city.active ? '<span class="city-card-active-badge">Ativo</span>' : ''}
          </div>
          <div class="city-card-stats">
            <div class="city-card-stat-item">
              <span class="city-card-stat-label">Total XMLs</span>
              <span class="city-card-stat-value success">${safeXmls}</span>
            </div>
            <span class="city-card-date" title="Última nota emitida em ${safeLast}">Última: ${safeLast}</span>
          </div>
        `;

        card.addEventListener('click', async () => {
          if (city.active) {
            window.AppUi.switchTab(
              window.navDownload || document.getElementById('nav-download'),
              window.viewDownloadContent || document.getElementById('view-download-content'),
              'XMLs por Unidade',
              'XMLs NFS-e persistidos por certificado e unidade'
            );
            return;
          }

          window.AppUi.log(`Selecionando certificado para a cidade ${cityName}...`);
          try {
            const res = await window.AppApi.selectCertificate(city.certificateId);
            if (res.success) {
              await window.AppSyncController.checkCertStatus();
              window.AppUi.switchTab(
                window.navDownload || document.getElementById('nav-download'),
                window.viewDownloadContent || document.getElementById('view-download-content'),
                'XMLs por Unidade',
                'XMLs NFS-e persistidos por certificado e unidade'
              );
            } else {
              window.AppUi.log('Erro ao selecionar o certificado.', 'error');
            }
          } catch (err) {
            window.AppUi.log(`Erro ao selecionar o certificado: ${err.message}`, 'error');
          }
        });

        frag.appendChild(card);
      });
      dashboardCitiesGrid.appendChild(frag);

      if (dashboardLoader) dashboardLoader.style.display = 'none';
      dashboardCitiesGrid.style.display = 'grid';
    } catch (err) {
      console.warn(`Tentativa ${retryCount + 1} de carregar o painel falhou: ${err.message}`);
      // 1 retry rapido (800ms) em vez de 2x3s — evita sensacao de "travado"
      if (retryCount < 1) {
        setTimeout(() => {
          this.loadDashboard(retryCount + 1);
        }, 800);
      } else {
        dashboardCitiesGrid.innerHTML = `
          <div class="empty-state-card">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="empty-state-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <h3 class="empty-state-title">Conexão com o banco indisponível</h3>
            <p class="empty-state-text">O Supabase pode estar hibernando ou iniciando. Aguarde um momento e tente de novo.</p>
            <button type="button" class="btn btn-primary" id="btn-retry-dashboard">Tentar novamente</button>
          </div>
        `;
        const retryBtn = document.getElementById('btn-retry-dashboard');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => window.AppSyncController.loadDashboard(0));
        }
        if (window.dashStatCities) window.dashStatCities.innerText = '0';
        if (window.dashStatActive) window.dashStatActive.innerText = '0';
        if (window.dashStatXmls) window.dashStatXmls.innerText = '0';
        window.AppUi.log(`Erro ao carregar Dashboard: ${err.message}`, 'error');
      }
    } finally {
      if (btnRefreshDashboard) btnRefreshDashboard.classList.remove('loading');
    }
  }
};
