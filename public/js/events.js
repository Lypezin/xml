// Bind de Eventos Gerais e Wire-up do Frontend

function handleFileSelection(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension !== 'pfx' && extension !== 'p12') {
    window.AppUi.log('Erro: Selecione apenas arquivos .pfx ou .p12', 'error');
    window.selectedFile = null;
    fileNamePreview.innerText = '';
    return;
  }
  window.selectedFile = file;
  fileNamePreview.innerText = `Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  window.AppUi.log(`Arquivo selecionado: ${file.name}`);
}

async function loadSchedulerSettings() {
  if (!window.AppApi?.fetchSchedulerSettings || !window.AppUi?.updateSchedulerUI) return;
  try {
    const data = await window.AppApi.fetchSchedulerSettings();
    if (data.success) {
      window.AppUi.updateSchedulerUI(data.settings || {});
    }
  } catch (err) {
    window.AppUi.log(`Erro ao carregar agendamento: ${err.message}`, 'warning');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(fn, delayMs = 300) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

window.AppEvents = {
  bindEvents() {
    window.AppEventsCert.bindCertEvents();

    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        window.AppUi.setAuthMessage('Entrando...');
        authSubmit.disabled = true;

        try {
          const user = await window.AppApi.loginWithPassword(authEmail.value.trim(), authPassword.value);
          window.AppUi.setAuthMessage('Acesso liberado.', 'success');
          window.AppUi.showAuthenticatedApp(user);
          window.AppSyncController.checkCertStatus();
          loadSchedulerSettings();
          window.AppUi.updateProgress(0, 0);
          selectEnvironment.dispatchEvent(new Event('change'));
        } catch (err) {
          window.AppUtils.clearAuthSession();
          window.AppUi.setAuthMessage(err.message, 'error');
        } finally {
          authSubmit.disabled = false;
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        window.AppUtils.clearAuthSession();
        window.AppSyncController.stopQuerying();
        window.AppUi.showLogin();
      });
    }

    if (selectCertificate) {
      selectCertificate.addEventListener('change', async () => {
        await window.AppSyncController.selectCertificateById(selectCertificate.value);
        if (window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none') {
          window.AppSyncController.loadPersistedHistory();
        }
      });
    }

    btnStart.addEventListener('click', async () => {
      if (window.isQuerying) {
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
      } else {
        const wasPaused = window.isPaused;
        window.isQuerying = true;
        window.isPaused = false;
        const runId = window.AppSyncController.beginQueryRun();
        alertRateLimit.style.display = 'none';
        alertSyncSuccess.style.display = 'none';
        window.AppUi.setBtnStartActive(true);
        btnPause.disabled = false;
        if (window.btnResetNsu) window.btnResetNsu.disabled = true;
        
        if (!wasPaused) {
          window.totalDownloaded = 0;
          const mode = 'asc';
          window.isCrawlerActive = false;
          window.crawlerVisited = new Set();
          window.crawlerQueue = [];
          const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
          window.currentCrawlerCnpj = unitFilterParams.partyCnpj || inputCnpjConsulta.value.trim();
          window.AppUi.updateCrawlerUI();

          try {
            const savedNsu = await window.AppSyncController.loadSavedStartNsu();
            window.AppUi.log(`Iniciando varredura a partir do último NSU recebido salvo: ${savedNsu}.`);
          } catch (err) {
            window.currentNsu = 0;
            inputStartNsu.value = 0;
            window.AppUi.log(`Não foi possível carregar o último NSU salvo (${err.message}). Iniciando do NSU 0.`, 'warning');
          }

          if (mode === 'desc' && window.currentNsu === 0) {
            window.AppUi.log(`Descobrindo NSU mais recente na Receita Federal para busca reversa...`);
            window.AppSyncController.discoverAndStart(runId);
            return;
          }
        } else {
          window.AppUi.log(`Retomando busca a partir do NSU ${window.currentNsu}...`);
        }
        
        window.AppSyncController.runQueryLoop(runId);
      }
    });

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

    if (window.btnResetNsu) {
      window.btnResetNsu.addEventListener('click', async () => {
        if (!confirm('Tem certeza que deseja zerar o histórico de NSU e começar do 0 para este certificado/unidade?')) return;
        
        window.btnResetNsu.disabled = true;
        try {
          const certId = window.selectCertificate.value;
          const env = window.selectEnvironment.value;
          const cnpj = window.inputCnpjConsulta.value;
          
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

    tableBody.addEventListener('click', async (e) => {
      const xmlButton = e.target.closest('button[data-action="download-xml"]');
      const pdfButton = e.target.closest('button[data-action="download-pdf"]');
      if (!xmlButton && !pdfButton) return;

      try {
        if (xmlButton) {
          await window.AppApi.downloadFromApi(`/api/download-xml/${xmlButton.dataset.token}`, 'nfse.xml');
          window.AppUi.log('XML baixado com sucesso.', 'success');
          return;
        }

        const params = new URLSearchParams({
          certificateId: selectCertificate ? selectCertificate.value : (window.activeCertificateId || ''),
          environment: selectEnvironment ? selectEnvironment.value : 'producao'
        });
        await window.AppApi.downloadFromApi(`/api/download-pdf/${encodeURIComponent(pdfButton.dataset.chave)}?${params.toString()}`, 'danfse.pdf');
        window.AppUi.log('PDF baixado com sucesso.', 'success');
      } catch (err) {
        window.AppUi.log(`Erro ao baixar documento: ${err.message}`, 'error');
      }
    });

    if (btnClearDownloads) btnClearDownloads.addEventListener('click', async () => {
      if (!confirm('Limpar apenas arquivos temporários? Os XMLs permanentes no banco de dados serão preservados.')) return;

      try {
        const data = await window.AppApi.clearDownloads();
        if (data.success) {
          window.AppUi.log(`Temporários limpos. ${data.count} XML(s) removido(s); banco de dados preservado.`);
          window.totalDownloaded = 0;
          if (btnDownloadZip) btnDownloadZip.disabled = true;
          window.AppUi.updateProgress(0, 0);
          statNsuAtual.innerText = '0';
          statNsuMax.innerText = '0';
          alertRateLimit.style.display = 'none';
          alertSyncSuccess.style.display = 'none';
          window.AppSyncController.loadPersistedHistory();
          window.AppSyncController.loadStorageSummary();
        }
      } catch (err) {
        window.AppUi.log(`Erro ao limpar pasta: ${err.message}`, 'error');
      }
    });

    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => {
        window.AppUiTable.exportToExcel();
      });
    }

    if (btnDownloadZip) {
      btnDownloadZip.addEventListener('click', async () => {
        window.AppUi.log('Gerando ZIP com os XMLs persistidos da tabela atual...');
        btnDownloadZip.disabled = true;
        if (btnExportExcel) btnExportExcel.disabled = true;
        try {
          const unitFilterParams = window.AppSyncController.getSelectedUnitFilter();
          await window.AppApi.downloadPeriodZip({
            certificateId: selectCertificate ? selectCertificate.value : window.activeCertificateId,
            environment: selectEnvironment ? selectEnvironment.value : 'producao',
            startDate: downloadStartDate?.value || null,
            endDate: downloadEndDate?.value || null,
            cnpj: inputCnpjConsulta ? inputCnpjConsulta.value.trim() : '',
            partyCnpj: unitFilterParams.partyCnpj,
            partyRole: unitFilterParams.partyRole,
            search: historySearch ? historySearch.value.trim() : '',
            includeCancelled: includeCancelled?.checked ? 'true' : 'false'
          });
          window.AppUi.log('ZIP da tabela baixado com sucesso.', 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao baixar ZIP: ${err.message}`, 'error');
        } finally {
          const hasDocs = !window.AppUiTable?.documents?.length;
          btnDownloadZip.disabled = hasDocs;
          if (btnExportExcel) btnExportExcel.disabled = hasDocs;
        }
      });
    }

    selectEnvironment.addEventListener('change', () => {
      const envText = selectEnvironment.value === 'producao' ? 'Produção' : 'Homologação';
      const statAmbiente = document.getElementById('stat-ambiente');
      if (statAmbiente) {
        statAmbiente.innerText = envText;
        statAmbiente.className = selectEnvironment.value === 'producao' ? 'metric-value text-primary' : 'metric-value text-warning';
      }
      if (selectEnvironment.offsetParent !== null) {
        window.AppUi.log(`Ambiente alterado para: ${envText}`);
      }
      if (window.viewDownloadContent && window.viewDownloadContent.style.display !== 'none') {
        window.AppSyncController.loadPersistedHistory();
      }
    });

    if (inputCnpjConsulta) {
      inputCnpjConsulta.addEventListener('change', () => window.AppSyncController.loadPersistedHistory());
    }

    if (unitFilter) {
      unitFilter.addEventListener('change', () => {
        window.AppSyncController.fillUnitFormFromSelection();
        window.AppSyncController.loadPersistedHistory();
      });
    }

    if (unitPartyRole) {
      unitPartyRole.addEventListener('change', () => window.AppSyncController.loadPersistedHistory());
    }

    if (historySearch) {
      historySearch.addEventListener('input', debounce(() => window.AppSyncController.loadPersistedHistory(1), 350));
    }

    if (includeCancelled) {
      includeCancelled.addEventListener('change', () => window.AppSyncController.loadPersistedHistory(1));
    }

    if (btnSaveUnit) {
      btnSaveUnit.addEventListener('click', async () => {
        btnSaveUnit.disabled = true;
        try {
          const selectedOption = unitFilter?.selectedOptions?.[0];
          const data = await window.AppApi.saveUnit({
            id: selectedOption?.dataset?.id || null,
            name: unitName ? unitName.value.trim() : '',
            cnpj: unitCnpj ? unitCnpj.value.trim() : '',
            city: unitCity ? unitCity.value.trim() : '',
            state: unitState ? unitState.value.trim() : ''
          });
          if (!data.success) throw new Error(data.error || 'Não foi possível salvar a unidade.');
          await window.AppSyncController.loadUnits();
          if (unitFilter && data.unit?.cnpj) unitFilter.value = data.unit.cnpj;
          window.AppSyncController.fillUnitFormFromSelection();
          window.AppSyncController.loadPersistedHistory();
          window.AppUi.log('Unidade salva com sucesso.', 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao salvar unidade: ${err.message}`, 'error');
        } finally {
          btnSaveUnit.disabled = false;
        }
      });
    }

    if (btnDeleteUnit) {
      btnDeleteUnit.addEventListener('click', async () => {
        const selected = window.AppSyncController.getSelectedUnitFilter();
        if (!selected.unitId) {
          window.AppUi.log('Selecione uma unidade cadastrada para remover.', 'warning');
          return;
        }
        if (!confirm('Remover esta unidade da lista de filtros?')) return;

        btnDeleteUnit.disabled = true;
        try {
          const data = await window.AppApi.deleteUnit(selected.unitId);
          if (!data.success) throw new Error(data.error || 'Não foi possível remover a unidade.');
          if (unitFilter) unitFilter.value = '';
          await window.AppSyncController.loadUnits();
          window.AppSyncController.fillUnitFormFromSelection();
          window.AppSyncController.loadPersistedHistory();
          window.AppUi.log('Unidade removida.', 'success');
        } catch (err) {
          window.AppUi.log(`Erro ao remover unidade: ${err.message}`, 'error');
        } finally {
          btnDeleteUnit.disabled = false;
        }
      });
    }

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

    if (navDashboard) {
      navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navDashboard, viewDashboardContent, 'Dashboard', 'Resumo de cidades e total de XMLs persistidos');
      });
    }
    if (navDownload) {
      navDownload.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navDownload, viewDownloadContent, 'XMLs por Unidade', 'XMLs NFS-e persistidos por certificado e unidade');
      });
    }
    if (navCertificado) {
      navCertificado.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navCertificado, viewCertificadoContent, 'Certificados', 'Gerencie certificados A1 e nomes internos');
      });
    }
    if (navRegras) {
      navRegras.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navRegras, viewRegrasContent, 'Regras ADN', 'Limites de consulta e boas praticas da NFS-e Nacional');
      });
    }

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        window.AppUtils.applyTheme(newTheme);
        window.AppUi.log(`Tema alternado para o modo ${newTheme === 'light' ? 'claro' : 'escuro'}.`);
      });
    }

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
            includeCancelled: includeCancelled?.checked ? 'true' : 'false'
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

window.loadSchedulerSettings = loadSchedulerSettings;
