const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    statement_timeout: 120000
  });
  await client.connect();

  const cols = await client.query(`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'xml_nfse' and table_name = 'documents'
    order by ordinal_position
  `);
  console.log('columns:', cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(', '));

  const counts = await client.query(`
    select
      count(*)::int as total,
      count(*) filter (where tipo <> 'EVENTO')::int as docs,
      count(*) filter (where environment = 'producao' and tipo <> 'EVENTO')::int as prod_docs,
      count(*) filter (where data_emissao is not null and tipo <> 'EVENTO')::int as with_emissao,
      count(*) filter (where valor_servico is not null and valor_servico > 0)::int as with_valor,
      min(data_emissao)::text as min_emi,
      max(data_emissao)::text as max_emi
    from xml_nfse.documents
  `);
  console.log('counts:', counts.rows[0]);

  const envs = await client.query(`
    select environment, count(*)::int as n
    from xml_nfse.documents
    where tipo <> 'EVENTO'
    group by 1
    order by 2 desc
  `);
  console.log('by env:', envs.rows);

  console.log('calling analytics...');
  const t0 = Date.now();
  try {
    const a = await client.query(
      `select public.xml_nfse_get_dashboard_analytics(
         (select value from xml_nfse.settings where key = $1 limit 1),
         $2, 12
       ) as r`,
      ['app_secret', 'producao']
    );
    console.log('ok ms:', Date.now() - t0);
    const r = a.rows[0].r;
    console.log(JSON.stringify(r, null, 2).slice(0, 2000));
  } catch (e) {
    console.error('analytics fail ms:', Date.now() - t0, e.message);
  }

  // index presence
  const idx = await client.query(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'xml_nfse' and tablename = 'documents'
  `);
  console.log('indexes:', idx.rows.map((i) => i.indexname));

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
