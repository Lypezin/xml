const express = require('express');
const scheduler = require('../services/scheduler');
const {
  loadSchedulerSettings,
  persistSchedulerSettings,
  normalizeSchedulerSettings
} = require('../services/schedulerSettings');
const { safeErrorInfo } = require('../utils/security');

const router = express.Router();

router.get('/scheduler-settings', async (req, res) => {
  try {
    const settings = await loadSchedulerSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    console.error('[scheduler:settings:get]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível carregar as configurações do agendador.' });
  }
});

router.post('/scheduler-settings', async (req, res) => {
  try {
    const settings = normalizeSchedulerSettings(req.body);
    await persistSchedulerSettings(settings);

    scheduler.stop();
    console.log('[Scheduler] Configuracoes manuais salvas. Nenhuma varredura automatica foi iniciada.');

    return res.json({ success: true, settings });
  } catch (err) {
    console.error('[scheduler:settings:save]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível salvar as configurações do agendador.' });
  }
});

router.post('/scheduler-run', async (req, res) => {
  try {
    const result = await scheduler.checkAndRun({ force: true });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[scheduler:run]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível executar a atualização.' });
  }
});

router.get('/scheduler-cron', async (req, res) => {
  try {
    const result = await scheduler.checkAndRun({ force: false });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[scheduler:cron]', safeErrorInfo(err));
    return res.status(500).json({ success: false, error: 'Não foi possível executar a atualização agendada.' });
  }
});

module.exports = router;
