/** Buffer em memória de saúde da API ADN (fallback se RPC ainda não existir). */
const MAX_SAMPLES = 500;
const samples = [];

function recordSample(sample) {
  samples.push({
    ...sample,
    createdAt: new Date().toISOString()
  });
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

function summarize(hours = 24) {
  const since = Date.now() - hours * 3600 * 1000;
  const window = samples.filter(s => new Date(s.createdAt).getTime() >= since);
  const total = window.length;
  const ok = window.filter(s => s.success).length;
  const latencies = window.map(s => Number(s.latencyMs)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const p95 = latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
    : 0;
  const lastErr = [...window].reverse().find(s => !s.success);

  let status = 'unknown';
  if (total > 0) {
    const rate = ok / total;
    status = rate >= 0.95 ? 'healthy' : rate >= 0.8 ? 'degraded' : 'down';
  }

  return {
    windowHours: hours,
    total,
    success: ok,
    errors: Math.max(total - ok, 0),
    successRate: total === 0 ? null : Math.round((ok / total) * 1000) / 10,
    avgLatencyMs: avg,
    p95LatencyMs: p95,
    lastError: lastErr?.errorMessage || null,
    lastErrorAt: lastErr?.createdAt || null,
    status,
    source: 'memory'
  };
}

module.exports = {
  recordSample,
  summarize,
  getSamples: () => samples.slice()
};
