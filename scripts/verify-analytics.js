const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: 5432,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const overloads = await client.query(`
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'xml_nfse_get_dashboard_analytics'
  `);
  console.log('overloads', overloads.rows);

  // Bypass secret: run body as direct SQL to confirm payload shape
  const t0 = Date.now();
  const body = await client.query(`
    with totals as (
      select
        count(*)::int as documents,
        count(*) filter (where is_cancelled)::int as cancelled,
        coalesce(sum(valor_servico) filter (where not is_cancelled), 0) as value
      from xml_nfse.documents
      where environment = 'producao' and tipo <> 'EVENTO'
    ),
    monthly as (
      select to_char(date_trunc('month', data_emissao), 'YYYY-MM') as month,
             count(*)::int as count
      from xml_nfse.documents
      where environment = 'producao' and tipo <> 'EVENTO'
        and data_emissao >= (date_trunc('month', current_date) - interval '11 months')::date
      group by 1
      order by 1
    )
    select
      (select row_to_json(t) from totals t) as totals,
      (select jsonb_agg(to_jsonb(m)) from monthly m) as monthly
  `);
  console.log('verify ms', Date.now() - t0);
  console.log(JSON.stringify(body.rows[0], null, 2).slice(0, 800));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
