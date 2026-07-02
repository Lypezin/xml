const axios = require('axios');
const fs = require('fs');
const { SUPABASE_CONFIG_FILE } = require('../config/constants');

function getSupabaseConfig() {
  const envUrl = process.env.SUPABASE_URL;
  const envKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const envSecret = process.env.SUPABASE_APP_SECRET;

  if (envUrl && envKey && envSecret) {
    return {
      url: String(envUrl).replace(/\/+$/, ''),
      key: envKey,
      appSecret: envSecret
    };
  }

  if (!fs.existsSync(SUPABASE_CONFIG_FILE)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(SUPABASE_CONFIG_FILE, 'utf8'));
    if (config.url && config.key && config.appSecret) {
      return {
        url: String(config.url).replace(/\/+$/, ''),
        key: config.key,
        appSecret: config.appSecret
      };
    }
  } catch (e) {
    console.error('Erro ao ler supabase.json:', e.message);
  }

  return null;
}

async function getSupabaseUserFromToken(token) {
  const config = getSupabaseConfig();
  if (!config || !token) return null;

  try {
    const res = await axios.get(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`
      }
    });

    return res.data;
  } catch (err) {
    return null;
  }
}

async function supabaseRpc(functionName, params = {}) {
  const config = getSupabaseConfig();
  if (!config) return null;

  try {
    const res = await axios.post(
      `${config.url}/rest/v1/rpc/${functionName}`,
      {
        p_secret: config.appSecret,
        ...params
      },
      {
        headers: {
          apikey: config.key,
          'Content-Type': 'application/json'
        }
      }
    );
    return res.data;
  } catch (err) {
    console.error(`Erro ao chamar RPC ${functionName}:`, err.response?.data || err.message);
    throw err;
  }
}

module.exports = {
  getSupabaseConfig,
  getSupabaseUserFromToken,
  supabaseRpc
};
