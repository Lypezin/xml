// Estado Global do Frontend
window.isQuerying = false;
window.isPaused = false;
window.currentNsu = 0;
window.maxNsu = 0;
window.totalDownloaded = 0;
window.selectedFile = null;
window.certificates = [];
window.activeCertificateId = null;
window.authConfig = { authRequired: false, supabaseUrl: null, publishableKey: null };
window.authSession = null;

// Crawler State
window.crawlerQueue = [];
window.crawlerVisited = new Set();
window.isCrawlerActive = false;
window.currentCrawlerCnpj = '';

async function checkCertStatus() {
  try {
    const data = await window.AppApi.fetchCertStatus();
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
      
      if (window.navbarCertIndicator && window.navbarCertText) {
        window.navbarCertIndicator.className = 'status-indicator online';
        window.navbarCertText.innerText = `Certificado Ativo: ${data.cnpj}`;
      }
    } else {
      certUploadState.classList.add('active');
      certActiveState.classList.remove('active');
      btnStart.disabled = true;
      window.AppUi.log('Nenhum certificado carregado. Por favor, envie um certificado para habilitar consultas.', 'warning');
      
      if (window.navbarCertIndicator && window.navbarCertText) {
        window.navbarCertIndicator.className = 'status-indicator offline';
        window.navbarCertText.innerText = `Nenhum certificado carregado`;
      }
    }
  } catch (err) {
    console.error('Erro ao verificar status do certificado:', err);
  }
}

async function selectCertificateById(certificateId) {
  if (!certificateId) return;
  try {
    const data = await window.AppApi.selectCertificate(certificateId);
    if (!data.success) {
      window.AppUi.log(`Erro ao selecionar certificado: ${data.error}`, 'error');
      return;
    }
    window.activeCertificateId = data.activeCertificateId;
    window.AppUi.log('Certificado selecionado para consulta.', 'success');
    checkCertStatus();
  } catch (err) {
    window.AppUi.log(`Erro ao selecionar certificado: ${err.message}`, 'error');
  }
}

async function discoverAndStart() {
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
      runQueryLoop();
    } else if (data.success) {
      if (data.maxNSU > 0) {
        window.maxNsu = data.maxNSU;
        window.currentNsu = Math.max(0, window.maxNsu - 50);
        inputStartNsu.value = window.currentNsu;
        window.AppUi.log(`A API nao informou maxNSU oficial, mas estimou ${window.maxNsu}. Consultando o ultimo bloco conhecido a partir do NSU ${window.currentNsu}.`, 'warning');
        runQueryLoop();
        return;
      }
      window.currentNsu = parseInt(inputStartNsu.value) || 0;
      window.AppUi.log('A API não informou maxNSU confiável. Consulta seguirá a sequência segura por NSU e a tabela será exibida com os maiores NSUs primeiro.', 'warning');
      runQueryLoop();
    } else {
      window.AppUi.log('Erro ao descobrir NSU: ' + (data.error || 'Nenhum documento encontrado.'), 'error');
      window.AppUi.logNationalApiContext(data.nationalApi);
      stopQuerying();
    }
  } catch (err) {
    window.AppUi.log('Falha na descoberta de NSU: ' + err.message, 'error');
    stopQuerying();
  }
}

function stopQuerying() {
  window.isQuerying = false;
  window.isPaused = false;
  window.AppUi.setBtnStartActive(false, false);
  btnPause.disabled = true;
}

async function runQueryLoop() {
  if (window.isPaused || !window.isQuerying) return;

  const environment = selectEnvironment.value;
  const cnpjConsulta = window.currentCrawlerCnpj;
  const certificateId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
  const limiteNotas = parseInt(inputLimiteNotas.value) || 0;

  if (!certificateId) {
    window.AppUi.log('Selecione um certificado antes de iniciar a consulta.', 'error');
    stopQuerying();
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
      stopQuerying();
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
      stopQuerying();
      return;
    }

    if (mode === 'asc') {
      window.currentNsu = ultNSU;
    } else {
      window.currentNsu = Math.max(0, window.currentNsu - 50);
      inputStartNsu.value = window.currentNsu;
    }

    window.AppUi.log('Aguardando 10 segundos antes do próximo bloco para reduzir risco de consumo indevido...');
    setTimeout(runQueryLoop, 10000);

  } catch (err) {
    window.AppUi.log(`Erro crítico de comunicação: ${err.message}`, 'error');
    stopQuerying();
  }
}

