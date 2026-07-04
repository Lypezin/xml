const { IS_VERCEL } = require('../config/constants');
const { getSettings, saveSettings } = require('../utils/settings');
const { getSupabaseConfig, getSupabaseSetting, setSupabaseSetting } = require('./supabase');

const SCHEDULER_SETTINGS_KEY = 'scheduler_settings';

function getDefaultSchedulerSettings() {
  return {
    autoSyncEnabled: false,
    autoSyncIntervalHours: 12,
    autoSyncEnvironment: 'producao',
    autoSyncMaxBatchesPerRun: 1,
    autoSyncDelaySeconds: 2
  };
}

function normalizeSchedulerSettings(input = {}) {
  return {
    ...getDefaultSchedulerSettings(),
    ...input,
    autoSyncEnabled: Boolean(input.autoSyncEnabled),
    autoSyncIntervalHours: Math.max(1, Number(input.autoSyncIntervalHours) || 12),
    autoSyncEnvironment: input.autoSyncEnvironment === 'homologacao' ? 'homologacao' : 'producao',
    autoSyncMaxBatchesPerRun: Math.max(1, Math.min(Number(input.autoSyncMaxBatchesPerRun) || 1, 5)),
    autoSyncDelaySeconds: 2
  };
}

function shouldUseRemoteSettings() {
  return IS_VERCEL || process.env.CERT_STORAGE_MODE === 'supabase';
}

async function loadSchedulerSettings() {
  if (shouldUseRemoteSettings() && getSupabaseConfig()) {
    const remoteSettings = await getSupabaseSetting(SCHEDULER_SETTINGS_KEY);
    return normalizeSchedulerSettings(remoteSettings || {});
  }

  return normalizeSchedulerSettings(getSettings() || {});
}

async function persistSchedulerSettings(settings) {
  const normalized = normalizeSchedulerSettings(settings);

  if (shouldUseRemoteSettings() && getSupabaseConfig()) {
    await setSupabaseSetting(SCHEDULER_SETTINGS_KEY, normalized);
    return normalized;
  }

  saveSettings({
    ...(getSettings() || {}),
    ...normalized
  });

  return normalized;
}

module.exports = {
  getDefaultSchedulerSettings,
  normalizeSchedulerSettings,
  loadSchedulerSettings,
  persistSchedulerSettings
};
