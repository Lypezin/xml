/**
 * Aplica fix PGRST203 (overload xml_nfse_upsert_certificate).
 * Requer SUPABASE_DB_* ou DATABASE_URL.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
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
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 30000
    };
  } else {
    console.error('Defina DATABASE_URL ou SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, 'fix-upsert-certificate-overload.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client(clientConfig);
  await client.connect();
  console.log('Conectado. Aplicando fix...');
  await client.query(sql);

  const r = await client.query(`
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'xml_nfse_upsert_certificate'
    order by 1
  `);
  console.log('Assinaturas restantes:', r.rows.map((x) => x.args));
  await client.end();
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