async function initializeAuthenticatedApp() {
  await window.AppApi.loadAuthConfig();

  if (!window.authConfig.authRequired) {
    if (appLayout) appLayout.style.display = 'flex';
    if (authScreen) authScreen.style.display = 'none';
    checkCertStatus();
    window.AppUi.updateProgress(0, 0);
    selectEnvironment.dispatchEvent(new Event('change'));
    return;
  }

  const storedSession = window.AppUtils.loadStoredAuthSession();
  const user = await window.AppApi.validateAuthSession(storedSession);
  if (!user) {
    window.AppUtils.clearAuthSession();
    window.AppUi.showLogin();
    return;
  }

  window.authSession = storedSession;
  window.AppUi.showAuthenticatedApp(user);
  checkCertStatus();
  window.AppUi.updateProgress(0, 0);
  selectEnvironment.dispatchEvent(new Event('change'));
}

async function loadAllComponents() {
  const components = [
    { id: 'auth-screen-container', path: 'components/auth-screen.html' },
    { id: 'sidebar-container', path: 'components/sidebar.html' },
    { id: 'view-download-container', path: 'components/sync-panel.html' },
    { id: 'view-certificado-container', path: 'components/certificates-panel.html' },
    { id: 'view-regras-container', path: 'components/rules-panel.html' }
  ];

  for (const component of components) {
    const el = document.getElementById(component.id);
    if (el) {
      const res = await fetch(component.path);
      el.innerHTML = await res.text();
    }
  }
}

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

