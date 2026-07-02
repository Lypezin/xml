// Controle de Consultas e Estado do Certificado

window.AppSyncController = {
  async checkCertStatus() {
    try {
      const data = await window.AppApi.fetchCertStatus();
      const navbarCertIndicator = document.getElementById('navbar-cert-indicator');
      const navbarCertText = document.getElementById('navbar-cert-text');
      
      window.certificates = data.certificates || [];
      window.activeCertificateId = data.activeCertificateId || null;
      
      window.AppUi.renderCertificateSelector();
      window.AppUi.renderCertificateList();

      if (data.active) {
        certUploadState.classList.remove('active');
        certActiveState.classList.add('active');
        activeCertName.innerText = `Arquivo: ${data.filename}`;
        activeCertCnpj.innerText = `CNPJ cadastrado: ${data.cnpj || 'Não informado'}`;
        btnStart.disabled = false;
        window.AppUi.log(`Certificado ativo encontrado para o CNPJ: ${data.cnpj}`);
        
        if (navbarCertIndicator && navbarCertText) {
          navbarCertIndicator.className = 'status-indicator online';
          navbarCertText.innerText = `Certificado Ativo: ${data.cnpj}`;
        }
      } else {
        certUploadState.classList.add('active');
        certActiveState.classList.remove('active');
        btnStart.disabled = true;
        window.AppUi.log('Nenhum certificado carregado. Por favor, envie um certificado para habilitar consultas.', 'warning');
        
        if (navbarCertIndicator && navbarCertText) {
          navbarCertIndicator.className = 'status-indicator offline';
          navbarCertText.innerText = `Nenhum certificado carregado`;
        }
      }
    } catch (err) {
      console.error('Erro ao verificar status do certificado:', err);
    }
  },

  async selectCertificateById(certificateId) {
    if (!certificateId) return;
    try {
      const data = await window.AppApi.selectCertificate(certificateId);
      if (!data.success) {
        window.AppUi.log(`Erro ao selecionar certificado: ${data.error}`, 'error');
        return;
      }
      window.activeCertificateId = data.activeCertificateId;
      window.AppUi.log('Certificado selecionado para consulta.', 'success');
      this.checkCertStatus();
    } catch (err) {
      window.AppUi.log(`Erro ao selecionar certificado: ${err.message}`, 'error');
    }
  },

  async discoverAndStart() {
    try {
      const environment = selectEnvironment.value;
      const cnpjConsulta = window.currentCrawlerCnpj;
      const certificateId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
      
      const data = await window.AppApi.discoverNsu({ environment, cnpjConsulta, certificateId });
      
      if (data.success && data.maxNSU > 0 && data.reliableMax) {
        window.maxNsu = data.maxNSU;
        window.currentNsu = Math.max(0, window.maxNsu - 50);
        inputStartNsu.value = window.currentNsu;
        window.AppUi.log(`NSU máximo informado pela API: ${window.maxNsu}. Consultando o último bloco conhecido a partir do NSU ${window.currentNsu}...`, 'success');
        this.runQueryLoop();
      } else if (data.success) {
        if (data.maxNSU > 0) {
          window.maxNsu = data.maxNSU;
          window.currentNsu = Math.max(0, window.maxNsu - 50);
          inputStartNsu.value = window.currentNsu;
          window.AppUi.log(`A API nao informou maxNSU oficial, mas estimou ${window.maxNsu}. Consultando o ultimo bloco conhecido a partir do NSU ${window.currentNsu}.`, 'warning');
          this.runQueryLoop();
          return;
        }
        window.currentNsu = parseInt(inputStartNsu.value) || 0;
        window.AppUi.log('A API não informou maxNSU confiável. Consulta seguirá a sequência segura por NSU e a tabela será exibida com os maiores NSUs primeiro.', 'warning');
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

    const environment = selectEnvironment.value;
    const cnpjConsulta = window.currentCrawlerCnpj;
    const certificateId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
    const limiteNotas = parseInt(inputLimiteNotas.value) || 0;

    if (!certificateId) {
      window.AppUi.log('Selecione um certificado antes de iniciar a consulta.', 'error');
      this.stopQuerying();
      return;
    }

    window.AppUi.log(`Consultando bloco a partir do NSU ${window.currentNsu}...`);

    try {
      const data = await window.AppApi.fetchBatch({
        startNsu: window.currentNsu,
        environment,
        cnpjConsulta,
        certificateId,
        sortOrder: selectSearchMode ? selectSearchMode.value : 'asc'
      });

      if (!data.success) {
        window.AppUi.log(`Erro na resposta da NFS-e: ${data.error}`, 'error');
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
        window.AppUi.log(`Lote processado! ${documentos.length} XMLs disponíveis para baixar quando você clicar.`, 'success');
        window.AppUi.appendDocumentsToTable(documentos);
        window.totalDownloaded += documentos.length;
        statTotalNotas.innerText = window.totalDownloaded;
        btnDownloadZip.disabled = false;
        
        if (window.isCrawlerActive) {
          let novosEncontrados = 0;
          documentos.forEach(doc => {
            [doc.prestadorCnpj, doc.tomadorCnpj].forEach(cnpj => {
              if (cnpj && cnpj !== 'N/A' && cnpj !== 'Não Informado') {
                const cleanCnpj = cnpj.replace(/\D/g, '');
                if (cleanCnpj.length === 14 && !window.crawlerVisited.has(cleanCnpj) && !window.crawlerQueue.includes(cleanCnpj)) {
                  window.crawlerQueue.push(cleanCnpj);
                  novosEncontrados++;
                }
              }
            });
          });
          if (novosEncontrados > 0) {
            window.AppUi.log(`Varredura encontrou ${novosEncontrados} novo(s) CNPJ(s) para sincronização futura.`, 'info');
            window.AppUi.updateCrawlerUI();
          }
        }
      } else {
        window.AppUi.log('Nenhuma nota fiscal encontrada neste bloco que atenda aos filtros.');
      }

      window.AppUi.updateProgress(ultNSU, window.maxNsu);

      let deveParar = false;
      let motivoParada = '';
      const mode = selectSearchMode ? selectSearchMode.value : 'asc';

      if (mode === 'asc') {
        if (ultNSU >= window.maxNsu) {
          deveParar = true;
          motivoParada = `O NSU Atual (${ultNSU}) atingiu o limite máximo (${window.maxNsu}).`;
        }
      } else {
        if (window.currentNsu <= 0) {
          deveParar = true;
          motivoParada = `A busca reversa atingiu o NSU 0 (início da fila).`;
        }
      }

      if (!deveParar) {
        if (totalFila === 0 && mode === 'asc') {
          deveParar = true;
          motivoParada = `Não há mais documentos disponíveis no servidor nacional.`;
        } else if (limiteNotas > 0 && window.totalDownloaded >= limiteNotas) {
          deveParar = true;
          motivoParada = `O limite configurado de ${limiteNotas} documentos consultados foi atingido.`;
        }
      }

      if (deveParar) {
        window.AppUi.log('==================================================', 'success');
        window.AppUi.log(`Sincronização concluída para o CNPJ ${window.currentCrawlerCnpj || 'Padrão'}! ${motivoParada}`, 'success');
        window.AppUi.log('Consulta finalizada. Use os botões XML ou ZIP para baixar os arquivos desejados.', 'success');
        window.AppUi.log('==================================================', 'success');
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

      window.AppUi.log('Aguardando 10 segundos antes do próximo bloco para reduzir risco de consumo indevido...');
      setTimeout(() => this.runQueryLoop(), 10000);

    } catch (err) {
      window.AppUi.log(`Erro crítico de comunicação: ${err.message}`, 'error');
      this.stopQuerying();
    }
  }
};
