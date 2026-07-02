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
      selectCertificate.addEventListener('change', () => window.AppSyncController.selectCertificateById(selectCertificate.value));
    }

    btnStart.addEventListener('click', () => {
      if (window.isQuerying) {
        window.isPaused = true;
        window.AppUi.setBtnStartActive(false, true);
        btnPause.disabled = true;
        window.AppUi.log('Sincronização pausada pelo usuário.', 'warning');
        window.isQuerying = false;
      } else {
        const wasPaused = window.isPaused;
        window.isQuerying = true;
        window.isPaused = false;
        alertRateLimit.style.display = 'none';
        alertSyncSuccess.style.display = 'none';
        window.AppUi.setBtnStartActive(true);
        btnPause.disabled = false;
        
        if (!wasPaused && window.totalDownloaded > 0) {
          window.totalDownloaded = 0;
          statTotalNotas.innerText = '0';
        }

        if (window.totalDownloaded === 0) {
          const mode = selectSearchMode ? selectSearchMode.value : 'asc';
          window.currentNsu = parseInt(inputStartNsu.value) || 0;
          window.isCrawlerActive = false;
          window.crawlerVisited = new Set();
          window.crawlerQueue = [];
          window.currentCrawlerCnpj = inputCnpjConsulta.value.trim();
          window.AppUi.updateCrawlerUI();
          
          if (mode === 'desc' && window.currentNsu === 0) {
            window.AppUi.log(`Descobrindo NSU mais recente na Receita Federal para busca reversa...`);
            window.AppSyncController.discoverAndStart();
            return;
          } else {
            window.AppUi.log(`Iniciando nova busca em lote a partir do NSU ${window.currentNsu}...`);
          }
        } else {
          window.AppUi.log(`Retomando busca a partir do NSU ${window.currentNsu}...`);
        }
        
        window.AppSyncController.runQueryLoop();
      }
    });

    btnPause.addEventListener('click', () => {
      window.isPaused = true;
      window.AppUi.setBtnStartActive(false, true);
      btnPause.disabled = true;
      window.AppUi.log('Sincronização pausada pelo usuário.', 'warning');
      window.isQuerying = false;
    });

    tableBody.addEventListener('click', async (e) => {
      const button = e.target.closest('button[data-action="download-xml"]');
      if (!button) return;

      try {
        await window.AppApi.downloadFromApi(`/api/download-xml/${button.dataset.token}`, 'nfse.xml');
        window.AppUi.log('XML baixado com sucesso.', 'success');
      } catch (err) {
        window.AppUi.log(`Erro ao baixar XML: ${err.message}`, 'error');
      }
    });

    btnClearDownloads.addEventListener('click', async () => {
      if (!confirm('Tem certeza que deseja limpar os XMLs consultados nesta sessão?')) return;

      try {
        const data = await window.AppApi.clearDownloads();
        if (data.success) {
          window.AppUi.log(`Sessão limpa. Removidos ${data.count} XMLs.`);
          tableBody.innerHTML = `
            <tr id="empty-row">
              <td colspan="7" class="text-center">Nenhum documento baixado nesta sessão.</td>
            </tr>
          `;
          window.totalDownloaded = 0;
          statTotalNotas.innerText = '0';
          btnDownloadZip.disabled = true;
          window.AppUi.updateProgress(0, 0);
          statNsuAtual.innerText = '0';
          statNsuMax.innerText = '0';
          alertRateLimit.style.display = 'none';
          alertSyncSuccess.style.display = 'none';
        }
      } catch (err) {
        window.AppUi.log(`Erro ao limpar pasta: ${err.message}`, 'error');
      }
    });

    btnDownloadZip.addEventListener('click', async () => {
      window.AppUi.log('Baixando pacote compactado ZIP contendo todos os XMLs...');
      try {
        await window.AppApi.downloadFromApi('/api/download-zip', 'NFS-e_XMLs_Baixados.zip');
      } catch (err) {
        window.AppUi.log(`Erro ao baixar ZIP: ${err.message}`, 'error');
      }
    });

    selectEnvironment.addEventListener('change', () => {
      const envText = selectEnvironment.value === 'producao' ? 'Produção' : 'Homologação';
      const statAmbiente = document.getElementById('stat-ambiente');
      if (statAmbiente) {
        statAmbiente.innerText = envText;
        statAmbiente.className = selectEnvironment.value === 'producao' ? 'metric-value text-primary' : 'metric-value text-warning';
      }
      window.AppUi.log(`Ambiente alterado para: ${envText}`);
    });

    if (navDownload) {
      navDownload.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navDownload, viewDownloadContent, 'Painel de Sincronização', 'Gerencie o download de documentos fiscais mTLS');
      });
    }
    if (navCertificado) {
      navCertificado.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navCertificado, viewCertificadoContent, 'Configuração do Certificado', 'Gerencie as chaves de criptografia e senhas da empresa');
      });
    }
    if (navRegras) {
      navRegras.addEventListener('click', (e) => {
        e.preventDefault();
        window.AppUi.switchTab(navRegras, viewRegrasContent, 'Regras e Limites', 'Entenda como o barramento da Receita Federal e da NFS-e operam');
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
  }
};
