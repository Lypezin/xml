// Estado Global do Frontend
window.isQuerying = false;
window.isPaused = false;
window.currentNsu = 0;
window.maxNsu = 0;
window.totalDownloaded = 0;
window.activeQueryRunId = 0;
window.queryLoopTimer = null;
window.transientRetryCount = 0;
window.selectedFile = null;
window.certificates = [];
window.units = [];
window.activeCertificateId = null;
window.authConfig = { authRequired: false, supabaseUrl: null, publishableKey: null };
window.authSession = null;
window._tabCache = { dashboardAt: 0, syncAt: 0, storageAt: 0, nsuAt: 0, dashboardData: null, historyData: null };

// Crawler State
window.crawlerQueue = [];
window.crawlerVisited = new Set();
window.isCrawlerActive = false;
window.currentCrawlerCnpj = '';

// bootstrap/loaders em js/boot.js
// loadAllComponents / initializeAuthenticatedApp / bootstrap definidos em boot.js

// entrypoint real fica em boot.js (DOMContentLoaded)
