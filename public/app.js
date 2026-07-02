// Estado Global do Frontend
let isQuerying = false;
let isPaused = false;
let currentNsu = 0;
let maxNsu = 0;
let totalDownloaded = 0;
let selectedFile = null;
let certificates = [];
let activeCertificateId = null;
let authConfig = { authRequired: false, supabaseUrl: null, publishableKey: null };
let authSession = null;

const AUTH_STORAGE_KEY = 'xml_nfse_auth_session';
const originalFetch = window.fetch.bind(window);

window.fetch = (resource, options = {}) => {
  const url = typeof resource === 'string' ? resource : resource.url;
  const shouldAttachAuth = authSession?.access_token && url && url.startsWith('/api/') && url !== '/api/auth-config';

  if (!shouldAttachAuth) {
    return originalFetch(resource, options);
  }

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${authSession.access_token}`);

  return originalFetch(resource, {
    ...options,
    headers
  });
};

// Elementos DOM
const authScreen = document.getElementById('auth-screen');
const appLayout = document.getElementById('app-layout');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authMessage = document.getElementById('auth-message');
const authUserEmail = document.getElementById('auth-user-email');
const btnLogout = document.getElementById('btn-logout');

const dropZone = document.getElementById('drop-zone-view');
const fileInput = document.getElementById('file-cert-view');
const fileNamePreview = document.getElementById('file-name-preview-view');
const formCert = document.getElementById('form-cert-view');
const passphraseInput = document.getElementById('passphrase-view');
const certCnpjInput = document.getElementById('cert-cnpj-view');
const certUploadState = document.getElementById('cert-upload-state-view');
const certActiveState = document.getElementById('cert-active-state-view');
const activeCertName = document.getElementById('active-cert-name-view');
const activeCertCnpj = document.getElementById('active-cert-cnpj-view');
const btnReplaceCert = document.getElementById('btn-replace-cert-view');
const certList = document.getElementById('cert-list');
const certCountLabel = document.getElementById('cert-count-label');

const selectCertificate = document.getElementById('certificate-select');
const selectEnvironment = document.getElementById('environment');
const selectSearchMode = document.getElementById('search-mode');
const inputCnpjConsulta = document.getElementById('cnpj-consulta');
const inputStartNsu = document.getElementById('start-nsu');
const inputLimiteNotas = document.getElementById('limite-notas');
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');

const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercentage = document.getElementById('progress-percentage');
const statNsuAtual = document.getElementById('stat-nsu-atual');
const statNsuMax = document.getElementById('stat-nsu-max');
const statTotalNotas = document.getElementById('stat-total-notas');
const alertRateLimit = document.getElementById('alert-rate-limit');
const alertSyncSuccess = document.getElementById('alert-sync-success');
const consoleLog = document.getElementById('console-log');

const btnClearDownloads = document.getElementById('btn-clear-downloads');
const btnDownloadZip = document.getElementById('btn-download-zip');
const tableBody = document.getElementById('table-body');

// ----------------------------------------------------
// AUTENTICACAO
// ----------------------------------------------------
function setAuthMessage(message, type = '') {
  if (!authMessage) return;
  authMessage.textContent = message || '';
  authMessage.className = `auth-message ${type}`.trim();
}

function saveAuthSession(session) {
  authSession = session;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearAuthSession() {
  authSession = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function loadStoredAuthSession() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    return null;
  }
}

async function loadAuthConfig() {
  const res = await originalFetch('/api/auth-config');
  authConfig = await res.json();
  return authConfig;
}

async function validateAuthSession(session) {
  if (!session?.access_token || !authConfig.supabaseUrl || !authConfig.publishableKey) {
    return null;
  }

  const res = await originalFetch(`${authConfig.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: authConfig.publishableKey,
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

async function loginWithPassword(email, password) {
  const res = await originalFetch(`${authConfig.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: authConfig.publishableKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.error || 'Login inválido.');
  }

  saveAuthSession(data);
  return data.user;
}

function showAuthenticatedApp(user) {
  if (authScreen) authScreen.style.display = 'none';
  if (appLayout) appLayout.style.display = 'grid';
  if (authUserEmail) authUserEmail.textContent = user?.email || 'Sessão ativa';
}

function showLogin() {
  if (appLayout) appLayout.style.display = 'none';
  if (authScreen) authScreen.style.display = 'grid';
}

async function initializeAuthenticatedApp() {
  await loadAuthConfig();

  if (!authConfig.authRequired) {
    if (appLayout) appLayout.style.display = 'grid';
    if (authScreen) authScreen.style.display = 'none';
    checkCertStatus();
    updateProgress(0, 0);
    selectEnvironment.dispatchEvent(new Event('change'));
    return;
  }

  const storedSession = loadStoredAuthSession();
  const user = await validateAuthSession(storedSession);
  if (!user) {
    clearAuthSession();
    showLogin();
    return;
  }

  authSession = storedSession;
  showAuthenticatedApp(user);
  checkCertStatus();
  updateProgress(0, 0);
  selectEnvironment.dispatchEvent(new Event('change'));
}

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthMessage('Entrando...');
    authSubmit.disabled = true;

    try {
      const user = await loginWithPassword(authEmail.value.trim(), authPassword.value);
      setAuthMessage('Acesso liberado.', 'success');
      showAuthenticatedApp(user);
      checkCertStatus();
      updateProgress(0, 0);
      selectEnvironment.dispatchEvent(new Event('change'));
    } catch (err) {
      clearAuthSession();
      setAuthMessage(err.message, 'error');
    } finally {
      authSubmit.disabled = false;
    }
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    clearAuthSession();
    stopQuerying();
    showLogin();
  });
}

// ----------------------------------------------------
// LOGS E TERMINAL
// ----------------------------------------------------
function log(message, type = 'system') {
  const timestamp = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerText = `[${timestamp}] ${message}`;
  consoleLog.appendChild(line);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

// ----------------------------------------------------
// DRAG AND DROP
// ----------------------------------------------------
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    handleFileSelection(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelection(e.target.files[0]);
  }
});

function handleFileSelection(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension !== 'pfx' && extension !== 'p12') {
    log('Erro: Selecione apenas arquivos .pfx ou .p12', 'error');
    selectedFile = null;
    fileNamePreview.innerText = '';
    return;
  }
  selectedFile = file;
  fileNamePreview.innerText = `Arquivo selecionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  log(`Arquivo selecionado: ${file.name}`);
}

// ----------------------------------------------------
// CONFIGURAÇÃO DO CERTIFICADO
// ----------------------------------------------------
formCert.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!selectedFile) {
    log('Erro: Por favor, selecione um arquivo de certificado.', 'error');
    alert('Por favor, selecione o arquivo do certificado digital.');
    return;
  }

  const formData = new FormData();
  formData.append('pfx', selectedFile);
  formData.append('passphrase', passphraseInput.value);
  formData.append('cnpj', certCnpjInput.value);

  log('Enviando certificado para validação local...');
  document.getElementById('btn-save-cert-view').disabled = true;

  try {
    const res = await fetch('/api/upload-certificate', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      log('Certificado carregado e validado com sucesso no servidor!', 'success');
      checkCertStatus();
      formCert.reset();
      selectedFile = null;
      fileNamePreview.innerText = '';
    } else {
      log(`Erro na validação do certificado: ${data.error}`, 'error');
      alert(`Falha no certificado: ${data.error}`);
    }
  } catch (err) {
    log(`Erro de rede ao salvar certificado: ${err.message}`, 'error');
  } finally {
    document.getElementById('btn-save-cert-view').disabled = false;
  }
});

