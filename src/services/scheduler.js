const { resolveRemoteCertificate, listRemoteCertificates, supabaseRpc } = require('./supabase');
const { getCertificatesIndex, resolveCertificate } = require('./localCertificates');
const { executeSyncBatch } = require('../utils/syncProcessor');
const {
  startSupabaseRun,
  finishSupabaseRun,
  claimSchedulerLease,
  releaseSchedulerLease
} = require('./supabase');
const { loadSchedulerSettings, persistSchedulerSettings } = require('./schedulerSettings');

let timerId = null;
let isSyncing = false;
const dailyShardsInFlight = new Set();

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

function partitionCertificates(certificates, shard, totalShards) {
  const safeTotal = Math.max(1, Number(totalShards) || 1);
  const safeShard = Math.max(0, Math.min(Number(shard) || 0, safeTotal - 1));
  return [...(certificates || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .filter((_, index) => index % safeTotal === safeShard);
}

async function getCurrentSyncState({ certificateId, environment, cnpjConsulta }) {
  return supabaseRpc('xml_nfse_get_sync_state', {
    p_certificate_id: certificateId,
    p_environment: environment,
    p_cnpj_consulta: cnpjConsulta || ''
  });
}

async function runCertificateRound({ certificate, environment }) {
  const cnpjConsulta = certificate.cnpj || '';
  const state = await getCurrentSyncState({
    certificateId: certificate.id,
    environment,
    cnpjConsulta
  });
  const startNsu = Math.max(0, Number(state?.last_nsu || 0));
  const nextAllowedAt = state?.next_allowed_at ? new Date(state.next_allowed_at).getTime() : 0;
  if (nextAllowedAt > Date.now()) {
    return {
      certificateId: certificate.id,
      cnpj: cnpjConsulta,
      started: false,
      finished: false,
      blockedUntil: new Date(nextAllowedAt).toISOString(),
      startNsu,
      lastNsu: startNsu,
      documentsFound: 0
    };
  }

  let runId = null;
  try {
    const run = await startSupabaseRun({
      certificateId: certificate.id,
      environment,
      cnpjConsulta,
      startNsu
    });
    runId = run ? (run.run_id || run) : null;
    const result = await executeSyncBatch({
      selectedCertificate: certificate,
      requestEnvironment: environment,
      requestStartNsu: startNsu,
      requestCnpjConsulta: cnpjConsulta,
      sortOrder: 'asc',
      supabaseRunId: runId
    });
    const lastNsu = Math.max(startNsu, Number(result.ultNSU || startNsu));
    const maxNsuSeen = Math.max(lastNsu, Number(result.maxNSU || lastNsu));
    return {
      certificateId: certificate.id,
      cnpj: cnpjConsulta,
      started: true,
      finished: result.totalFila === 0 || lastNsu >= maxNsuSeen || lastNsu <= startNsu,
      startNsu,
      lastNsu,
      maxNsuSeen,
      documentsFound: Array.isArray(result.documentos) ? result.documentos.length : 0
    };
  } catch (error) {
    if (runId) {
      await finishSupabaseRun({
        runId,
        status: 'error',
        endNsu: startNsu,
        maxNsuSeen: startNsu,
        documentsFound: 0,
        errorMessage: String(error.message || 'Falha na varredura automática').slice(0, 500)
      }).catch(() => {});
    }
    return {
      certificateId: certificate.id,
      cnpj: cnpjConsulta,
      started: true,
      finished: false,
      startNsu,
      lastNsu: startNsu,
      documentsFound: 0,
      error: String(error.message || 'Falha na varredura automática').slice(0, 300)
    };
  }
}

async function runDailyAllCertificates({
  shard = 0,
  totalShards = 7,
  environment = 'producao',
  maxDurationMs = 52_000,
  maxBatchesPerCertificate = 3
} = {}) {
  const leaseName = `daily-all-certificates-${shard}-of-${totalShards}`;
  const lease = await claimSchedulerLease({ name: leaseName, leaseSeconds: 75 });
  if (!lease?.acquired) {
    return { started: false, reason: 'lease_already_held', shard, totalShards, lockedUntil: lease?.lockedUntil || null };
  }
  if (dailyShardsInFlight.has(leaseName)) {
    await releaseSchedulerLease({ name: leaseName, leaseId: lease.leaseId }).catch(() => {});
    return { started: false, reason: 'sync_already_running', shard, totalShards };
  }

  dailyShardsInFlight.add(leaseName);
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(Math.max(Number(maxDurationMs) || 52_000, 20_000), 52_000);
  const summaries = [];
  try {
    const metadata = partitionCertificates(await listRemoteCertificates(), shard, totalShards);
    const certificates = [];
    for (const item of metadata) {
      try {
        const certificate = await resolveRemoteCertificate(item.id);
        if (certificate) certificates.push(certificate);
        else summaries.push({ certificateId: item.id, started: false, error: 'Certificado indisponível.' });
      } catch (error) {
        summaries.push({ certificateId: item.id, started: false, error: String(error.message || 'Falha ao abrir certificado').slice(0, 300) });
      }
    }

    const rounds = new Map(certificates.map(cert => [cert.id, 0]));
    let pending = [...certificates];
    while (pending.length > 0) {
      const nextPending = [];
      for (const certificate of pending) {
        const completedRounds = rounds.get(certificate.id) || 0;
        // A primeira passagem cobre todos do shard. Passagens extras só iniciam
        // com reserva suficiente para o timeout HTTP da ADN e persistência.
        if (completedRounds > 0 && Date.now() > deadline - 18_000) continue;

        const result = await runCertificateRound({ certificate, environment });
        rounds.set(certificate.id, completedRounds + 1);
        summaries.push({ ...result, round: completedRounds + 1 });

        if (!result.finished && !result.error && !result.blockedUntil && completedRounds + 1 < maxBatchesPerCertificate) {
          nextPending.push(certificate);
        }
      }
      pending = nextPending;
      if (Date.now() > deadline - 18_000) break;
    }

    return {
      started: true,
      shard,
      totalShards,
      environment,
      certificatesInShard: metadata.length,
      durationMs: Date.now() - startedAt,
      summaries
    };
  } finally {
    dailyShardsInFlight.delete(leaseName);
    await releaseSchedulerLease({ name: leaseName, leaseId: lease.leaseId }).catch(() => {});
  }
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
  runDailyAllCertificates,
  partitionCertificates,
  getSchedulerSettings: loadSchedulerSettings
};
