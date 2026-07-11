// eventsSync
window.AppEventsSync = {
  bind() {
if (btnStart) {
  btnStart.addEventListener('click', async () => {
    if (window.isQuerying) {
      window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
      if (window.queryLoopTimer) {
        clearTimeout(window.queryLoopTimer);
        window.queryLoopTimer = null;
      }
      window.isPaused = true;
      window.AppUi.setBtnStartActive(false, true);
      if (btnPause) btnPause.disabled = true;
      if (window.btnResetNsu) window.btnResetNsu.disabled = false;
      window.AppUi.log('Sincronização pausada pelo usuário.', 'warning');
      window.isQuerying = false;
    } else {
      const wasPaused = window.isPaused;
      window.isQuerying = true;
      window.isPaused = false;
      const runId = window.AppSyncController.beginQueryRun();
      if (alertRateLimit) alertRateLimit.style.display = 'none';
      if (alertSyncSuccess) alertSyncSuccess.style.display = 'none';
      window.AppUi.setBtnStartActive(true);
      if (btnPause) btnPause.disabled = false;
      if (window.btnResetNsu) window.btnResetNsu.disabled = true;

      const overrideNsuCheckbox = document.getElementById('override-nsu');
      const isOverridden = overrideNsuCheckbox && overrideNsuCheckbox.checked;

      if (isOverridden) {
        window.currentNsu = parseInt(inputStartNsu?.value) || 0;
        window.AppUi.log(`Varredura iniciada manualmente forçando o NSU inicial: ${window.currentNsu}.`);
      }

      if (!wasPaused) {
        window.totalDownloaded = 0;
        const mode = 'asc';
        window.isCrawlerActive = false;
        window.crawlerVisited = new Set();
        window.crawlerQueue = [];
        const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
        window.currentCrawlerCnpj = unitFilterParams.partyCnpj || (inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '');
        window.AppUi.updateCrawlerUI();

        if (!isOverridden) {
          try {
            const savedNsu = await window.AppSyncController.loadSavedStartNsu();
            window.AppUi.log(`Iniciando varredura a partir do último NSU recebido salvo: ${savedNsu}.`);
          } catch (err) {
            window.currentNsu = 0;
            if (inputStartNsu) inputStartNsu.value = 0;
            window.AppUi.log(`Não foi possível carregar o último NSU salvo (${err.message}). Iniciando do NSU 0.`, 'warning');
          }
        }

        if (mode === 'desc' && window.currentNsu === 0) {
          window.AppUi.log(`Descobrindo NSU mais recente na Receita Federal para busca reversa...`);
          window.AppSyncController.discoverAndStart(runId);
          return;
        }
      } else if (!isOverridden) {
        window.AppUi.log(`Retomando busca a partir do NSU ${window.currentNsu}...`);
      }

      window.AppSyncController.runQueryLoop(runId);
    }
  });
}

if (btnPause) {
  btnPause.addEventListener('click', () => {
    window.activeQueryRunId = (window.activeQueryRunId || 0) + 1;
    if (window.queryLoopTimer) {
      clearTimeout(window.queryLoopTimer);
      window.queryLoopTimer = null;
    }
    window.isPaused = true;
    window.AppUi.setBtnStartActive(false, true);
    btnPause.disabled = true;
    if (window.btnResetNsu) window.btnResetNsu.disabled = false;
    window.AppUi.log('Sincronização pausada pelo usuário.', 'warning');
    window.isQuerying = false;
  });
}

if (window.btnResetNsu) {
  window.btnResetNsu.addEventListener('click', async () => {
    if (!confirm('Tem certeza que deseja zerar o histórico de NSU e começar do 0 para este certificado/unidade?')) return;
    
    window.btnResetNsu.disabled = true;
    try {
      const certId = window.selectCertificate.value;
      const env = window.selectEnvironment.value;
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      const cnpj = unitFilterParams.partyCnpj || window.inputCnpjConsulta?.value || '';
      
      if (!certId) {
        window.AppUi.log('Selecione um certificado primeiro.', 'error');
        return;
      }
      
      const response = await fetch('/api/reset-nsu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificateId: certId, environment: env, cnpjConsulta: cnpj })
      });
      
      const result = await response.json();
      if (result.success) {
        window.AppUi.log('Histórico de NSU zerado com sucesso. Você pode iniciar a varredura a partir do 0.', 'success');
        window.inputStartNsu.value = '0';
        window.currentNsu = 0;
      } else {
        window.AppUi.log(`Erro ao zerar NSU: ${result.error}`, 'error');
      }
    } catch (err) {
      window.AppUi.log(`Erro na requisição: ${err.message}`, 'error');
    } finally {
      window.btnResetNsu.disabled = false;
    }
  });
}
  }
};
