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
    window.AppEventsAuth?.bind();
    window.AppEventsSync?.bind();
    window.AppEventsTable?.bind();
    window.AppEventsFilters?.bind();
    window.AppEventsNsu?.bind();
    window.AppEventsNav?.bind();
    window.AppEventsScheduler?.bind();
    window.AppInsights?.bind?.();
    window.AppDocDrawer?.bind?.();
  }
};