async function checkCertStatus() {
  try {
    const res = await fetch('/api/certificate-status');
    const data = await res.json();

    const navbarCertIndicator = document.getElementById('navbar-cert-indicator');
    const navbarCertText = document.getElementById('navbar-cert-text');
    certificates = data.certificates || [];
    activeCertificateId = data.activeCertificateId || null;
    renderCertificateSelector();
    renderCertificateList();

    if (data.active) {
      certUploadState.classList.remove('active');
      certActiveState.classList.add('active');
      activeCertName.innerText = `Arquivo: ${data.filename}`;
      activeCertCnpj.innerText = `CNPJ cadastrado: ${data.cnpj || 'Não informado'}`;
      btnStart.disabled = false;
      log(`Certificado ativo encontrado para o CNPJ: ${data.cnpj}`);
      
      if (navbarCertIndicator && navbarCertText) {
        navbarCertIndicator.className = 'status-indicator online';
        navbarCertText.innerText = `Certificado Ativo: ${data.cnpj}`;
      }
    } else {
      certUploadState.classList.add('active');
      certActiveState.classList.remove('active');
      btnStart.disabled = true;
      log('Nenhum certificado carregado. Por favor, envie um certificado para habilitar consultas.', 'warning');
      
      if (navbarCertIndicator && navbarCertText) {
        navbarCertIndicator.className = 'status-indicator offline';
        navbarCertText.innerText = `Nenhum certificado carregado`;
      }
    }
  } catch (err) {
    console.error('Erro ao verificar status do certificado:', err);
  }
}

