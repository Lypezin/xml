const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema = 'xml_nfse' order by 1"
  );
  console.log(tables.rows.map((r) => r.table_name).join(', '));

  const idx = await client.query(
    "select indexname from pg_indexes where schemaname = 'xml_nfse' and tablename = 'documents' order by 1"
  );
  console.log('indexes:', idx.rows.map((r) => r.indexname).join(', '));
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
