const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: 5432,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000
  });
  await client.connect();
  await client.query("set statement_timeout = '120s'");

  // Run analytics body without secret check
  const env = 'producao';
  const months = 12;
  const t0 = Date.now();

  const totals = await client.query(`
    select
      count(*)::integer as documents,
      count(*) filter (where is_cancelled)::integer as cancelled,
      coalesce(sum(valor_servico) filter (where not is_cancelled), 0) as value
    from xml_nfse.documents
    where environment = $1 and tipo <> 'EVENTO'
  `, [env]);
  console.log('totals ms', Date.now() - t0, totals.rows[0]);

  const t1 = Date.now();
  const monthly = await client.query(`
    select
      to_char(date_trunc('month', d.data_emissao), 'YYYY-MM') as month,
      count(*)::integer as count,
      count(*) filter (where d.is_cancelled)::integer as cancelled,
      coalesce(sum(d.valor_servico) filter (where not d.is_cancelled), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = $1
      and d.tipo <> 'EVENTO'
      and d.data_emissao is not null
      and d.data_emissao >= (date_trunc('month', current_date) - make_interval(months => $2::int - 1))::date
    group by 1
    order by 1
  `, [env, months]);
  console.log('monthly ms', Date.now() - t1, 'rows', monthly.rows.length, monthly.rows.slice(-3));

  const t2 = Date.now();
  const rankP = await client.query(`
    select
      coalesce(nullif(d.prestador_nome, ''), d.prestador_cnpj, 'Não informado') as name,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = $1
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
    group by d.prestador_cnpj, d.prestador_nome
    order by value desc nulls last
    limit 10
  `, [env]);
  console.log('rank prestador ms', Date.now() - t2, rankP.rows.slice(0, 3));

  const t3 = Date.now();
  const rankT = await client.query(`
    select
      coalesce(nullif(d.tomador_nome, ''), d.tomador_cnpj, 'Não informado') as name,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = $1
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
    group by d.tomador_cnpj, d.tomador_nome
    order by value desc nulls last
    limit 10
  `, [env]);
  console.log('rank tomador ms', Date.now() - t3, rankT.rows.slice(0, 3));

  // Function body with hash from settings: pass the raw secret by temporarily disabling assert
  // Instead: update session role and call with known working pattern from app
  // Read function source for any bugs
  const def = await client.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'xml_nfse_get_dashboard_analytics'
  `);
  console.log('fn head:', def.rows[0].def.slice(0, 800));

  // Check if grant exists and PostgREST can see it
  const grants = await client.query(`
    select grantee, privilege_type
    from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'xml_nfse_get_dashboard_analytics'
  `);
  console.log('grants:', grants.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