function renderCertificateSelector() {
  if (!selectCertificate) return;

  selectCertificate.innerHTML = '';
  if (certificates.length === 0) {
    selectCertificate.innerHTML = '<option value="">Nenhum certificado cadastrado</option>';
    return;
  }

  certificates.forEach(cert => {
    const option = document.createElement('option');
    option.value = cert.id;
    option.textContent = `${cert.cnpj || 'CNPJ não informado'} - ${cert.filename}`;
    option.selected = cert.id === activeCertificateId;
    selectCertificate.appendChild(option);
  });
}

function renderCertificateList() {
  if (!certList) return;

  if (certCountLabel) {
    certCountLabel.innerText = `${certificates.length} certificado${certificates.length === 1 ? '' : 's'}`;
  }

  if (certificates.length === 0) {
    certList.innerHTML = '<div class="empty-cert-list">Nenhum certificado cadastrado.</div>';
    return;
  }

  certList.innerHTML = '';
  certificates.forEach(cert => {
    const item = document.createElement('div');
    item.className = `cert-list-item ${cert.id === activeCertificateId ? 'active' : ''}`;
    item.innerHTML = `
      <div class="cert-list-main">
        <strong>${cert.filename}</strong>
        <span>CNPJ: ${cert.cnpj || 'Não informado'}</span>
      </div>
      <div class="cert-list-actions">
        <button class="btn btn-secondary btn-sm" data-action="select-cert" data-id="${cert.id}" ${cert.id === activeCertificateId ? 'disabled' : ''}>Usar</button>
        <button class="btn btn-secondary btn-sm text-danger" data-action="remove-cert" data-id="${cert.id}">Remover</button>
      </div>
    `;
    certList.appendChild(item);
  });
}

async function selectCertificateById(certificateId) {
  if (!certificateId) return;

  try {
    const res = await fetch('/api/select-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId })
    });
    const data = await res.json();

    if (!data.success) {
      log(`Erro ao selecionar certificado: ${data.error}`, 'error');
      return;
    }

    activeCertificateId = data.activeCertificateId;
    log('Certificado selecionado para consulta.', 'success');
    checkCertStatus();
  } catch (err) {
    log(`Erro ao selecionar certificado: ${err.message}`, 'error');
  }
}

if (selectCertificate) {
  selectCertificate.addEventListener('change', () => {
    selectCertificateById(selectCertificate.value);
  });
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
      const cert = certificates.find(item => item.id === certificateId);
      if (!confirm(`Deseja remover o certificado "${cert?.filename || certificateId}"?`)) {
        return;
      }

      const res = await fetch('/api/remove-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificateId })
      });
      const data = await res.json();
      if (data.success) {
        log('Certificado removido localmente.');
        checkCertStatus();
        stopQuerying();
      } else {
        log(`Erro ao remover certificado: ${data.error}`, 'error');
      }
    }
  });
}

btnReplaceCert.addEventListener('click', async () => {
  if (!activeCertificateId || !confirm('Deseja realmente remover o certificado ativo? Ele será excluído das configurações locais.')) {
    return;
  }

  try {
    const res = await fetch('/api/remove-certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateId: activeCertificateId })
    });
    const data = await res.json();
    if (data.success) {
      log('Certificado removido localmente.');
      checkCertStatus();
      stopQuerying();
    }
  } catch (err) {
    log(`Erro ao remover certificado: ${err.message}`, 'error');
  }
});

// Helper para atualizar ícone e texto do botão de início sem emojis
function setBtnStartActive(active, isResume = false) {
  if (active) {
    btnStart.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
      <span>Pausar Consulta</span>
    `;
    btnStart.className = 'btn btn-danger';
  } else {
    btnStart.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>${isResume ? 'Continuar Consulta' : 'Iniciar Consulta'}</span>
    `;
    btnStart.className = 'btn btn-success';
  }
}

