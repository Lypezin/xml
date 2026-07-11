// Botões de NSU e paginação da tabela
window.AppEventsNsu = {
  bind() {
    if (selectSearchMode) {
      selectSearchMode.addEventListener('change', () => window.AppUiTable.renderCurrentPage());
    }

    if (btnUseSavedNsu) {
      btnUseSavedNsu.addEventListener('click', async () => {
        btnUseSavedNsu.disabled = true;
        try {
          const data = await window.AppApi.fetchSyncState({
            environment: selectEnvironment ? selectEnvironment.value : 'producao',
            cnpjConsulta: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
            certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId
          });
          const lastReceivedNsu = Number(data.state?.last_received_nsu || 0);
          const lastNsu = Number(data.state?.last_nsu || 0);
          const savedNsu = lastReceivedNsu || lastNsu;
          inputStartNsu.value = savedNsu;
          window.currentNsu = savedNsu;
          window.maxNsu = Math.max(window.maxNsu || 0, savedNsu);
          statNsuAtual.innerText = String(savedNsu);
          statNsuMax.innerText = String(window.maxNsu || savedNsu);
          window.totalDownloaded = 0;
          window.isPaused = false;
          window.AppUi.log(`NSU inicial ajustado para o ultimo recebido salvo: ${savedNsu}.`, 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao buscar ultimo NSU salvo: ${err.message}`, 'error');
        } finally {
          btnUseSavedNsu.disabled = false;
        }
      });
    }

    if (btnUseNationalNsu) {
      btnUseNationalNsu.addEventListener('click', async () => {
        btnUseNationalNsu.disabled = true;
        window.AppUi.log('Consultando ADN para descobrir o último NSU nacional...', 'warning');
        try {
          const data = await window.AppApi.discoverNsu({
            environment: selectEnvironment ? selectEnvironment.value : 'producao',
            cnpjConsulta: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
            certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId
          });
          if (!data.success) throw new Error(data.error || 'Não foi possível descobrir o último NSU.');
          const nationalNsu = Number(data.maxNSU || 0);
          inputStartNsu.value = nationalNsu;
          window.currentNsu = nationalNsu;
          window.maxNsu = Math.max(window.maxNsu || 0, nationalNsu);
          statNsuAtual.innerText = String(nationalNsu);
          statNsuMax.innerText = String(window.maxNsu || nationalNsu);
          window.totalDownloaded = 0;
          window.isPaused = false;
          window.AppUi.log(`NSU inicial ajustado para o ultimo nacional: ${nationalNsu}.`, 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao descobrir ultimo NSU nacional: ${err.message}`, 'error');
        } finally {
          btnUseNationalNsu.disabled = false;
        }
      });
    }

    if (btnHistoryPrev) {
      btnHistoryPrev.addEventListener('click', () => window.AppUiTable.prevPage());
    }

    if (btnHistoryNext) {
      btnHistoryNext.addEventListener('click', () => window.AppUiTable.nextPage());
    }
  }
};
