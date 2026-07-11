// eventsScheduler
window.AppEventsScheduler = {
  bind() {
if (btnSaveScheduler) {
  btnSaveScheduler.addEventListener('click', async () => {
    btnSaveScheduler.disabled = true;
    try {
      const settings = {
        autoSyncEnabled: Boolean(schedulerEnabled?.checked),
        autoSyncIntervalHours: Number(schedulerInterval?.value || 12),
        autoSyncEnvironment: selectEnvironment?.value || schedulerEnv?.value || 'producao',
        autoSyncMaxBatchesPerRun: Number(schedulerMaxBatches?.value || 1),
        autoSyncDelaySeconds: 2
      };
      const data = await window.AppApi.saveSchedulerSettings(settings);
      if (!data.success) throw new Error(data.error || 'Não foi possível salvar o agendamento.');
      window.AppUi.updateSchedulerUI(data.settings);
      window.AppUi.log('Agendamento salvo com sucesso.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao salvar agendamento: ${err.message}`, 'error');
    } finally {
      btnSaveScheduler.disabled = false;
    }
  });
}

if (btnRunSchedulerNow) {
  btnRunSchedulerNow.addEventListener('click', async () => {
    btnRunSchedulerNow.disabled = true;
    if (btnSaveScheduler) btnSaveScheduler.disabled = true;
    window.AppUi.log('Iniciando atualização manual segura...');
    try {
      const settings = {
        autoSyncEnabled: false,
        autoSyncIntervalHours: Number(schedulerInterval?.value || 12),
        autoSyncEnvironment: selectEnvironment?.value || schedulerEnv?.value || 'producao',
        autoSyncMaxBatchesPerRun: Number(schedulerMaxBatches?.value || 1),
        autoSyncDelaySeconds: 2
      };
      await window.AppApi.saveSchedulerSettings(settings);

      const delaySeconds = 2;
      let finished = false;
      let cycles = 0;

      while (!finished) {
        cycles += 1;
        const data = await window.AppApi.runSchedulerNow();
        if (!data.success) throw new Error(data.error || 'Não foi possível executar a atualização.');

        const result = data.result || {};
        if (result.error) throw new Error(result.error);

        window.AppUi.updateManualSyncProgress(
          result.lastNsu || 0,
          result.maxNsuSeen || 0,
          result.maxNsuSeen ? `NSU ${result.lastNsu || 0} de ${result.maxNsuSeen}` : 'Consultando primeiro lote...'
        );
        window.AppUi.updateProgress(result.lastNsu || 0, result.maxNsuSeen || 0);
        window.AppUi.log(`Ciclo ${cycles}: ${result.batches || 0} lote(s), ${result.documentsFound || 0} XML(s).`, 'success');

        finished = Boolean(result.finished || result.started === false);
        if (!finished) {
          window.AppUi.log(`Pausa segura de ${delaySeconds}s antes do proximo lote para reduzir risco de bloqueio...`, 'warning');
          await sleep(delaySeconds * 1000);
        }
      }

      window.AppUi.log('Atualizacao manual concluida.', 'success');
      window.AppSyncController.loadPersistedHistory();
      window.AppSyncController.loadStorageSummary();
      loadSchedulerSettings();
    } catch (err) {
      window.AppUi.log(`Erro na atualizacao manual: ${err.message}`, 'error');
    } finally {
      btnRunSchedulerNow.disabled = false;
      if (btnSaveScheduler) btnSaveScheduler.disabled = false;
    }
  });
}

if (btnDownloadPeriod) {
  btnDownloadPeriod.addEventListener('click', async () => {
    const startDate = downloadStartDate?.value;
    const endDate = downloadEndDate?.value;
    if (!startDate || !endDate) {
      window.AppUi.log('Informe data inicial e data final para baixar o periodo.', 'warning');
      return;
    }

    btnDownloadPeriod.disabled = true;
    window.AppUi.log(`Gerando ZIP do periodo ${startDate} a ${endDate}...`);
    try {
      const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
      await window.AppApi.downloadPeriodZip({
        certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
        environment: selectEnvironment ? selectEnvironment.value : 'producao',
        startDate,
        endDate,
        cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
        partyCnpj: unitFilterParams.partyCnpj,
        partyRole: unitFilterParams.partyRole,
        search: historySearch ? historySearch.value.trim() : '',
        includeCancelled: window.AppUtils.getIncludeCancelledParam()
      });
      window.AppUi.log('ZIP do periodo baixado com sucesso.', 'success');
    } catch (err) {
      window.AppUi.log(`Erro ao baixar periodo: ${err.message}`, 'error');
    } finally {
      btnDownloadPeriod.disabled = false;
    }
  });
}
  }
};
