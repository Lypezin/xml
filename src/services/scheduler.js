const { resolveRemoteCertificate, listRemoteCertificates, supabaseRpc } = require('./supabase');
const { getCertificatesIndex, resolveCertificate } = require('./localCertificates');
const { executeSyncBatch } = require('../utils/syncProcessor');
const { startSupabaseRun } = require('./supabase');
const { loadSchedulerSettings, persistSchedulerSettings } = require('./schedulerSettings');

let timerId = null;
let isSyncing = false;

async function resolveActiveCertificate() {
  let selectedCertificate = null;
  const index = getCertificatesIndex();

  if (index.activeCertificateId) {
    selectedCertificate = resolveCertificate(index.activeCertificateId);
  }

  if (!selectedCertificate) {
    const remoteCerts = await listRemoteCertificates();
    const activeRemote = remoteCerts.find(cert => cert.active) || remoteCerts[0];
    if (activeRemote) {
      selectedCertificate = await resolveRemoteCertificate(activeRemote.id);
    }
  }

  return selectedCertificate;
}

async function getCurrentSyncNsu({ certificateId, environment, cnpjConsulta }) {
  const state = await supabaseRpc('xml_nfse_get_sync_state', {
    p_certificate_id: certificateId,
    p_environment: environment,
    p_cnpj_consulta: cnpjConsulta || ''
  });

  if (state && state.last_nsu !== undefined && state.last_nsu !== null) {
    return Number(state.last_nsu);
  }

  return 0;
}

async function checkAndRun(options = {}) {
  const { force = false } = options;

  if (isSyncing) {
    return { started: false, reason: 'sync_already_running' };
  }

  const settings = await loadSchedulerSettings();
  if (!settings.autoSyncEnabled && !force) {
    return { started: false, reason: 'scheduler_disabled' };
  }

  const intervalMs = (Number(settings.autoSyncIntervalHours) || 12) * 60 * 60 * 1000;
  const lastRun = settings.lastRunAt ? new Date(settings.lastRunAt).getTime() : 0;
  const now = Date.now();

  if (!force && now - lastRun < intervalMs) {
    return {
      started: false,
      reason: 'waiting_interval',
      nextRunAt: new Date(lastRun + intervalMs).toISOString()
    };
  }

  isSyncing = true;
  console.log('[Scheduler] Iniciando varredura periodica automatica...');

  try {
    const environment = settings.autoSyncEnvironment === 'homologacao' ? 'homologacao' : 'producao';
    const maxBatches = Math.max(1, Math.min(Number(settings.autoSyncMaxBatchesPerRun) || 1, 5));
    const selectedCertificate = await resolveActiveCertificate();

    if (!selectedCertificate) {
      console.warn('[Scheduler] Varredura abortada: nenhum certificado configurado.');
      return { started: false, reason: 'certificate_not_configured' };
    }

    const cnpjConsulta = selectedCertificate.cnpj || '';
    let currentNsu = await getCurrentSyncNsu({
      certificateId: selectedCertificate.id,
      environment,
      cnpjConsulta
    });

    let finished = false;
    let batches = 0;
    let documentsFound = 0;
    let maxNsuSeen = currentNsu;

    console.log(`[Scheduler] Sincronizando ${cnpjConsulta || 'CNPJ do certificado'} em ${environment} a partir do NSU ${currentNsu}.`);

    while (!finished && batches < maxBatches) {
      const previousNsu = currentNsu;
      const runResult = await startSupabaseRun({
        certificateId: selectedCertificate.id,
        environment,
        cnpjConsulta,
        startNsu: currentNsu
      });

      const result = await executeSyncBatch({
        selectedCertificate,
        requestEnvironment: environment,
        requestStartNsu: currentNsu,
        requestCnpjConsulta: cnpjConsulta,
        sortOrder: 'asc',
        supabaseRunId: runResult ? (runResult.run_id || runResult) : null
      });

      batches += 1;
      currentNsu = Number(result.ultNSU || currentNsu);
      maxNsuSeen = Math.max(maxNsuSeen, Number(result.maxNSU || 0));
      documentsFound += Array.isArray(result.documentos) ? result.documentos.length : 0;

      console.log(`[Scheduler] Lote ${batches}/${maxBatches}: NSU ${currentNsu}/${maxNsuSeen}, documentos ${documentsFound}.`);

      if (currentNsu >= maxNsuSeen || result.totalFila === 0 || currentNsu <= previousNsu) {
        finished = true;
      }
    }

    if (finished) {
      settings.lastRunAt = new Date().toISOString();
      await persistSchedulerSettings(settings);
      console.log('[Scheduler] Varredura concluida.');
    } else {
      console.log(`[Scheduler] Pausando apos ${batches} lote(s); a proxima chamada continua do NSU salvo.`);
    }

    return {
      started: true,
      finished,
      batches,
      documentsFound,
      lastNsu: currentNsu,
      maxNsuSeen
    };
  } catch (err) {
    console.error('[Scheduler] Erro durante a varredura automatica:', err.message);
    return {
      started: true,
      finished: false,
      error: err.message,
      nationalApi: err.nationalApi || null
    };
  } finally {
    isSyncing = false;
  }
}

function start() {
  if (timerId) clearInterval(timerId);
  timerId = setInterval(() => checkAndRun(), 5 * 60 * 1000);
  setTimeout(() => checkAndRun(), 5000);
  console.log('[Scheduler] Servico de varredura periodica ativo.');
}

function stop() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  console.log('[Scheduler] Servico de varredura periodica desativado.');
}

module.exports = {
  start,
  stop,
  checkAndRun,
  getSchedulerSettings: loadSchedulerSettings
};
