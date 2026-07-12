/**
 * 1) Reload PostgREST schema cache
 * 2) Otimiza analytics para base grande
 * 3) Testa funções com o app_secret (se SUPABASE_APP_SECRET estiver setado)
 */
const { Client } = require('pg');

const ANALYTICS_SQL = `
create or replace function public.xml_nfse_get_dashboard_analytics(
  p_secret text,
  p_environment text default 'producao',
  p_months integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
set statement_timeout = '90000'
as $$
declare
  months integer := least(greatest(coalesce(p_months, 12), 3), 24);
  env text := coalesce(nullif(p_environment, ''), 'producao');
  monthly jsonb := '[]'::jsonb;
  ranking_prestador jsonb := '[]'::jsonb;
  ranking_tomador jsonb := '[]'::jsonb;
  total_value numeric := 0;
  total_docs integer := 0;
  cancelled_docs integer := 0;
  current_month_value numeric := 0;
  prev_month_value numeric := 0;
  current_year_value numeric := 0;
  prev_year_value numeric := 0;
  month_start date := date_trunc('month', current_date)::date;
  year_start date := date_trunc('year', current_date)::date;
  range_start date := (date_trunc('month', current_date) - make_interval(months => months - 1))::date;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  -- Totais via document_stats (rápido)
  select
    coalesce(sum(active_count + cancelled_count), 0)::integer,
    coalesce(sum(cancelled_count), 0)::integer,
    coalesce(sum(active_value), 0)
  into total_docs, cancelled_docs, total_value
  from xml_nfse.document_stats
  where environment = env;

  -- Mensal (só janela recente)
  select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb)
  into monthly
  from (
    select
      to_char(date_trunc('month', d.data_emissao), 'YYYY-MM') as month,
      count(*)::integer as count,
      count(*) filter (where d.is_cancelled)::integer as cancelled,
      coalesce(sum(d.valor_servico) filter (where not d.is_cancelled), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and d.data_emissao is not null
      and d.data_emissao >= range_start
    group by 1
  ) m;

  select coalesce(sum(valor_servico), 0) into current_month_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= month_start
    and data_emissao < (month_start + interval '1 month')::date;

  select coalesce(sum(valor_servico), 0) into prev_month_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= (month_start - interval '1 month')::date
    and data_emissao < month_start;

  select coalesce(sum(valor_servico), 0) into current_year_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= year_start;

  select coalesce(sum(valor_servico), 0) into prev_year_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= (year_start - interval '1 year')::date
    and data_emissao < year_start;

  -- Rankings limitados (top 10)
  select coalesce(jsonb_agg(to_jsonb(r) order by r.value desc), '[]'::jsonb)
  into ranking_prestador
  from (
    select
      coalesce(nullif(max(d.prestador_nome), ''), d.prestador_cnpj, 'Não informado') as name,
      d.prestador_cnpj as cnpj,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
      and d.data_emissao >= range_start
      and d.prestador_cnpj is not null
      and d.prestador_cnpj <> ''
    group by d.prestador_cnpj
    order by value desc nulls last
    limit 10
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.value desc), '[]'::jsonb)
  into ranking_tomador
  from (
    select
      coalesce(nullif(max(d.tomador_nome), ''), d.tomador_cnpj, 'Não informado') as name,
      d.tomador_cnpj as cnpj,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
      and d.data_emissao >= range_start
      and d.tomador_cnpj is not null
      and d.tomador_cnpj <> ''
    group by d.tomador_cnpj
    order by value desc nulls last
    limit 10
  ) r;

  return jsonb_build_object(
    'environment', env,
    'totals', jsonb_build_object(
      'documents', total_docs,
      'cancelled', cancelled_docs,
      'value', total_value
    ),
    'monthly', coalesce(monthly, '[]'::jsonb),
    'rankingPrestador', coalesce(ranking_prestador, '[]'::jsonb),
    'rankingTomador', coalesce(ranking_tomador, '[]'::jsonb),
    'comparisons', jsonb_build_object(
      'monthOverMonth', jsonb_build_object(
        'current', current_month_value,
        'previous', prev_month_value,
        'deltaPct', case when prev_month_value = 0 then null
          else round(((current_month_value - prev_month_value) / prev_month_value) * 100, 1) end
      ),
      'yearOverYear', jsonb_build_object(
        'current', current_year_value,
        'previous', prev_year_value,
        'deltaPct', case when prev_year_value = 0 then null
          else round(((current_year_value - prev_year_value) / prev_year_value) * 100, 1) end
      )
    )
  );
end;
$$;

grant execute on function public.xml_nfse_get_dashboard_analytics(text, text, integer) to anon, authenticated;
grant execute on function public.xml_nfse_list_audit_events(text, integer, text) to anon, authenticated;
grant execute on function public.xml_nfse_list_sync_runs(text, text, text, integer) to anon, authenticated;
grant execute on function public.xml_nfse_get_api_health_summary(text, integer) to anon, authenticated;
grant execute on function public.xml_nfse_register_audit_event(text, text, text, bigint, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.xml_nfse_update_run(text, uuid, bigint, bigint, integer, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_record_api_health(text, text, text, text, integer, integer, boolean, text) to anon, authenticated;
`;

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000
  });
  await client.connect();
  console.log('connected');

  await client.query(ANALYTICS_SQL);
  console.log('analytics + grants applied');

  // Força PostgREST a recarregar o schema (funções novas)
  await client.query("notify pgrst, 'reload schema'");
  console.log('pgrst schema reload notified');

  // Smoke test com hash: precisa do secret em claro
  if (process.env.SUPABASE_APP_SECRET) {
    const started = Date.now();
    const r = await client.query(
      'select public.xml_nfse_get_dashboard_analytics($1, $2, 12) as data',
      [process.env.SUPABASE_APP_SECRET, 'producao']
    );
    console.log('analytics ok in', Date.now() - started, 'ms');
    console.log('totals', r.rows[0]?.data?.totals);
    console.log('monthly', (r.rows[0]?.data?.monthly || []).length);
  } else {
    console.log('SUPABASE_APP_SECRET not set — skip secret smoke test');
  }

  const auditCount = await client.query('select count(*)::int as n from xml_nfse.download_events');
  console.log('download_events', auditCount.rows[0]);

  await client.end();
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