// ----------------------------------------------------
// CONTROLE DE CONSULTAS (LOOP BATCH)
// ----------------------------------------------------
btnStart.addEventListener('click', () => {
  if (isQuerying) {
    // Pausar
    isPaused = true;
    setBtnStartActive(false, true);
    btnPause.disabled = true;
    log('Sincronização pausada pelo usuário.', 'warning');
    isQuerying = false;
  } else {
    const wasPaused = isPaused;
    // Iniciar ou Retomar
    isQuerying = true;
    isPaused = false;
    alertRateLimit.style.display = 'none';
    alertSyncSuccess.style.display = 'none';
    setBtnStartActive(true);
    btnPause.disabled = false;
    
    // Se não estava pausado, resetar totalDownloaded para começar limpo
    if (!wasPaused && totalDownloaded > 0) {
      totalDownloaded = 0;
      statTotalNotas.innerText = '0';
    }

    // Se está iniciando do zero, resgatar os parâmetros
    if (totalDownloaded === 0) {
      const mode = selectSearchMode ? selectSearchMode.value : 'asc';
      currentNsu = parseInt(inputStartNsu.value) || 0;
      
      if (mode === 'desc' && currentNsu === 0) {
        log(`Descobrindo NSU mais recente na Receita Federal para busca reversa...`);
        discoverAndStart();
        return;
      } else {
        log(`Iniciando nova busca em lote a partir do NSU ${currentNsu}...`);
      }
    } else {
      log(`Retomando busca a partir do NSU ${currentNsu}...`);
    }
    
    runQueryLoop();
  }
});

async function discoverAndStart() {
  try {
    const environment = selectEnvironment.value;
    const cnpjConsulta = inputCnpjConsulta.value.trim();
    const certificateId = selectCertificate ? selectCertificate.value : activeCertificateId;
    
    const res = await fetch('/api/discover-nsu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment, cnpjConsulta, certificateId })
    });
    const data = await res.json();
    
    if (data.success && data.maxNSU > 0 && data.reliableMax) {
      maxNsu = data.maxNSU;
      currentNsu = Math.max(0, maxNsu - 50);
      inputStartNsu.value = currentNsu;
      log(`NSU máximo informado pela API: ${maxNsu}. Consultando o último bloco conhecido a partir do NSU ${currentNsu}...`, 'success');
      runQueryLoop();
    } else if (data.success) {
      if (data.maxNSU > 0) {
        maxNsu = data.maxNSU;
        currentNsu = Math.max(0, maxNsu - 50);
        inputStartNsu.value = currentNsu;
        log(`A API nao informou maxNSU oficial, mas estimou ${maxNsu}. Consultando o ultimo bloco conhecido a partir do NSU ${currentNsu}.`, 'warning');
        runQueryLoop();
        return;
      }
      currentNsu = parseInt(inputStartNsu.value) || 0;
      log('A API não informou maxNSU confiável. Consulta seguirá a sequência segura por NSU e a tabela será exibida com os maiores NSUs primeiro.', 'warning');
      runQueryLoop();
    } else {
      log('Erro ao descobrir NSU: ' + (data.error || 'Nenhum documento encontrado.'), 'error');
      stopQuerying();
    }
  } catch (err) {
    log('Falha na descoberta de NSU: ' + err.message, 'error');
    stopQuerying();
  }
}

btnPause.addEventListener('click', () => {
  isPaused = true;
  setBtnStartActive(false, true);
  btnPause.disabled = true;
  log('Sincronização pausada pelo usuário.', 'warning');
  isQuerying = false;
});

function stopQuerying() {
  isQuerying = false;
  isPaused = false;
  setBtnStartActive(false, false);
  btnPause.disabled = true;
}

