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

const HEAVY_RPCS = new Set([
  'xml_nfse_list_documents',
  'xml_nfse_get_document_totals',
  'xml_nfse_get_dashboard_summary',
  'xml_nfse_get_dashboard_analytics',
  'xml_nfse_storage_summary',
  'xml_nfse_get_xml_payloads_by_tokens',
  'xml_nfse_list_xml_payloads',
  'xml_nfse_list_sync_runs'
]);

function getRpcTimeout(functionName) {
  if (HEAVY_RPCS.has(functionName)) return 30000;
  return 12000;
}

function getRpcRetries(functionName) {
  // Listagens pesadas: no max 1 retry (evita 3x carga no banco)
  if (HEAVY_RPCS.has(functionName)) return 2;
  return 3;
}

async function supabaseRpc(functionName, params = {}, retries = null, delay = 1000) {
  const config = getSupabaseConfig();
  if (!config) return null;

  const maxRetries = retries === null ? getRpcRetries(functionName) : retries;
  const timeout = getRpcTimeout(functionName);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
          },
          timeout
        }
      );
      return res.data;
    } catch (err) {
      const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(String(err.message || ''));
      const isNetworkOr5xx = !err.response || (err.response.status >= 500);
      // Nao re-tenta cegamente timeouts de listagem pesada alem do limite
      if (attempt < maxRetries && (isNetworkOr5xx || isTimeout)) {
        console.warn(`RPC ${functionName} falhou (tentativa ${attempt}/${maxRetries}). Retentando em ${delay}ms... Erro: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      console.error(`Erro ao chamar RPC ${functionName} apos ${attempt} tentativas:`, err.response?.data || err.message);
      throw err;
    }
  }
}

module.exports = {
  getSupabaseConfig,
  getSupabaseUserFromToken,
  supabaseRpc
};