function bindEvents() {
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      window.AppUi.setAuthMessage('Entrando...');
      authSubmit.disabled = true;

      try {
        const user = await window.AppApi.loginWithPassword(authEmail.value.trim(), authPassword.value);
        window.AppUi.setAuthMessage('Acesso liberado.', 'success');
        window.AppUi.showAuthenticatedApp(user);
        checkCertStatus();
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
      stopQuerying();
      window.AppUi.showLogin();
    });
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileSelection(e.target.files[0]);
  });

  formCert.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.selectedFile) {
      window.AppUi.log('Erro: Por favor, selecione um arquivo de certificado.', 'error');
      alert('Por favor, selecione o arquivo do certificado digital.');
      return;
    }

    const formData = new FormData();
    formData.append('pfx', window.selectedFile);
    formData.append('passphrase', passphraseInput.value);
    formData.append('cnpj', certCnpjInput.value);

    window.AppUi.log('Enviando certificado para validação local...');
    document.getElementById('btn-save-cert-view').disabled = true;

    try {
      const data = await window.AppApi.uploadCertificate(formData);
      if (data.success) {
        window.AppUi.log('Certificado carregado e validado com sucesso no servidor!', 'success');
        checkCertStatus();
        formCert.reset();
        window.selectedFile = null;
        fileNamePreview.innerText = '';
      } else {
        window.AppUi.log(`Erro na validação do certificado: ${data.error}`, 'error');
        alert(`Falha no certificado: ${data.error}`);
      }
    } catch (err) {
      window.AppUi.log(`Erro de rede ao salvar certificado: ${err.message}`, 'error');
    } finally {
      document.getElementById('btn-save-cert-view').disabled = false;
    }
  });

  if (selectCertificate) {
    selectCertificate.addEventListener('change', () => selectCertificateById(selectCertificate.value));
  }

  if (certList) {
    certList.addEventListener('click', async (e) => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;

      const certificateId = button.dataset.id;
      if (button.dataset.action === 'select-cert') {
        await selectCertificateById(certificateId);
        return;
      }

      if (button.dataset.action === 'remove-cert') {
        const cert = window.certificates.find(item => item.id === certificateId);
        if (!confirm(`Deseja remover o certificado "${cert?.filename || certificateId}"?`)) return;

        const data = await window.AppApi.removeCertificate(certificateId);
        if (data.success) {
          window.AppUi.log('Certificado removido localmente.');
          checkCertStatus();
          stopQuerying();
        } else {
          window.AppUi.log(`Erro ao remover certificado: ${data.error}`, 'error');
        }
      }
    });
  }

  btnReplaceCert.addEventListener('click', async () => {
    if (!window.activeCertificateId || !confirm('Deseja realmente remover o certificado ativo? Ele será excluído das configurações locais.')) {
      return;
    }

    try {
      const data = await window.AppApi.removeCertificate(window.activeCertificateId);
      if (data.success) {
        window.AppUi.log('Certificado removido localmente.');
        checkCertStatus();
        stopQuerying();
      }
    } catch (err) {
      window.AppUi.log(`Erro ao remover certificado: ${err.message}`, 'error');
    }
  });

  if (btnDiagnoseCert) {
    btnDiagnoseCert.addEventListener('click', async () => {
      const certificateId = selectCertificate ? selectCertificate.value : window.activeCertificateId;
      const environment = selectEnvironment ? selectEnvironment.value : 'producao';

      if (!certificateId) {
        window.AppUi.log('Nenhum certificado selecionado para diagnosticar.', 'warning');
        return;
      }

      btnDiagnoseCert.disabled = true;
      window.AppUi.log('Diagnosticando certificado, criptografia e ambiente selecionado...');

      try {
        const data = await window.AppApi.diagnoseCertificate(certificateId, environment);
        window.AppUi.log(`Diagnostico: ambiente=${data.environment || environment} | endpoint=${data.nationalApiBaseUrl || 'N/A'}`);
        window.AppUi.log(`CERT_ENCRYPTION_KEY: configurada=${data.encryptionKey?.configured ? 'sim' : 'nao'} | tamanhoValido=${data.encryptionKey?.validLength ? 'sim' : 'nao'} | origem=${data.encryptionKey?.source || 'N/A'}`);

        if (data.success) {
          window.AppUi.log(`PFX OK: descriptografado e validado. Titular=${data.pfx?.subject || 'N/A'} | CNPJ extraido=${data.pfx?.cnpjExtracted || 'N/A'} | validade=${data.pfx?.validUntil || 'N/A'}`, 'success');
        } else {
          window.AppUi.log(`Diagnostico falhou: ${data.error || data.pfx?.error || 'erro desconhecido'}`, 'error');
        }
      } catch (err) {
        window.AppUi.log(`Erro ao diagnosticar certificado: ${err.message}`, 'error');
      } finally {
        btnDiagnoseCert.disabled = false;
      }
    });
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
          discoverAndStart();
          return;
        } else {
          window.AppUi.log(`Iniciando nova busca em lote a partir do NSU ${window.currentNsu}...`);
        }
      } else {
        window.AppUi.log(`Retomando busca a partir do NSU ${window.currentNsu}...`);
      }
      
      runQueryLoop();
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
    if (!confirm('Tem certeza que deseja limpar os XMLs consultados nesta sessão e a tabela?')) return;

    try {
      const data = await window.AppApi.clearDownloads();
      if (data.success) {
        window.AppUi.log(`Sessão limpa. Removidos ${data.count} XMLs temporários/locais.`);
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
    window.AppUi.log(`Ambiente altered para: ${envText}`);
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

// Inicialização do Bootstrap
async function bootstrap() {
  await loadAllComponents();
  window.AppUi.initElements();
  bindEvents();
  await initializeAuthenticatedApp();
}

window.addEventListener('DOMContentLoaded', bootstrap);
