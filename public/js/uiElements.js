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
    window.inputLimiteNotas = document.getElementById('limite-notas');
    window.btnStart = document.getElementById('btn-start');
    window.btnPause = document.getElementById('btn-pause');
    window.btnResetNsu = document.getElementById('btn-reset-nsu');

    window.progressBar = document.getElementById('progress-bar');
    window.progressText = document.getElementById('progress-text');
    window.progressPercentage = document.getElementById('progress-percentage');
    window.statNsuAtual = document.getElementById('stat-nsu-atual');
    window.statNsuMax = document.getElementById('stat-nsu-max');
    window.statTotalNotas = document.getElementById('stat-total-notas');
    window.statTotalValue = document.getElementById('stat-total-value');
    window.statStoragePayloads = document.getElementById('stat-storage-payloads');
    window.statStorageSize = document.getElementById('stat-storage-size');
    window.alertRateLimit = document.getElementById('alert-rate-limit');
    window.alertSyncSuccess = document.getElementById('alert-sync-success');
    window.crawlerStatusContainer = document.getElementById('crawler-status-container');
    window.crawlerCurrentCnpj = document.getElementById('crawler-current-cnpj');
    window.crawlerVisitedCount = document.getElementById('crawler-visited-count');
    window.crawlerQueueCount = document.getElementById('crawler-queue-count');
    window.consoleLog = document.getElementById('console-log');
    window.consoleLogDrawer = document.getElementById('console-log-drawer');
    window.consoleLogHint = document.getElementById('console-log-hint');
    if (window.consoleLogDrawer) {
      consoleLogDrawer.classList.add('is-idle');
    }
    if (window.AppUi?._updateLogHint) window.AppUi._updateLogHint();

    window.btnClearDownloads = document.getElementById('btn-clear-downloads');
    window.btnExportExcel = document.getElementById('btn-export-excel');
    window.btnDownloadZip = document.getElementById('btn-download-zip');
    window.tableBody = document.getElementById('table-body');
    window.historyCountLabel = document.getElementById('history-count-label');
    window.historyPageInfo = document.getElementById('history-page-info');
    window.btnHistoryPrev = document.getElementById('btn-history-prev');
    window.btnHistoryNext = document.getElementById('btn-history-next');
    window.historySearch = document.getElementById('history-search');
    window.includeCancelled = document.getElementById('include-cancelled');
    window.cancelledFilter = document.getElementById('cancelled-filter');

    window.navDashboard = document.getElementById('nav-dashboard');
    window.navDownload = document.getElementById('nav-download');
    window.navCertificado = document.getElementById('nav-certificado');
    window.navRegras = document.getElementById('nav-regras');

    window.viewDashboardContent = document.getElementById('view-dashboard-content');
    window.viewDownloadContent = document.getElementById('view-download-content');
    window.viewCertificadoContent = document.getElementById('view-certificado-content');
    window.viewRegrasContent = document.getElementById('view-regras-content');

    window.dashboardCitiesGrid = document.getElementById('dashboard-cities-grid');
    window.dashboardLoader = document.getElementById('dashboard-loader');
    window.btnRefreshDashboard = document.getElementById('btn-refresh-dashboard');
    window.dashStatCities = document.getElementById('dash-stat-cities');
    window.dashStatActive = document.getElementById('dash-stat-active');
    window.dashStatXmls = document.getElementById('dash-stat-xmls');

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
    window.unitFilter = document.getElementById('unit-filter');
    window.unitPartyRole = document.getElementById('unit-party-role');
    window.unitName = document.getElementById('unit-name');
    window.unitCnpj = document.getElementById('unit-cnpj');
    window.unitCity = document.getElementById('unit-city');
    window.unitState = document.getElementById('unit-state');
    window.btnSaveUnit = document.getElementById('btn-save-unit');
    window.btnDeleteUnit = document.getElementById('btn-delete-unit');
  }
};
