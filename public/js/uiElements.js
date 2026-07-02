// Inicialização de Elementos DOM Globais

window.AppUiElements = {
  initElements() {
    window.authScreen = document.getElementById('auth-screen');
    window.appLayout = document.getElementById('app-layout');
    window.authForm = document.getElementById('auth-form');
    window.authEmail = document.getElementById('auth-email');
    window.authPassword = document.getElementById('auth-password');
    window.authSubmit = document.getElementById('auth-submit');
    window.authMessage = document.getElementById('auth-message');
    window.authUserEmail = document.getElementById('auth-user-email');
    window.btnLogout = document.getElementById('btn-logout');

    window.dropZone = document.getElementById('drop-zone-view');
    window.fileInput = document.getElementById('file-cert-view');
    window.fileNamePreview = document.getElementById('file-name-preview-view');
    window.formCert = document.getElementById('form-cert-view');
    window.passphraseInput = document.getElementById('passphrase-view');
    window.certCnpjInput = document.getElementById('cert-cnpj-view');
    window.certUploadState = document.getElementById('cert-upload-state-view');
    window.certActiveState = document.getElementById('cert-active-state-view');
    window.activeCertName = document.getElementById('active-cert-name-view');
    window.activeCertCnpj = document.getElementById('active-cert-cnpj-view');
    window.btnReplaceCert = document.getElementById('btn-replace-cert-view');
    window.btnDiagnoseCert = document.getElementById('btn-diagnose-cert-view');
    window.certList = document.getElementById('cert-list');
    window.certCountLabel = document.getElementById('cert-count-label');

    window.selectCertificate = document.getElementById('certificate-select');
    window.selectEnvironment = document.getElementById('environment');
    window.selectSearchMode = document.getElementById('search-mode');
    window.inputCnpjConsulta = document.getElementById('cnpj-consulta');
    window.inputStartNsu = document.getElementById('start-nsu');
    window.btnUseSavedNsu = document.getElementById('btn-use-saved-nsu');
    window.btnUseNationalNsu = document.getElementById('btn-use-national-nsu');
    window.inputLimiteNotas = document.getElementById('limite-notes'); // wait, let's verify if it's 'limite-notas' or 'limite-notes'
    // Let's check sync-panel.html: line 104 in the original had id="limite-notas"
    window.inputLimiteNotas = document.getElementById('limite-notas');
    window.btnStart = document.getElementById('btn-start');
    window.btnPause = document.getElementById('btn-pause');

    window.progressBar = document.getElementById('progress-bar');
    window.progressText = document.getElementById('progress-text');
    window.progressPercentage = document.getElementById('progress-percentage');
    window.statNsuAtual = document.getElementById('stat-nsu-atual');
    window.statNsuMax = document.getElementById('stat-nsu-max');
    window.statTotalNotas = document.getElementById('stat-total-notas');
    window.alertRateLimit = document.getElementById('alert-rate-limit');
    window.alertSyncSuccess = document.getElementById('alert-sync-success');
    window.crawlerStatusContainer = document.getElementById('crawler-status-container');
    window.crawlerCurrentCnpj = document.getElementById('crawler-current-cnpj');
    window.crawlerVisitedCount = document.getElementById('crawler-visited-count');
    window.crawlerQueueCount = document.getElementById('crawler-queue-count');
    window.consoleLog = document.getElementById('console-log');

    window.btnClearDownloads = document.getElementById('btn-clear-downloads');
    window.btnDownloadZip = document.getElementById('btn-download-zip');
    window.tableBody = document.getElementById('table-body');
    window.historyCountLabel = document.getElementById('history-count-label');
    window.historyPageInfo = document.getElementById('history-page-info');
    window.btnHistoryPrev = document.getElementById('btn-history-prev');
    window.btnHistoryNext = document.getElementById('btn-history-next');

    window.navDownload = document.getElementById('nav-download');
    window.navCertificado = document.getElementById('nav-certificado');
    window.navRegras = document.getElementById('nav-regras');

    window.viewDownloadContent = document.getElementById('view-download-content');
    window.viewCertificadoContent = document.getElementById('view-certificado-content');
    window.viewRegrasContent = document.getElementById('view-regras-content');

    window.pageTitle = document.getElementById('page-title');
    window.pageSubtitle = document.getElementById('page-subtitle');

    window.themeToggle = document.getElementById('theme-toggle');
    window.themeText = document.getElementById('theme-text');
    window.sunIcon = document.querySelector('.sun-icon');
    window.moonIcon = document.querySelector('.moon-icon');

    window.schedulerEnabled = document.getElementById('scheduler-enabled');
    window.schedulerInterval = document.getElementById('scheduler-interval');
    window.schedulerEnv = document.getElementById('scheduler-env');
    window.schedulerMaxBatches = document.getElementById('scheduler-max-batches');
    window.schedulerDelaySeconds = document.getElementById('scheduler-delay-seconds');
    window.schedulerLastRun = document.getElementById('scheduler-last-run');
    window.schedulerStatus = document.getElementById('scheduler-status');
    window.btnSaveScheduler = document.getElementById('btn-save-scheduler');
    window.btnRunSchedulerNow = document.getElementById('btn-run-scheduler-now');
    window.manualSyncProgressBar = document.getElementById('manual-sync-progress-bar');
    window.manualSyncProgressText = document.getElementById('manual-sync-progress-text');
    window.manualSyncProgressPercentage = document.getElementById('manual-sync-progress-percentage');
    window.downloadStartDate = document.getElementById('download-start-date');
    window.downloadEndDate = document.getElementById('download-end-date');
    window.btnDownloadPeriod = document.getElementById('btn-download-period');
  }
};
