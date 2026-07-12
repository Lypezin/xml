const { Client } = require('pg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

function getConfig() {
  return {
    host: process.env.SUPABASE_DB_HOST || 'aws-1-sa-east-1.pooler.supabase.com',
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER || 'postgres.tdmzgjxugwpqproqtzph',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
  };
}

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    console.error('SUPABASE_DB_PASSWORD required');
    process.exit(1);
  }
  const client = new Client(getConfig());
  await client.connect();

  const fns = await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname like '%dashboard%' or p.proname like '%analytics%' or p.proname like '%audit%'
    order by 1
  `);
  console.log('functions:', fns.rows);

  const docs = await client.query(`
    select count(*)::int as total,
           count(*) filter (where tipo <> 'EVENTO')::int as docs,
           min(dh_emi)::text as min_emi,
           max(dh_emi)::text as max_emi
    from xml_nfse.documents
  `);
  console.log('docs:', docs.rows[0]);

  const t0 = Date.now();
  try {
    const a = await client.query(
      `select public.xml_nfse_get_dashboard_analytics(
         (select value from xml_nfse.settings where key = $1 limit 1),
         $2, 12
       ) as r`,
      ['app_secret', 'producao']
    );
    const r = a.rows[0]?.r;
    console.log('analytics ms:', Date.now() - t0);
    console.log('analytics type:', typeof r, Array.isArray(r));
    if (r && typeof r === 'object') {
      console.log('keys:', Object.keys(r));
      console.log('sample:', JSON.stringify(r).slice(0, 1200));
    } else {
      console.log('raw:', r);
    }
  } catch (e) {
    console.error('RPC failed:', e.message);
  }

  // Test REST path if env has keys
  const url = process.env.SUPABASE_URL || 'https://tdmzgjxugwpqproqtzph.supabase.co';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_APP_SECRET;
  if (key && secret) {
    try {
      const res = await axios.post(
        `${url}/rest/v1/rpc/xml_nfse_get_dashboard_analytics`,
        { p_secret: secret, p_environment: 'producao', p_months: 12 },
        {
          headers: { apikey: key, 'Content-Type': 'application/json' },
          timeout: 90000,
          validateStatus: () => true
        }
      );
      console.log('REST status:', res.status);
      console.log('REST body:', JSON.stringify(res.data).slice(0, 800));
    } catch (e) {
      console.error('REST err:', e.message);
    }
  } else {
    console.log('Skip REST: set SUPABASE_PUBLISHABLE_KEY + SUPABASE_APP_SECRET');
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
