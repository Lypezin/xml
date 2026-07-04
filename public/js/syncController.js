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
      if (!data.success) throw new Error(data.error || 'Nao foi possivel carregar armazenamento.');

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
      if (!data.success) throw new Error(data.error || 'Nao foi possivel carregar unidades.');
      window.units = data.units || [];
      this.renderUnitSelector();
    } catch (err) {
      window.AppUi.log(`Erro ao carregar unidades: ${err.message}`, 'warning');
    }
  },

  async loadPersistedHistory(page = 1) {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!certId || !window.AppApi?.listDocuments || !window.AppUiTable?.setDocuments) return;

    try {
      const safePage = Math.max(1, Number(page || 1));
      const limit = window.AppUiTable.pageSize || 100;
      const unitFilterParams = this.getSelectedUnitFilter();
      const data = await window.AppApi.listDocuments({
        certificateId: certId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        includeCancelled: includeCancelled?.checked ? 'true' : 'false',
        limit,
        offset: (safePage - 1) * limit
      });

      if (!data.success) {
        window.AppUi.log(`Erro ao carregar historico: ${data.error}`, 'warning');
        return;
      }

      window.AppUiTable.setDocuments(data.documents || [], data.total || 0, safePage, data.summary?.totalValue || 0);
      btnDownloadZip.disabled = !(data.documents && data.documents.length > 0);
      const unitLabel = unitFilterParams.partyCnpj ? ` para ${unitFilter?.selectedOptions?.[0]?.dataset?.name || unitFilterParams.partyCnpj}` : '';
      window.AppUi.log(`Historico carregado${unitLabel}: ${(data.documents || []).length} de ${data.total || 0} XML(s) salvos.`, 'success');
      this.loadStorageSummary();
    } catch (err) {
      window.AppUi.log(`Erro ao carregar historico: ${err.message}`, 'warning');
    }
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
    const savedNsu = lastReceivedNsu || lastNsu || 0;
    inputStartNsu.value = savedNsu;
    window.currentNsu = savedNsu;
    window.maxNsu = Math.max(window.maxNsu || 0, savedNsu);
    statNsuAtual.innerText = String(savedNsu);
    statNsuMax.innerText = String(window.maxNsu || savedNsu);
    return savedNsu;
  },

  async checkCertStatus() {
    try {
      const data = await window.AppApi.fetchCertStatus();
      const indicator = document.getElementById('navbar-cert-indicator');
      const txt = document.getElementById('navbar-cert-text');
      window.certificates = data.certificates || [];
      window.activeCertificateId = data.activeCertificateId || null;
      await this.loadUnits();
      window.AppUi.renderCertificateSelector();
      window.AppUi.renderCertificateList();

      if (data.active) {
        certUploadState.classList.remove('active');
        certActiveState.classList.add('active');
        activeCertName.innerText = `Arquivo: ${data.filename}`;
        activeCertCnpj.innerText = `CNPJ: ${data.cnpj || 'Não informado'}`;
        btnStart.disabled = false;
        window.AppUi.log(`Certificado ativo CNPJ: ${data.cnpj}`);
        if (indicator && txt) {
          indicator.className = 'status-indicator online';
          txt.innerText = `Certificado Ativo: ${data.cnpj}`;
        }
        this.loadPersistedHistory();
        this.loadStorageSummary();
      } else {
        certUploadState.classList.add('active');
        certActiveState.classList.remove('active');
        btnStart.disabled = true;
        window.AppUi.log('Nenhum certificado carregado.', 'warning');
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

      const { ultNSU, maxNSU, totalFila, documentos, novos = 0, existentes = 0 } = data;
      window.maxNsu = Math.max(window.maxNsu, maxNSU);
      statNsuMax.innerText = window.maxNsu;
      statNsuAtual.innerText = ultNSU;
      
      if (documentos && documentos.length > 0) {
        window.AppUi.log(`Lote processado! ${novos} novo(s), ${existentes} ja existiam, ${documentos.length} recebido(s) no lote.`, novos > 0 ? 'success' : 'warning');
        window.AppUi.appendDocumentsToTable(documentos);
        window.totalDownloaded += novos;
        btnDownloadZip.disabled = false;
        this.loadStorageSummary();
        
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
      window.AppUi.log(`Erro crítico: ${err.message}`, 'error');
      this.stopQuerying();
    }
  }
};
