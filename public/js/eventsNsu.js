// Botões de NSU e paginação da tabela
window.AppEventsNsu = {
  bind() {
    if (selectSearchMode) {
      selectSearchMode.addEventListener('change', () => window.AppUiTable.renderCurrentPage());
    }

    // Forçar NSU: checkbox + input protegidos por senha (front only)
    const overrideNsuCheckbox = document.getElementById('override-nsu');
    const nsuInput = window.inputStartNsu || document.getElementById('start-nsu');

    const setNsuForceUnlocked = (unlocked) => {
      if (nsuInput) {
        nsuInput.readOnly = !unlocked;
        nsuInput.classList.toggle('is-locked', !unlocked);
        nsuInput.title = unlocked
          ? 'NSU inicial forçado (editável)'
          : 'Marque "Forçar NSU" e digite a senha para editar';
      }
      if (overrideNsuCheckbox) overrideNsuCheckbox.checked = Boolean(unlocked);
    };

    // Input bloqueado até destravar com senha
    setNsuForceUnlocked(false);

    if (overrideNsuCheckbox) {
      overrideNsuCheckbox.addEventListener('change', () => {
        if (overrideNsuCheckbox.checked) {
          if (!window.AppUtils?.requireOpsPassword?.('forçar o NSU')) {
            setNsuForceUnlocked(false);
            return;
          }
          setNsuForceUnlocked(true);
          nsuInput?.focus();
          window.AppUi?.log?.('Forçar NSU desbloqueado. Informe o NSU inicial desejado.', 'warning');
        } else {
          setNsuForceUnlocked(false);
          window.AppUi?.log?.('Forçar NSU desativado. A varredura usará o último NSU salvo.');
        }
      });
    }

    if (nsuInput) {
      // Qualquer tentativa de editar com o force off pede senha
      const guardNsuEdit = (e) => {
        if (overrideNsuCheckbox?.checked) return;
        e.preventDefault();
        e.stopPropagation();
        if (!window.AppUtils?.requireOpsPassword?.('forçar o NSU')) {
          setNsuForceUnlocked(false);
          return;
        }
        setNsuForceUnlocked(true);
        window.AppUi?.log?.('Forçar NSU desbloqueado. Informe o NSU inicial desejado.', 'warning');
        // reabre o input no próximo tick
        setTimeout(() => nsuInput.focus(), 0);
      };
      nsuInput.addEventListener('pointerdown', (e) => {
        if (!overrideNsuCheckbox?.checked) guardNsuEdit(e);
      });
      nsuInput.addEventListener('keydown', (e) => {
        if (!overrideNsuCheckbox?.checked && !['Tab'].includes(e.key)) guardNsuEdit(e);
      });
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
