const express = require('express');
const scheduler = require('../services/scheduler');
const {
  loadSchedulerSettings,
  persistSchedulerSettings,
  normalizeSchedulerSettings
} = require('../services/schedulerSettings');

const router = express.Router();

router.get('/scheduler-settings', async (req, res) => {
  try {
    const settings = await loadSchedulerSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/scheduler-settings', async (req, res) => {
  try {
    const settings = normalizeSchedulerSettings(req.body);
    await persistSchedulerSettings(settings);

    if (settings.autoSyncEnabled) {
      console.log('[Scheduler] Configuracoes alteradas: ativando varredura agendada.');
      scheduler.start();
      scheduler.checkAndRun();
    } else {
      console.log('[Scheduler] Configuracoes alteradas: desativando varredura.');
      scheduler.stop();
    }

    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/scheduler-run', async (req, res) => {
  try {
    const result = await scheduler.checkAndRun({ force: true });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/scheduler-cron', async (req, res) => {
  try {
    const result = await scheduler.checkAndRun({ force: false });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
