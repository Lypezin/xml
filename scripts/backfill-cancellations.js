/**
 * Backfill: marca NFSe como Cancelada a partir de EVENTOs e101101 ja gravados.
 * Uso: node scripts/backfill-cancellations.js
 *
 * Preferencialmente usa SQL no Supabase (mais rapido). Este script e fallback via RPC.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_APP_SECRET) {
    return {
      url: process.env.SUPABASE_URL.replace(/\/+$/, ''),
      key: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
      appSecret: process.env.SUPABASE_APP_SECRET
    };
  }
  const cfgPath = path.join(process.cwd(), 'config', 'supabase.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error('Configure SUPABASE_* env ou config/supabase.json');
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  return { url: String(cfg.url).replace(/\/+$/, ''), key: cfg.key, appSecret: cfg.appSecret };
}

async function main() {
  const config = loadConfig();
  const axios = require('axios');

  console.log('[Backfill] Chamando xml_nfse_backfill_cancellations no Supabase...');
  const res = await axios.post(
    `${config.url}/rest/v1/rpc/xml_nfse_backfill_cancellations`,
    { p_secret: config.appSecret, p_batch_limit: 50000 },
    {
      headers: { apikey: config.key, 'Content-Type': 'application/json' },
      timeout: 120000
    }
  );

  console.log('[Backfill] Resultado:', JSON.stringify(res.data, null, 2));
}

main().catch(err => {
  console.error('[Backfill] Erro:', err.response?.data || err.message);
  process.exit(1);
});
