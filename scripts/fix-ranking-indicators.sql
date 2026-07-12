-- Ajustes de indicadores:
-- 1) Top tomadores = nome do certificado (unidade), não razão social da NFSe
-- 2) Top prestadores ignora valores absurdo por nota (outliers / parse errado)

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
  -- Teto por nota para ranking de prestadores (MEI/entregadores).
  -- Notas com valor acima disso costumam ser erro de parse (ex.: CNPJ no campo vServ).
  max_invoice numeric := 100000;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select
    count(*)::integer,
    count(*) filter (where is_cancelled)::integer,
    coalesce(sum(valor_servico) filter (
      where not is_cancelled
        and valor_servico is not null
        and valor_servico > 0
        and valor_servico <= max_invoice
    ), 0)
  into total_docs, cancelled_docs, total_value
  from xml_nfse.documents
  where environment = env
    and tipo <> 'EVENTO';

  select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb)
  into monthly
  from (
    select
      to_char(date_trunc('month', d.data_emissao), 'YYYY-MM') as month,
      count(*)::integer as count,
      count(*) filter (where d.is_cancelled)::integer as cancelled,
      coalesce(sum(d.valor_servico) filter (
        where not d.is_cancelled
          and d.valor_servico is not null
          and d.valor_servico > 0
          and d.valor_servico <= max_invoice
      ), 0)::numeric as value
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
    and valor_servico is not null and valor_servico > 0 and valor_servico <= max_invoice
    and data_emissao >= month_start
    and data_emissao < (month_start + interval '1 month')::date;

  select coalesce(sum(valor_servico), 0) into prev_month_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and valor_servico is not null and valor_servico > 0 and valor_servico <= max_invoice
    and data_emissao >= (month_start - interval '1 month')::date
    and data_emissao < month_start;

  select coalesce(sum(valor_servico), 0) into current_year_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and valor_servico is not null and valor_servico > 0 and valor_servico <= max_invoice
    and data_emissao >= year_start;

  select coalesce(sum(valor_servico), 0) into prev_year_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and valor_servico is not null and valor_servico > 0 and valor_servico <= max_invoice
    and data_emissao >= (year_start - interval '1 year')::date
    and data_emissao < year_start;

  -- Prestadores: agrupa por CNPJ; soma só notas com valor plausível
  select coalesce(jsonb_agg(to_jsonb(r) order by r.value desc), '[]'::jsonb)
  into ranking_prestador
  from (
    select
      coalesce(
        nullif(max(d.prestador_nome), ''),
        d.prestador_cnpj,
        'Não informado'
      ) as name,
      d.prestador_cnpj as cnpj,
      count(*) filter (
        where d.valor_servico is not null
          and d.valor_servico > 0
          and d.valor_servico <= max_invoice
      )::integer as count,
      coalesce(sum(d.valor_servico) filter (
        where d.valor_servico is not null
          and d.valor_servico > 0
          and d.valor_servico <= max_invoice
      ), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
      and d.prestador_cnpj is not null
      and d.prestador_cnpj <> ''
    group by d.prestador_cnpj
    having coalesce(sum(d.valor_servico) filter (
      where d.valor_servico is not null
        and d.valor_servico > 0
        and d.valor_servico <= max_invoice
    ), 0) > 0
    order by value desc nulls last
    limit 10
  ) r;

  -- Tomadores/unidades: nome do certificado (São Paulo, Guarulhos, …)
  select coalesce(jsonb_agg(to_jsonb(r) order by r.value desc), '[]'::jsonb)
  into ranking_tomador
  from (
    select
      coalesce(
        nullif(trim(c.filename), ''),
        nullif(max(d.tomador_nome), ''),
        coalesce(c.cnpj, max(d.tomador_cnpj)),
        'Não informado'
      ) as name,
      coalesce(c.cnpj, max(d.tomador_cnpj)) as cnpj,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico) filter (
        where d.valor_servico is not null
          and d.valor_servico > 0
          and d.valor_servico <= max_invoice
      ), 0)::numeric as value
    from xml_nfse.documents d
    left join xml_nfse.certificates c on c.id = d.certificate_id
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
    group by c.id, c.filename, c.cnpj
    having count(*) > 0
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

grant execute on function public.xml_nfse_get_dashboard_analytics(text, text, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
