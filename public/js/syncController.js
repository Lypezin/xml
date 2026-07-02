// Controle de Consultas e Estado do Certificado

window.AppSyncController = {
  async loadPersistedHistory(page = 1) {
    const certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    if (!certId || !window.AppApi?.listDocuments || !window.AppUiTable?.setDocuments) return;

    try {
      const safePage = Math.max(1, Number(page || 1));
      const limit = window.AppUiTable.pageSize || 100;
      const data = await window.AppApi.listDocuments({
        certificateId: certId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        limit,
        offset: (safePage - 1) * limit
      });

      if (!data.success) {
        window.AppUi.log(`Erro ao carregar historico: ${data.error}`, 'warning');
        return;
      }

      window.AppUiTable.setDocuments(data.documents || [], data.total || 0, safePage);
      btnDownloadZip.disabled = !(data.documents && data.documents.length > 0);
      window.AppUi.log(`Historico carregado: ${(data.documents || []).length} de ${data.total || 0} XML(s) salvos.`, 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao carregar historico: ${err.message}`, 'warning');
    }
  },

  async checkCertStatus() {
    try {
      const data = await window.AppApi.fetchCertStatus();
      const indicator = document.getElementById('navbar-cert-indicator');
      const txt = document.getElementById('navbar-cert-text');
      window.certificates = data.certificates || [];
      window.activeCertificateId = data.activeCertificateId || null;
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

  async discoverAndStart() {
    try {
      const env = selectEnvironment.value, cnpj = window.currentCrawlerCnpj, certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
      const data = await window.AppApi.discoverNsu({ environment: env, cnpjConsulta: cnpj, certificateId: certId });
      
      if (data.success && data.maxNSU > 0 && data.reliableMax) {
        window.maxNsu = data.maxNSU;
        window.currentNsu = Math.max(0, window.maxNsu - 50);
        inputStartNsu.value = window.currentNsu;
        window.AppUi.log(`NSU máximo API: ${window.maxNsu}. Consultando a partir do NSU ${window.currentNsu}...`, 'success');
        this.runQueryLoop();
      } else if (data.success) {
        if (data.maxNSU > 0) {
          window.maxNsu = data.maxNSU;
          window.currentNsu = Math.max(0, window.maxNsu - 50);
          inputStartNsu.value = window.currentNsu;
          window.AppUi.log(`Estimado ${window.maxNsu}. Consultando a partir de ${window.currentNsu}.`, 'warning');
          this.runQueryLoop();
          return;
        }
        window.currentNsu = parseInt(inputStartNsu.value) || 0;
        window.AppUi.log('Sem maxNSU confiável. Seguirá sequência por NSU.', 'warning');
        this.runQueryLoop();
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
    window.isQuerying = false;
    window.isPaused = false;
    window.AppUi.setBtnStartActive(false, false);
    btnPause.disabled = true;
  },

  async runQueryLoop() {
    if (window.isPaused || !window.isQuerying) return;

    const env = selectEnvironment.value, cnpj = window.currentCrawlerCnpj, certId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const limiteNotas = parseInt(inputLimiteNotas.value) || 0;

    if (!certId) {
      window.AppUi.log('Selecione um certificado.', 'error');
      this.stopQuerying();
      return;
    }

    window.AppUi.log(`Consultando bloco a partir do NSU ${window.currentNsu}...`);

    try {
      const data = await window.AppApi.fetchBatch({
        startNsu: window.currentNsu,
        environment: env,
        cnpjConsulta: cnpj,
        certificateId: certId,
        sortOrder: selectSearchMode ? selectSearchMode.value : 'asc'
      });

      if (!data.success) {
        window.AppUi.log(`Erro na NFS-e: ${data.error}`, 'error');
        window.AppUi.logNationalApiContext(data.nationalApi);
        if (data.error.includes('Consumo Indevido') || data.error.includes('429') || data.error.includes('656')) {
          alertRateLimit.style.display = 'block';
        } else {
          alert(`Erro na sincronização: ${data.error}`);
        }
        this.stopQuerying();
        return;
      }

      const { ultNSU, maxNSU, totalFila, documentos } = data;
      window.maxNsu = Math.max(window.maxNsu, maxNSU);
      statNsuMax.innerText = window.maxNsu;
      statNsuAtual.innerText = ultNSU;
      
      if (documentos && documentos.length > 0) {
        window.AppUi.log(`Lote processado! ${documentos.length} XMLs disponíveis.`, 'success');
        window.AppUi.appendDocumentsToTable(documentos);
        window.totalDownloaded += documentos.length;
        btnDownloadZip.disabled = false;
        
        if (window.isCrawlerActive) {
          let novos = 0;
          documentos.forEach(doc => {
            [doc.prestadorCnpj, doc.tomadorCnpj].forEach(c => {
              if (c && c !== 'N/A' && c !== 'Não Informado') {
                const clean = c.replace(/\D/g, '');
                if (clean.length === 14 && !window.crawlerVisited.has(clean) && !window.crawlerQueue.includes(clean)) {
                  window.crawlerQueue.push(clean);
                  novos++;
                }
              }
            });
          });
          if (novos > 0) window.AppUi.updateCrawlerUI();
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
        window.currentNsu = ultNSU;
      } else {
        window.currentNsu = Math.max(0, window.currentNsu - 50);
        inputStartNsu.value = window.currentNsu;
      }

      const safeDelayMs = 65000;
      window.AppUi.log('Aguardando 65 segundos antes do proximo bloco para reduzir risco de bloqueio...', 'warning');
      setTimeout(() => this.runQueryLoop(), safeDelayMs);

    } catch (err) {
      window.AppUi.log(`Erro crítico: ${err.message}`, 'error');
      this.stopQuerying();
    }
  }
};