// Loop Principal de Consulta
async function runQueryLoop() {
  if (isPaused || !isQuerying) {
    return;
  }

  const environment = selectEnvironment.value;
  const cnpjConsulta = inputCnpjConsulta.value.trim();
  const certificateId = selectCertificate ? selectCertificate.value : activeCertificateId;
  const limiteNotas = parseInt(inputLimiteNotas.value) || 0;

  if (!certificateId) {
    log('Selecione um certificado antes de iniciar a consulta.', 'error');
    stopQuerying();
    return;
  }

  log(`Consultando bloco a partir do NSU ${currentNsu}...`);

  try {
    const res = await fetch('/api/fetch-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startNsu: currentNsu,
        environment: environment,
        cnpjConsulta: cnpjConsulta,
        certificateId: certificateId,
        sortOrder: selectSearchMode ? selectSearchMode.value : 'asc'
      })
    });

    const data = await res.json();

    if (!data.success) {
      log(`Erro na resposta da NFS-e: ${data.error}`, 'error');
      if (data.error.includes('Consumo Indevido') || data.error.includes('429') || data.error.includes('656')) {
        alertRateLimit.style.display = 'block';
      } else {
        alert(`Erro na sincronização: ${data.error}`);
      }
      stopQuerying();
      return;
    }

    const { ultNSU, maxNSU, totalFila, documentos } = data;
    
    // Atualizar UI com os dados obtidos
    maxNsu = Math.max(maxNsu, maxNSU);
    statNsuMax.innerText = maxNsu;
    statNsuAtual.innerText = ultNSU;
    
    if (documentos && documentos.length > 0) {
      log(`Lote processado! ${documentos.length} XMLs disponíveis para baixar quando você clicar.`, 'success');
      appendDocumentsToTable(documentos);
      totalDownloaded += documentos.length;
      statTotalNotas.innerText = totalDownloaded;
      btnDownloadZip.disabled = false;
    } else {
      log('Nenhuma nota fiscal encontrada neste bloco que atenda aos filtros.');
    }

    // Calcular progresso baseado nos NSUs
    updateProgress(ultNSU, maxNsu);

    // Controle Inteligente de Parada
    let deveParar = false;
    let motivoParada = '';
    const mode = selectSearchMode ? selectSearchMode.value : 'asc';

    if (mode === 'asc') {
      if (ultNSU >= maxNsu) {
        deveParar = true;
        motivoParada = `O NSU Atual (${ultNSU}) atingiu o limite máximo (${maxNsu}).`;
      }
    } else {
      // Modo descendente
      if (currentNsu <= 0) {
        deveParar = true;
        motivoParada = `A busca reversa atingiu o NSU 0 (início da fila).`;
      }
    }

    if (!deveParar) {
      if (totalFila === 0 && mode === 'asc') {
        deveParar = true;
        motivoParada = `Não há mais documentos disponíveis no servidor nacional.`;
      } else if (limiteNotas > 0 && totalDownloaded >= limiteNotas) {
        deveParar = true;
        motivoParada = `O limite configurado de ${limiteNotas} documentos consultados foi atingido.`;
      }
    }

    if (deveParar) {
      log('==================================================', 'success');
      log(`Sincronização concluída! ${motivoParada}`, 'success');
      log('Consulta finalizada. Use os botões XML ou ZIP para baixar os arquivos desejados.', 'success');
      log('==================================================', 'success');
      alertSyncSuccess.style.display = 'block';
      
      stopQuerying();
      return;
    }

    // Próximo NSU no loop
    if (mode === 'asc') {
      currentNsu = ultNSU;
    } else {
      currentNsu = Math.max(0, currentNsu - 50);
      inputStartNsu.value = currentNsu; // Atualizar UI
    }

    // Intervalo conservador para reduzir risco de consumo indevido em consultas por NSU.
    log('Aguardando 10 segundos antes do próximo bloco para reduzir risco de consumo indevido...');
    setTimeout(runQueryLoop, 10000);

  } catch (err) {
    log(`Erro crítico de comunicação: ${err.message}`, 'error');
    stopQuerying();
  }
}

// ----------------------------------------------------
// ATUALIZAÇÕES DA UI
// ----------------------------------------------------
function updateProgress(current, max) {
  if (max === 0) {
    progressBar.style.width = '0%';
    progressPercentage.innerText = '0%';
    progressText.innerText = 'Nenhuma nota disponível';
    return;
  }
  
  const percentage = Math.min(Math.round((current / max) * 100), 100);
  progressBar.style.width = `${percentage}%`;
  progressPercentage.innerText = `${percentage}%`;
  
  if (percentage >= 100) {
    progressText.innerText = 'Totalmente sincronizado';
  } else {
    progressText.innerText = `Sincronizando: NSU ${current} de ${max}`;
  }
}

