// Start/stop/discover varredura
window.AppSyncController = Object.assign(window.AppSyncController || {}, {
}, {
}, {
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
    const maxRetries = 8;

    if (retryCount > maxRetries) {
      window.AppUi.log('Limite de tentativas temporárias atingido. Consulta pausada para evitar insistir na API.', 'error');
      window.AppToast?.error?.('Varredura pausada após falhas de rede');
      this.stopQuerying();
      this.loadSyncRuns?.();
      return;
    }

    // Backoff exponencial com jitter (10s, 20s, 40s… até 3 min)
    const base = Math.min(180, 10 * (2 ** (retryCount - 1)));
    const jitter = Math.floor(Math.random() * Math.min(8, base * 0.2));
    const retryDelaySeconds = base + jitter;

    window.currentNsu = requestNsu;
    if (inputStartNsu) inputStartNsu.value = requestNsu;
    window._retryMeta = {
      runId,
      requestNsu,
      retryCount,
      maxRetries,
      nextAt: Date.now() + retryDelaySeconds * 1000,
      errorMessage: String(errorMessage || '')
    };

    window.AppUi.log(
      `Erro temporário na API (${errorMessage}). Retomada automática ${retryCount}/${maxRetries} em ${retryDelaySeconds}s no NSU ${requestNsu}.`,
      'warning'
    );
    window.AppToast?.warning?.(`Retry ${retryCount}/${maxRetries} em ${retryDelaySeconds}s`);
    this.renderRetryStatus?.();

    if (window.queryLoopTimer) clearTimeout(window.queryLoopTimer);
    window.queryLoopTimer = setTimeout(() => {
      window.queryLoopTimer = null;
      window._retryMeta = null;
      this.renderRetryStatus?.();
      this.runQueryLoop(runId);
    }, retryDelaySeconds * 1000);
  },

  renderRetryStatus() {
    const el = document.getElementById('retry-status-banner');
    if (!el) return;
    const meta = window._retryMeta;
    if (!meta || !window.isQuerying) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    const secs = Math.max(0, Math.ceil((meta.nextAt - Date.now()) / 1000));
    el.style.display = 'block';
    el.innerHTML = `<strong>Retomada automática</strong> · tentativa ${meta.retryCount}/${meta.maxRetries} · NSU ${meta.requestNsu} · em ${secs}s`;
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
  }
});
