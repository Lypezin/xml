const express = require('express');
const { supabaseRpc } = require('../services/supabaseClient');
const { recordSample, summarize } = require('../services/apiHealth');

const router = express.Router();

router.get('/sync-runs', async (req, res) => {
  try {
    const { certificateId = '', environment = '', limit = '30' } = req.query;
    const rows = await supabaseRpc('xml_nfse_list_sync_runs', {
      p_certificate_id: certificateId || null,
      p_environment: environment || null,
      p_limit: Number(limit) || 30
    });
    return res.json({
      success: true,
      runs: Array.isArray(rows) ? rows : []
    });
  } catch (err) {
    console.warn('[sync-runs]', err.message);
    return res.json({ success: true, runs: [], warning: 'Histórico indisponível até aplicar a migração SQL.' });
  }
});

router.get('/audit-log', async (req, res) => {
  try {
    const { certificateId = '', limit = '50' } = req.query;
    const rows = await supabaseRpc('xml_nfse_list_audit_events', {
      p_limit: Number(limit) || 50,
      p_certificate_id: certificateId || null
    });
    return res.json({
      success: true,
      events: Array.isArray(rows) ? rows : []
    });
  } catch (err) {
    console.warn('[audit-log]', err.message);
    return res.json({ success: true, events: [], warning: 'Auditoria indisponível até aplicar a migração SQL.' });
  }
});

router.get('/api-health', async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
  try {
    const remote = await supabaseRpc('xml_nfse_get_api_health_summary', {
      p_hours: hours
    });
    if (remote && typeof remote === 'object') {
      return res.json({ success: true, health: { ...remote, source: 'supabase' } });
    }
  } catch (err) {
    // fallback memória
  }
  return res.json({ success: true, health: summarize(hours) });
});

router.post('/api-health', async (req, res) => {
  const body = req.body || {};
  const sample = {
    certificateId: body.certificateId || null,
    environment: body.environment || 'producao',
    endpoint: body.endpoint || 'DFe',
    httpStatus: body.httpStatus == null ? null : Number(body.httpStatus),
    latencyMs: body.latencyMs == null ? null : Number(body.latencyMs),
    success: Boolean(body.success),
    errorMessage: body.errorMessage || null
  };

  recordSample(sample);

  try {
    await supabaseRpc('xml_nfse_record_api_health', {
      p_certificate_id: sample.certificateId,
      p_environment: sample.environment,
      p_endpoint: sample.endpoint,
      p_http_status: sample.httpStatus,
      p_latency_ms: sample.latencyMs,
      p_success: sample.success,
      p_error_message: sample.errorMessage
    });
  } catch (err) {
    // ok — memória já guardou
  }

  return res.json({ success: true });
});

router.get('/dashboard-analytics', async (req, res) => {
  try {
    const environment = req.query.environment === 'homologacao' ? 'homologacao' : 'producao';
    const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));
    const analytics = await supabaseRpc('xml_nfse_get_dashboard_analytics', {
      p_environment: environment,
      p_months: months
    });
    return res.json({ success: true, analytics });
  } catch (err) {
    console.warn('[dashboard-analytics]', err.message);
    return res.json({
      success: true,
      analytics: {
        totals: { documents: 0, cancelled: 0, value: 0 },
        monthly: [],
        rankingPrestador: [],
        rankingTomador: [],
        comparisons: {
          monthOverMonth: { current: 0, previous: 0, deltaPct: null },
          yearOverYear: { current: 0, previous: 0, deltaPct: null }
        }
      },
      warning: 'Analytics indisponível até aplicar a migração SQL (supabase_features_ops_insights.sql).'
    });
  }
});

module.exports = router;
