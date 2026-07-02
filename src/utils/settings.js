const fs = require('fs');
const { SETTINGS_FILE, IS_VERCEL } = require('../config/constants');

function getSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) {
      console.error('Erro ao ler settings.json:', e);
    }
  }
  return null;
}

function saveSettings(settings) {
  if (IS_VERCEL) return;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = {
  getSettings,
  saveSettings
};