function appendDocumentsToTable(docs) {
  const emptyRow = document.getElementById('empty-row');
  if (emptyRow) {
    emptyRow.remove();
  }

  const mode = selectSearchMode ? selectSearchMode.value : 'asc';
  const orderedDocs = [...docs].sort((a, b) => {
    const aNsu = Number(a.nsu || 0);
    const bNsu = Number(b.nsu || 0);
    return mode === 'desc' ? bNsu - aNsu : aNsu - bNsu;
  });

  orderedDocs.forEach(doc => {
    const tr = document.createElement('tr');
    
    // Formatação de Valores R$
    const valorFormatado = parseFloat(doc.valorServico).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });

    tr.innerHTML = `
      <td>
        <strong>${doc.nsu}</strong>
        <div class="helper-text">${doc.tipo || 'N/A'}</div>
      </td>
      <td>
        <span class="tipo-badge ${doc.tipo.toLowerCase()}">${doc.tipo}</span>
        <span class="status-badge ${doc.status === 'Evento' ? 'event' : 'ok'}">${doc.status || 'Autorizada'}</span>
        <div class="helper-text">NFS-e: ${doc.numeroNfse || 'N/A'}</div>
        <div class="helper-text">DPS: ${doc.numeroDps || 'N/A'} / Série ${doc.serieDps || 'N/A'}</div>
      </td>
      <td><span class="cnpj-badge wrap">${doc.chave}</span></td>
      <td>
        <div><strong>Prestador</strong>: ${doc.prestadorNome || 'N/A'}</div>
        <div class="helper-text">CNPJ: ${doc.prestadorCnpj || 'N/A'}</div>
        <div style="height: 6px;"></div>
        <div><strong>Tomador</strong>: ${doc.tomadorNome || 'N/A'}</div>
        <div class="helper-text">CNPJ: ${doc.tomadorCnpj || 'Não cadastrado'}</div>
      </td>
      <td>
        <div class="descricao-texto expanded" title="${doc.descricao || 'N/A'}">${doc.descricao || 'N/A'}</div>
        <div class="helper-text">Município: ${doc.municipioPrestacao || 'N/A'}</div>
        <div class="helper-text">Cód. tributação: ${doc.codigoTributacao || 'N/A'}</div>
        <div class="helper-text">${doc.eventoMotivo && doc.eventoMotivo !== 'N/A' ? doc.eventoMotivo : doc.tributacaoNacional || ''}</div>
      </td>
      <td>
        <strong>${valorFormatado}</strong>
        <div class="helper-text">Emissão: ${doc.dataEmissao || 'N/A'}</div>
        <div class="helper-text">Competência: ${doc.competencia || 'N/A'}</div>
        <div class="helper-text">Processamento: ${doc.dataProcessamento || 'N/A'}</div>
      </td>
      <td>
        <button type="button" class="btn btn-secondary btn-sm" data-action="download-xml" data-token="${doc.token}" style="display:inline-flex; align-items:center; text-decoration:none; padding:4px 8px; gap: 4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>XML</span>
        </button>
      </td>
    `;
    
    tableBody.appendChild(tr);
  });
}

// ----------------------------------------------------
// AÇÕES DO RODAPÉ (ZIP E DIRETÓRIO)
// ----------------------------------------------------
async function downloadFromApi(url, fallbackFileName) {
  const res = await fetch(url);
  if (!res.ok) {
    let message = 'Falha ao baixar arquivo.';
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (e) {
      message = await res.text();
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match ? match[1] : fallbackFileName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

tableBody.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action="download-xml"]');
  if (!button) return;

  try {
    await downloadFromApi(`/api/download-xml/${button.dataset.token}`, 'nfse.xml');
    log('XML baixado com sucesso.', 'success');
  } catch (err) {
    log(`Erro ao baixar XML: ${err.message}`, 'error');
  }
});

