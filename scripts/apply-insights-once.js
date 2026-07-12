/**
 * Aplica supabase_features_ops_insights.sql no Postgres remoto.
 * Uso pontual — não commitar senhas.
 *
 * DATABASE_URL ou SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'supabase_features_ops_insights.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  let clientConfig;
  if (process.env.DATABASE_URL) {
    clientConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 30000
    };
  } else if (process.env.SUPABASE_DB_HOST && process.env.SUPABASE_DB_PASSWORD) {
    clientConfig = {
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT || 5432),
      user: process.env.SUPABASE_DB_USER || 'postgres',
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME || 'postgres',
      ssl: {
        rejectUnauthorized: false,
        servername: process.env.SUPABASE_DB_SSL_SERVERNAME || undefined
      },
      connectionTimeoutMillis: 30000
    };
  } else {
    console.error('Defina DATABASE_URL ou SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD');
    process.exit(1);
  }

  const client = new Client(clientConfig);
  await client.connect();
  console.log('Conectado. Aplicando SQL...');
  await client.query(sql);
  console.log('SQL aplicado com sucesso.');

  const fns = await client.query(`
    select proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and proname in (
        'xml_nfse_get_dashboard_analytics',
        'xml_nfse_list_sync_runs',
        'xml_nfse_update_run',
        'xml_nfse_get_api_health_summary',
        'xml_nfse_register_audit_event'
      )
    order by 1
  `);
  console.log('Funções:', fns.rows.map((r) => r.proname).join(', '));

  const cols = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'xml_nfse' and table_name = 'download_events'
    order by 1
  `);
  console.log('download_events:', cols.rows.map((r) => r.column_name).join(', '));

  await client.end();
}

main().catch((err) => {
  console.error('Falha:', err.message);
  process.exit(1);
});
