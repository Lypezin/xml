const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1';
const CONFIG_DIR = path.join(process.cwd(), 'config');
const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');
const CERTS_DIR = path.join(CONFIG_DIR, 'certificates');
const CERTS_INDEX_FILE = path.join(CONFIG_DIR, 'certificates.json');
const SUPABASE_CONFIG_FILE = path.join(CONFIG_DIR, 'supabase.json');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

module.exports = {
  IS_VERCEL,
  CONFIG_DIR,
  DOWNLOADS_DIR,
  CERTS_DIR,
  CERTS_INDEX_FILE,
  SUPABASE_CONFIG_FILE,
  SETTINGS_FILE
};
