// Loop de consulta NSU
Object.assign(window.AppSyncController = window.AppSyncController || {}, {
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
        window.AppInsights?.refreshOpsInsights?.();
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
      window.AppUi.log(`Aguardando ${safeDelaySeconds}s antes do próximo bloco...`, 'warning');
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
  }
});
