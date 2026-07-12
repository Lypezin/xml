-- ============================================================
-- Features: histórico de varreduras, saúde API, auditoria,
-- validade de certificado, analytics do dashboard
-- Rode no SQL Editor do Supabase (idempotente).
-- ============================================================

-- Certificados: validade do A1
alter table xml_nfse.certificates
  add column if not exists valid_until timestamptz;

-- Auditoria de downloads/exports
alter table xml_nfse.download_events
  add column if not exists action text not null default 'xml';
alter table xml_nfse.download_events
  add column if not exists user_email text;
alter table xml_nfse.download_events
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists download_events_downloaded_at_idx
  on xml_nfse.download_events (downloaded_at desc);

create index if not exists download_events_action_idx
  on xml_nfse.download_events (action, downloaded_at desc);

-- Amostras de saúde da API nacional
create table if not exists xml_nfse.api_health_samples (
  id uuid primary key default gen_random_uuid(),
  certificate_id text references xml_nfse.certificates(id) on delete set null,
  environment text,
  endpoint text,
  http_status integer,
  latency_ms integer,
  success boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists api_health_samples_created_idx
  on xml_nfse.api_health_samples (created_at desc);

alter table xml_nfse.api_health_samples enable row level security;

-- Upsert certificado com valid_until (única assinatura — evita PGRST203)
drop function if exists public.xml_nfse_upsert_certificate(text, text, text, text, boolean);

create or replace function public.xml_nfse_upsert_certificate(
  p_secret text,
  p_certificate_id text,
  p_filename text,
  p_cnpj text,
  p_active boolean default true,
  p_valid_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if p_active then
    update xml_nfse.certificates set active = false where active = true;
  end if;

  insert into xml_nfse.certificates (id, filename, cnpj, active, valid_until)
  values (
    p_certificate_id,
    p_filename,
    nullif(p_cnpj, ''),
    coalesce(p_active, false),
    p_valid_until
  )
  on conflict (id) do update
  set filename = excluded.filename,
      cnpj = excluded.cnpj,
      active = excluded.active,
      valid_until = coalesce(excluded.valid_until, xml_nfse.certificates.valid_until),
      updated_at = now();

  return jsonb_build_object('success', true, 'certificate_id', p_certificate_id);
end;
$$;

grant execute on function public.xml_nfse_upsert_certificate(text, text, text, text, boolean, timestamptz) to anon, authenticated;

-- Registrar download/export com usuário e ação
create or replace function public.xml_nfse_register_audit_event(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_nsu bigint,
  p_file_name text,
  p_action text default 'xml',
  p_user_email text default null,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  doc_id uuid;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if p_nsu is not null and p_certificate_id is not null then
    select id into doc_id
    from xml_nfse.documents
    where certificate_id = p_certificate_id
      and environment = coalesce(p_environment, 'producao')
      and nsu = p_nsu
    limit 1;
  end if;

  insert into xml_nfse.download_events (
    certificate_id, document_id, environment, nsu, file_name, action, user_email, details
  ) values (
    p_certificate_id,
    doc_id,
    p_environment,
    p_nsu,
    p_file_name,
    coalesce(nullif(trim(p_action), ''), 'xml'),
    nullif(trim(p_user_email), ''),
    coalesce(p_details, '{}'::jsonb)
  );

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.xml_nfse_register_audit_event(text, text, text, bigint, text, text, text, jsonb) to anon, authenticated;

-- Compat: register_download antigo
create or replace function public.xml_nfse_register_download(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_nsu bigint,
  p_file_name text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  return public.xml_nfse_register_audit_event(
    p_secret, p_certificate_id, p_environment, p_nsu, p_file_name, 'xml', null, '{}'::jsonb
  );
end;
$$;

-- Listar runs de varredura
create or replace function public.xml_nfse_list_sync_runs(
  p_secret text,
  p_certificate_id text default null,
  p_environment text default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  rows_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc), '[]'::jsonb)
  into rows_data
  from (
    select
      id,
      certificate_id,
      environment,
      cnpj_consulta,
      status,
      start_nsu,
      end_nsu,
      max_nsu_seen,
      documents_found,
      error_message,
      started_at,
      finished_at,
      case
        when finished_at is not null then
          extract(epoch from (finished_at - started_at))::integer
        else
          extract(epoch from (now() - started_at))::integer
      end as duration_seconds
    from xml_nfse.sync_runs
    where (p_certificate_id is null or certificate_id = p_certificate_id)
      and (p_environment is null or environment = p_environment)
    order by started_at desc
    limit lim
  ) r;

  return rows_data;
end;
$$;

grant execute on function public.xml_nfse_list_sync_runs(text, text, text, integer) to anon, authenticated;

-- Listar auditoria
create or replace function public.xml_nfse_list_audit_events(
  p_secret text,
  p_limit integer default 50,
  p_certificate_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  rows_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select coalesce(jsonb_agg(to_jsonb(e) order by e.downloaded_at desc), '[]'::jsonb)
  into rows_data
  from (
    select
      id,
      certificate_id,
      document_id,
      environment,
      nsu,
      file_name,
      coalesce(action, 'xml') as action,
      user_email,
      details,
      downloaded_at
    from xml_nfse.download_events
    where (p_certificate_id is null or certificate_id = p_certificate_id)
    order by downloaded_at desc
    limit lim
  ) e;

  return rows_data;
end;
$$;

grant execute on function public.xml_nfse_list_audit_events(text, integer, text) to anon, authenticated;

-- Registrar amostra de saúde da API
create or replace function public.xml_nfse_record_api_health(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_endpoint text,
  p_http_status integer,
  p_latency_ms integer,
  p_success boolean,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  perform xml_nfse.assert_app_secret(p_secret);

  insert into xml_nfse.api_health_samples (
    certificate_id, environment, endpoint, http_status, latency_ms, success, error_message
  ) values (
    p_certificate_id, p_environment, p_endpoint, p_http_status, p_latency_ms, coalesce(p_success, false), p_error_message
  );

  -- mantém ~2000 amostras
  delete from xml_nfse.api_health_samples
  where id in (
    select id from xml_nfse.api_health_samples
    order by created_at desc
    offset 2000
  );

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.xml_nfse_record_api_health(text, text, text, text, integer, integer, boolean, text) to anon, authenticated;

-- Resumo saúde API (24h)
create or replace function public.xml_nfse_get_api_health_summary(
  p_secret text,
  p_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  hours integer := least(greatest(coalesce(p_hours, 24), 1), 168);
  since_ts timestamptz := now() - make_interval(hours => hours);
  total_count integer := 0;
  ok_count integer := 0;
  avg_latency numeric := 0;
  p95_latency numeric := 0;
  last_error text;
  last_at timestamptz;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select
    count(*),
    count(*) filter (where success),
    coalesce(avg(latency_ms) filter (where latency_ms is not null), 0),
    coalesce(percentile_cont(0.95) within group (order by latency_ms) filter (where latency_ms is not null), 0)
  into total_count, ok_count, avg_latency, p95_latency
  from xml_nfse.api_health_samples
  where created_at >= since_ts;

  select error_message, created_at
  into last_error, last_at
  from xml_nfse.api_health_samples
  where success = false
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'windowHours', hours,
    'total', total_count,
    'success', ok_count,
    'errors', greatest(total_count - ok_count, 0),
    'successRate', case when total_count = 0 then null else round((ok_count::numeric / total_count) * 100, 1) end,
    'avgLatencyMs', round(avg_latency, 0),
    'p95LatencyMs', round(p95_latency, 0),
    'lastError', last_error,
    'lastErrorAt', last_at,
    'status', case
      when total_count = 0 then 'unknown'
      when (ok_count::numeric / total_count) >= 0.95 then 'healthy'
      when (ok_count::numeric / total_count) >= 0.8 then 'degraded'
      else 'down'
    end
  );
end;
$$;

grant execute on function public.xml_nfse_get_api_health_summary(text, integer) to anon, authenticated;

-- Analytics dashboard (volume mensal, ranking, MoM/YoY)
create or replace function public.xml_nfse_get_dashboard_analytics(
  p_secret text,
  p_environment text default 'producao',
  p_months integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
set statement_timeout = '20000'
as $$
declare
  months integer := least(greatest(coalesce(p_months, 12), 3), 24);
  env text := coalesce(nullif(p_environment, ''), 'producao');
  monthly jsonb;
  ranking_prestador jsonb;
  ranking_tomador jsonb;
  total_value numeric := 0;
  total_docs integer := 0;
  cancelled_docs integer := 0;
  current_month_value numeric := 0;
  prev_month_value numeric := 0;
  current_year_value numeric := 0;
  prev_year_value numeric := 0;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb)
  into monthly
  from (
    select
      to_char(date_trunc('month', d.data_emissao), 'YYYY-MM') as month,
      count(*)::integer as count,
      count(*) filter (where d.is_cancelled)::integer as cancelled,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and d.data_emissao is not null
      and d.data_emissao >= (date_trunc('month', current_date) - make_interval(months => months - 1))::date
    group by 1
  ) m;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.value desc), '[]'::jsonb)
  into ranking_prestador
  from (
    select
      coalesce(nullif(d.prestador_nome, ''), d.prestador_cnpj, 'Não informado') as name,
      d.prestador_cnpj as cnpj,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
    group by d.prestador_cnpj, d.prestador_nome
    order by value desc
    limit 10
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.value desc), '[]'::jsonb)
  into ranking_tomador
  from (
    select
      coalesce(nullif(d.tomador_nome, ''), d.tomador_cnpj, 'Não informado') as name,
      d.tomador_cnpj as cnpj,
      count(*)::integer as count,
      coalesce(sum(d.valor_servico), 0)::numeric as value
    from xml_nfse.documents d
    where d.environment = env
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
    group by d.tomador_cnpj, d.tomador_nome
    order by value desc
    limit 10
  ) r;

  select
    count(*)::integer,
    count(*) filter (where is_cancelled)::integer,
    coalesce(sum(valor_servico), 0)
  into total_docs, cancelled_docs, total_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO';

  select coalesce(sum(valor_servico), 0) into current_month_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= date_trunc('month', current_date)::date
    and data_emissao < (date_trunc('month', current_date) + interval '1 month')::date;

  select coalesce(sum(valor_servico), 0) into prev_month_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= (date_trunc('month', current_date) - interval '1 month')::date
    and data_emissao < date_trunc('month', current_date)::date;

  select coalesce(sum(valor_servico), 0) into current_year_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= date_trunc('year', current_date)::date;

  select coalesce(sum(valor_servico), 0) into prev_year_value
  from xml_nfse.documents
  where environment = env and tipo <> 'EVENTO' and not is_cancelled
    and data_emissao >= (date_trunc('year', current_date) - interval '1 year')::date
    and data_emissao < date_trunc('year', current_date)::date;

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

-- Atualiza run aberta (sessão de varredura) sem fechar
create or replace function public.xml_nfse_update_run(
  p_secret text,
  p_run_id uuid,
  p_end_nsu bigint default null,
  p_max_nsu_seen bigint default null,
  p_documents_delta integer default 0,
  p_status text default 'running',
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  perform xml_nfse.assert_app_secret(p_secret);

  update xml_nfse.sync_runs
  set end_nsu = coalesce(p_end_nsu, end_nsu),
      max_nsu_seen = greatest(coalesce(max_nsu_seen, 0), coalesce(p_max_nsu_seen, 0)),
      documents_found = documents_found + coalesce(p_documents_delta, 0),
      status = coalesce(p_status, status),
      error_message = p_error_message
  where id = p_run_id
    and finished_at is null;

  return jsonb_build_object('success', found);
end;
$$;

grant execute on function public.xml_nfse_update_run(text, uuid, bigint, bigint, integer, text, text) to anon, authenticated;