btnClearDownloads.addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja limpar os XMLs consultados nesta sessão e a tabela?')) {
    return;
  }

  try {
    const res = await fetch('/api/clear-downloads', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      log(`Sessão limpa. Removidos ${data.count} XMLs temporários/locais.`);
      tableBody.innerHTML = `
        <tr id="empty-row">
          <td colspan="7" class="text-center">Nenhum documento baixado nesta sessão.</td>
        </tr>
      `;
      totalDownloaded = 0;
      statTotalNotas.innerText = '0';
      btnDownloadZip.disabled = true;
      updateProgress(0, 0);
      statNsuAtual.innerText = '0';
      statNsuMax.innerText = '0';
      alertRateLimit.style.display = 'none';
      alertSyncSuccess.style.display = 'none';
    }
  } catch (err) {
    log(`Erro ao limpar pasta: ${err.message}`, 'error');
  }
});

btnDownloadZip.addEventListener('click', async () => {
  log('Baixando pacote compactado ZIP contendo todos os XMLs...');
  try {
    await downloadFromApi('/api/download-zip', 'NFS-e_XMLs_Baixados.zip');
  } catch (err) {
    log(`Erro ao baixar ZIP: ${err.message}`, 'error');
  }
});

// Atualizar Ambiente KPI Card
selectEnvironment.addEventListener('change', () => {
  const envText = selectEnvironment.value === 'producao' ? 'Produção' : 'Homologação';
  const statAmbiente = document.getElementById('stat-ambiente');
  if (statAmbiente) {
    statAmbiente.innerText = envText;
    if (selectEnvironment.value === 'producao') {
      statAmbiente.className = 'metric-value text-primary';
    } else {
      statAmbiente.className = 'metric-value text-warning';
    }
  }
  log(`Ambiente alterado para: ${envText}`);
});

// ----------------------------------------------------
// NAVEGAÇÃO DE PÁGINAS (TABS DO SPA)
// ----------------------------------------------------
const navDownload = document.getElementById('nav-download');
const navCertificado = document.getElementById('nav-certificado');
const navRegras = document.getElementById('nav-regras');

const viewDownloadContent = document.getElementById('view-download-content');
const viewCertificadoContent = document.getElementById('view-certificado-content');
const viewRegrasContent = document.getElementById('view-regras-content');

const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');

function switchTab(activeNav, activeContent, title, subtitle) {
  // Desativar todos os links da sidebar
  [navDownload, navCertificado, navRegras].forEach(nav => {
    if (nav) nav.classList.remove('active');
  });
  // Ocultar todos os conteúdos das páginas
  [viewDownloadContent, viewCertificadoContent, viewRegrasContent].forEach(content => {
    if (content) content.style.display = 'none';
  });

  // Ativar página selecionada
  if (activeNav) activeNav.classList.add('active');
  if (activeContent) activeContent.style.display = 'block';

  // Atualizar cabeçalho da navbar
  if (pageTitle) pageTitle.innerText = title;
  if (pageSubtitle) pageSubtitle.innerText = subtitle;
}

if (navDownload) {
  navDownload.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(navDownload, viewDownloadContent, 'Painel de Sincronização', 'Gerencie o download de documentos fiscais mTLS');
  });
}

if (navCertificado) {
  navCertificado.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(navCertificado, viewCertificadoContent, 'Configuração do Certificado', 'Gerencie as chaves de criptografia e senhas da empresa');
  });
}

if (navRegras) {
  navRegras.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(navRegras, viewRegrasContent, 'Regras e Limites', 'Entenda como o barramento da Receita Federal e da NFS-e operam');
  });
}

// Inicialização do Tema (Light / Dark Mode)
const themeToggle = document.getElementById('theme-toggle');
const themeText = document.getElementById('theme-text');
const sunIcon = document.querySelector('.sun-icon');
const moonIcon = document.querySelector('.moon-icon');

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-mode');
    if (themeText) themeText.innerText = 'Modo Escuro';
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'block';
  } else {
    document.body.classList.remove('light-mode');
    if (themeText) themeText.innerText = 'Modo Claro';
    if (sunIcon) sunIcon.style.display = 'block';
    if (moonIcon) moonIcon.style.display = 'none';
  }
}

// Carregar tema preferido
const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
    log(`Tema alternado para o modo ${newTheme === 'light' ? 'claro' : 'escuro'}.`);
  });
}

// Inicialização
initializeAuthenticatedApp().catch((err) => {
  console.error('Erro ao inicializar autenticação:', err);
  showLogin();
  setAuthMessage('Não foi possível iniciar o login. Verifique as variáveis da Vercel.', 'error');
});
