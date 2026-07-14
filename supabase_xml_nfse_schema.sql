create schema if not exists xml_nfse;
create extension if not exists pgcrypto with schema extensions;

create table if not exists xml_nfse.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into xml_nfse.settings (key, value)
values ('app_secret_sha256', 'REPLACE_WITH_SHA256_OF_SUPABASE_APP_SECRET')
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create table if not exists xml_nfse.certificates (
  id text primary key,
  filename text not null,
  cnpj text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists xml_nfse.units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text not null,
  city text,
  state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cnpj)
);

create table if not exists xml_nfse.certificate_secrets (
  certificate_id text primary key references xml_nfse.certificates(id) on delete cascade,
  pfx_ciphertext text not null,
  pfx_iv text not null,
  pfx_auth_tag text not null,
  passphrase_ciphertext text not null,
  passphrase_iv text not null,
  passphrase_auth_tag text not null,
  updated_at timestamptz not null default now()
);

create table if not exists xml_nfse.sync_state (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null references xml_nfse.certificates(id) on delete cascade,
  environment text not null check (environment in ('producao', 'homologacao')),
  cnpj_consulta text not null default '',
  last_nsu bigint not null default 0,
  max_nsu_seen bigint not null default 0,
  status text not null default 'idle',
  last_success_at timestamptz,
  last_error text,
  next_allowed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (certificate_id, environment, cnpj_consulta)
);

create table if not exists xml_nfse.sync_runs (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null references xml_nfse.certificates(id) on delete cascade,
  environment text not null check (environment in ('producao', 'homologacao')),
  cnpj_consulta text not null default '',
  status text not null default 'running',
  start_nsu bigint not null default 0,
  end_nsu bigint,
  max_nsu_seen bigint,
  documents_found integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists xml_nfse.documents (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null references xml_nfse.certificates(id) on delete cascade,
  environment text not null check (environment in ('producao', 'homologacao')),
  nsu bigint not null,
  tipo text not null default 'NFSE',
  chave text,
  numero_nfse text,
  data_emissao date,
  prestador_cnpj text,
  prestador_nome text,
  tomador_cnpj text,
  tomador_nome text,
  valor_servico numeric(20,2),
  municipio_prestacao text,
  codigo_tributacao text,
  file_name text,
  xml_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  is_cancelled boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (certificate_id, environment, nsu)
);

alter table xml_nfse.documents
  alter column valor_servico type numeric(20,2);

alter table xml_nfse.documents
  add column if not exists is_cancelled boolean not null default false;

create table if not exists xml_nfse.download_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id text references xml_nfse.certificates(id) on delete set null,
  document_id uuid references xml_nfse.documents(id) on delete set null,
  environment text,
  nsu bigint,
  file_name text,
  downloaded_at timestamptz not null default now()
);

create table if not exists xml_nfse.xml_payloads (
  token text primary key,
  certificate_id text references xml_nfse.certificates(id) on delete cascade,
  environment text check (environment in ('producao', 'homologacao')),
  nsu bigint,
  file_name text not null,
  xml_content text not null,
  content_bytes integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table xml_nfse.xml_payloads
  add column if not exists content_bytes integer;

create index if not exists sync_state_lookup_idx
  on xml_nfse.sync_state (certificate_id, environment, cnpj_consulta);

create index if not exists documents_certificate_environment_nsu_desc_idx
  on xml_nfse.documents (certificate_id, environment, nsu desc);

create index if not exists documents_count_speed_idx
  on xml_nfse.documents (certificate_id, environment)
  where tipo <> 'EVENTO';

create index if not exists documents_tomador_lookup_idx
  on xml_nfse.documents (certificate_id, environment, tomador_cnpj, nsu desc);

create index if not exists documents_prestador_lookup_idx
  on xml_nfse.documents (certificate_id, environment, prestador_cnpj, nsu desc);

create index if not exists documents_emissao_lookup_idx
  on xml_nfse.documents (certificate_id, environment, data_emissao desc);

create index if not exists documents_chave_idx
  on xml_nfse.documents (chave);

create index if not exists documents_chave_nfse_lookup_idx
  on xml_nfse.documents (certificate_id, environment, chave, nsu desc)
  where tipo <> 'EVENTO' and chave is not null and chave <> '';

create index if not exists documents_chave_evento_lookup_idx
  on xml_nfse.documents (certificate_id, environment, chave, nsu desc)
  where tipo = 'EVENTO' and chave is not null and chave <> '';

-- Listagem por data_emissao (padrao da UI) — partial indexes com is_cancelled
create index if not exists documents_list_active_emissao_idx
  on xml_nfse.documents (certificate_id, environment, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO' and is_cancelled = false;

create index if not exists documents_list_all_emissao_idx
  on xml_nfse.documents (certificate_id, environment, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO';

create index if not exists documents_tomador_active_emissao_idx
  on xml_nfse.documents (certificate_id, environment, tomador_cnpj, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO' and is_cancelled = false;

create index if not exists documents_tomador_all_emissao_idx
  on xml_nfse.documents (certificate_id, environment, tomador_cnpj, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO';

create index if not exists documents_prestador_active_emissao_idx
  on xml_nfse.documents (certificate_id, environment, prestador_cnpj, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO' and is_cancelled = false;

create index if not exists documents_prestador_all_emissao_idx
  on xml_nfse.documents (certificate_id, environment, prestador_cnpj, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO';

create index if not exists documents_active_count_idx
  on xml_nfse.documents (certificate_id, environment)
  where tipo <> 'EVENTO' and is_cancelled = false;

-- Covering indexes para count+sum (totais da lista) sem heap fetch
create index if not exists documents_active_valor_cover_idx
  on xml_nfse.documents (certificate_id, environment)
  include (valor_servico)
  where tipo <> 'EVENTO' and is_cancelled = false;

create index if not exists documents_all_nfse_valor_cover_idx
  on xml_nfse.documents (certificate_id, environment)
  include (valor_servico)
  where tipo <> 'EVENTO';

create index if not exists documents_list_cancelled_emissao_idx
  on xml_nfse.documents (certificate_id, environment, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO' and is_cancelled = true;

-- Ultima NFS-e por certificado (dashboard / qualquer status)
create index if not exists documents_dash_latest_emissao_idx
  on xml_nfse.documents (certificate_id, environment, data_emissao desc nulls last, nsu desc)
  where tipo <> 'EVENTO';

create index if not exists documents_tomador_active_valor_cover_idx
  on xml_nfse.documents (certificate_id, environment, tomador_cnpj)
  include (valor_servico)
  where tipo <> 'EVENTO' and is_cancelled = false;

create index if not exists documents_nfse_chave_active_idx
  on xml_nfse.documents (certificate_id, environment, chave)
  where tipo <> 'EVENTO' and chave is not null and chave <> '';

-- Cache de totais por certificado/ambiente (lista sem filtros fica O(1))
create table if not exists xml_nfse.document_stats (
  certificate_id text not null,
  environment text not null check (environment in ('producao', 'homologacao')),
  active_count integer not null default 0,
  cancelled_count integer not null default 0,
  active_value numeric(20,2) not null default 0,
  cancelled_value numeric(20,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (certificate_id, environment)
);

create or replace function xml_nfse.refresh_document_stats(
  p_certificate_id text default null,
  p_environment text default null
)
returns integer
language plpgsql
security definer
set search_path = xml_nfse, public
as $$
declare
  n integer := 0;
begin
  insert into xml_nfse.document_stats as s (
    certificate_id, environment, active_count, cancelled_count, active_value, cancelled_value, updated_at
  )
  select
    d.certificate_id,
    d.environment,
    count(*) filter (where not d.is_cancelled)::integer,
    count(*) filter (where d.is_cancelled)::integer,
    coalesce(sum(case when not d.is_cancelled and d.valor_servico >= 0 and d.valor_servico < 1e9 then d.valor_servico else 0 end), 0),
    coalesce(sum(case when d.is_cancelled and d.valor_servico >= 0 and d.valor_servico < 1e9 then d.valor_servico else 0 end), 0),
    now()
  from xml_nfse.documents d
  where d.tipo <> 'EVENTO'
    and (p_certificate_id is null or d.certificate_id = p_certificate_id)
    and (p_environment is null or d.environment = p_environment)
  group by d.certificate_id, d.environment
  on conflict (certificate_id, environment) do update set
    active_count = excluded.active_count,
    cancelled_count = excluded.cancelled_count,
    active_value = excluded.active_value,
    cancelled_value = excluded.cancelled_value,
    updated_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

create index if not exists xml_payloads_expires_at_idx
  on xml_nfse.xml_payloads (expires_at);

create index if not exists xml_payloads_certificate_environment_nsu_idx
  on xml_nfse.xml_payloads (certificate_id, environment, nsu);

create index if not exists xml_payloads_cert_env_bytes_idx
  on xml_nfse.xml_payloads (certificate_id, environment)
  include (content_bytes);

create index if not exists sync_runs_certificate_environment_started_idx
  on xml_nfse.sync_runs (certificate_id, environment, started_at desc);

create index if not exists download_events_certificate_id_idx
  on xml_nfse.download_events (certificate_id);

create index if not exists download_events_document_id_idx
  on xml_nfse.download_events (document_id);

create index if not exists units_cnpj_idx
  on xml_nfse.units (cnpj);

alter table xml_nfse.xml_payloads
  alter column expires_at drop not null,
  alter column expires_at drop default;

alter table xml_nfse.settings enable row level security;
alter table xml_nfse.certificates enable row level security;
alter table xml_nfse.units enable row level security;
alter table xml_nfse.certificate_secrets enable row level security;
alter table xml_nfse.sync_state enable row level security;
alter table xml_nfse.sync_runs enable row level security;
alter table xml_nfse.documents enable row level security;
alter table xml_nfse.download_events enable row level security;
alter table xml_nfse.xml_payloads enable row level security;

revoke all on schema xml_nfse from anon, authenticated;
revoke all on all tables in schema xml_nfse from anon, authenticated;
revoke all on all sequences in schema xml_nfse from anon, authenticated;

create or replace function xml_nfse.assert_app_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  expected_hash text;
  provided_hash text;
begin
  select value into expected_hash
  from xml_nfse.settings
  where key = 'app_secret_sha256';

  provided_hash := encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');

  if expected_hash is null or provided_hash <> expected_hash then
    raise exception 'invalid xml_nfse app secret' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.xml_nfse_list_units(
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  rows_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select coalesce(jsonb_agg(to_jsonb(u.*) order by u.name asc), '[]'::jsonb)
  into rows_data
  from xml_nfse.units u
  where u.active = true;

  return rows_data;
end;
$$;

create or replace function public.xml_nfse_upsert_unit(
  p_secret text,
  p_unit_id uuid default null,
  p_name text default '',
  p_cnpj text default '',
  p_city text default null,
  p_state text default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  clean_cnpj text;
  saved_unit xml_nfse.units%rowtype;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  clean_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if length(clean_cnpj) <> 14 then
    raise exception 'CNPJ da unidade deve ter 14 digitos' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'Nome da unidade e obrigatorio' using errcode = '22023';
  end if;

  insert into xml_nfse.units (id, name, cnpj, city, state, active)
  values (
    coalesce(p_unit_id, gen_random_uuid()),
    trim(p_name),
    clean_cnpj,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(upper(trim(coalesce(p_state, ''))), ''),
    true
  )
  on conflict (cnpj) do update
  set name = excluded.name,
      city = excluded.city,
      state = excluded.state,
      active = true,
      updated_at = now()
  returning * into saved_unit;

  return to_jsonb(saved_unit);
end;
$$;

create or replace function public.xml_nfse_delete_unit(
  p_secret text,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  saved_unit xml_nfse.units%rowtype;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  update xml_nfse.units
  set active = false,
      updated_at = now()
  where id = p_unit_id
  returning * into saved_unit;

  return to_jsonb(saved_unit);
end;
$$;

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

create or replace function public.xml_nfse_get_setting(
  p_secret text,
  p_key text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  setting_value text;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select value into setting_value
  from xml_nfse.settings
  where key = p_key;

  if setting_value is null then
    return null;
  end if;

  return setting_value::jsonb;
end;
$$;

create or replace function public.xml_nfse_set_setting(
  p_secret text,
  p_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  perform xml_nfse.assert_app_secret(p_secret);

  insert into xml_nfse.settings (key, value)
  values (p_key, p_value::text)
  on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

  return jsonb_build_object('success', true, 'key', p_key, 'value', p_value);
end;
$$;

create or replace function public.xml_nfse_upsert_certificate_secret(
  p_secret text,
  p_certificate_id text,
  p_filename text,
  p_cnpj text,
  p_active boolean,
  p_pfx_ciphertext text,
  p_pfx_iv text,
  p_pfx_auth_tag text,
  p_passphrase_ciphertext text,
  p_passphrase_iv text,
  p_passphrase_auth_tag text
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

  insert into xml_nfse.certificates (id, filename, cnpj, active)
  values (p_certificate_id, p_filename, nullif(p_cnpj, ''), coalesce(p_active, false))
  on conflict (id) do update
  set filename = excluded.filename,
      cnpj = excluded.cnpj,
      active = excluded.active,
      updated_at = now();

  insert into xml_nfse.certificate_secrets (
    certificate_id,
    pfx_ciphertext,
    pfx_iv,
    pfx_auth_tag,
    passphrase_ciphertext,
    passphrase_iv,
    passphrase_auth_tag,
    updated_at
  )
  values (
    p_certificate_id,
    p_pfx_ciphertext,
    p_pfx_iv,
    p_pfx_auth_tag,
    p_passphrase_ciphertext,
    p_passphrase_iv,
    p_passphrase_auth_tag,
    now()
  )
  on conflict (certificate_id) do update
  set pfx_ciphertext = excluded.pfx_ciphertext,
      pfx_iv = excluded.pfx_iv,
      pfx_auth_tag = excluded.pfx_auth_tag,
      passphrase_ciphertext = excluded.passphrase_ciphertext,
      passphrase_iv = excluded.passphrase_iv,
      passphrase_auth_tag = excluded.passphrase_auth_tag,
      updated_at = now();

  return jsonb_build_object('success', true, 'certificate_id', p_certificate_id);
end;
$$;

create or replace function public.xml_nfse_list_certificates(
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  rows_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select coalesce(jsonb_agg(to_jsonb(c.*) order by c.active desc, c.created_at desc), '[]'::jsonb)
  into rows_data
  from xml_nfse.certificates c
  where exists (
    select 1
    from xml_nfse.certificate_secrets s
    where s.certificate_id = c.id
  );

  return rows_data;
end;
$$;

create or replace function public.xml_nfse_set_active_certificate(
  p_secret text,
  p_certificate_id text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if not exists (
    select 1
    from xml_nfse.certificates c
    join xml_nfse.certificate_secrets s on s.certificate_id = c.id
    where c.id = p_certificate_id
  ) then
    return jsonb_build_object('success', false);
  end if;

  update xml_nfse.certificates set active = false where active = true;
  update xml_nfse.certificates
  set active = true,
      updated_at = now()
  where id = p_certificate_id;

  return jsonb_build_object('success', true, 'certificate_id', p_certificate_id);
end;
$$;

create or replace function public.xml_nfse_get_certificate_secret(
  p_secret text,
  p_certificate_id text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  row_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select jsonb_build_object(
    'id', c.id,
    'filename', c.filename,
    'cnpj', c.cnpj,
    'active', c.active,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'pfx_ciphertext', s.pfx_ciphertext,
    'pfx_iv', s.pfx_iv,
    'pfx_auth_tag', s.pfx_auth_tag,
    'passphrase_ciphertext', s.passphrase_ciphertext,
    'passphrase_iv', s.passphrase_iv,
    'passphrase_auth_tag', s.passphrase_auth_tag
  )
  into row_data
  from xml_nfse.certificates c
  join xml_nfse.certificate_secrets s on s.certificate_id = c.id
  where c.id = p_certificate_id;

  return row_data;
end;
$$;

create or replace function public.xml_nfse_rename_certificate(
  p_secret text,
  p_certificate_id text,
  p_filename text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  saved_certificate xml_nfse.certificates%rowtype;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if nullif(trim(coalesce(p_filename, '')), '') is null then
    raise exception 'Nome do certificado e obrigatorio' using errcode = '22023';
  end if;

  update xml_nfse.certificates
  set filename = trim(p_filename),
      updated_at = now()
  where id = p_certificate_id
  returning * into saved_certificate;

  if saved_certificate.id is null then
    return jsonb_build_object('success', false);
  end if;

  return to_jsonb(saved_certificate) || jsonb_build_object('success', true);
end;
$$;

create or replace function public.xml_nfse_delete_certificate(
  p_secret text,
  p_certificate_id text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  was_active boolean;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select active into was_active
  from xml_nfse.certificates
  where id = p_certificate_id;

  if was_active is null then
    return jsonb_build_object('success', false);
  end if;

  delete from xml_nfse.certificates where id = p_certificate_id;

  if was_active then
    update xml_nfse.certificates
    set active = true,
        updated_at = now()
    where id = (
      select id
      from xml_nfse.certificates
      order by created_at desc
      limit 1
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.xml_nfse_get_sync_state(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_cnpj_consulta text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  row_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  insert into xml_nfse.sync_state (certificate_id, environment, cnpj_consulta)
  values (p_certificate_id, p_environment, coalesce(p_cnpj_consulta, ''))
  on conflict (certificate_id, environment, cnpj_consulta) do nothing;

  select to_jsonb(s.*) into row_data
  from xml_nfse.sync_state s
  where s.certificate_id = p_certificate_id
    and s.environment = p_environment
    and s.cnpj_consulta = coalesce(p_cnpj_consulta, '');

  return row_data;
end;
$$;

create or replace function public.xml_nfse_update_sync_state(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_cnpj_consulta text,
  p_last_nsu bigint,
  p_max_nsu_seen bigint,
  p_status text,
  p_next_allowed_at timestamptz default null,
  p_last_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
begin
  perform xml_nfse.assert_app_secret(p_secret);

  insert into xml_nfse.sync_state (
    certificate_id,
    environment,
    cnpj_consulta,
    last_nsu,
    max_nsu_seen,
    status,
    last_success_at,
    next_allowed_at,
    last_error,
    updated_at
  )
  values (
    p_certificate_id,
    p_environment,
    coalesce(p_cnpj_consulta, ''),
    greatest(coalesce(p_last_nsu, 0), 0),
    greatest(coalesce(p_max_nsu_seen, 0), 0),
    coalesce(p_status, 'idle'),
    case when p_last_error is null then now() else null end,
    p_next_allowed_at,
    p_last_error,
    now()
  )
  on conflict (certificate_id, environment, cnpj_consulta) do update
  set last_nsu = case
        when coalesce(p_status, '') = 'error' then xml_nfse.sync_state.last_nsu
        else greatest(xml_nfse.sync_state.last_nsu, excluded.last_nsu)
      end,
      max_nsu_seen = greatest(xml_nfse.sync_state.max_nsu_seen, excluded.max_nsu_seen),
      status = excluded.status,
      last_success_at = coalesce(excluded.last_success_at, xml_nfse.sync_state.last_success_at),
      next_allowed_at = excluded.next_allowed_at,
      last_error = excluded.last_error,
      updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.xml_nfse_get_last_received_nsu(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_cnpj_consulta text
)
returns bigint
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  last_received bigint;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select coalesce(max(d.nsu), 0)
  into last_received
  from xml_nfse.documents d
  where d.certificate_id = p_certificate_id
    and d.environment = p_environment
    and regexp_replace(coalesce(d.tomador_cnpj, d.metadata ->> 'tomadorCnpj', ''), '\D', '', 'g') = regexp_replace(coalesce(p_cnpj_consulta, ''), '\D', '', 'g');

  return coalesce(last_received, 0);
end;
$$;

create or replace function public.xml_nfse_start_run(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_cnpj_consulta text,
  p_start_nsu bigint
)
returns uuid
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  run_id uuid;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  insert into xml_nfse.sync_runs (certificate_id, environment, cnpj_consulta, start_nsu)
  values (p_certificate_id, p_environment, coalesce(p_cnpj_consulta, ''), coalesce(p_start_nsu, 0))
  returning id into run_id;

  return run_id;
end;
$$;

create or replace function public.xml_nfse_finish_run(
  p_secret text,
  p_run_id uuid,
  p_status text,
  p_end_nsu bigint default null,
  p_max_nsu_seen bigint default null,
  p_documents_found integer default 0,
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
  set status = coalesce(p_status, status),
      end_nsu = p_end_nsu,
      max_nsu_seen = p_max_nsu_seen,
      documents_found = coalesce(p_documents_found, documents_found),
      error_message = p_error_message,
      finished_at = now()
  where id = p_run_id;

  return jsonb_build_object('success', found);
end;
$$;

create or replace function public.xml_nfse_upsert_document(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_nsu bigint,
  p_tipo text,
  p_chave text,
  p_file_name text,
  p_xml_sha256 text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  doc_id uuid;
  inserted_new boolean;
  metadata_data_emissao text;
  metadata_valor_servico text;
  cancelled boolean;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  metadata_data_emissao := nullif(nullif(coalesce(p_metadata ->> 'dataEmissao', ''), ''), 'N/A');
  metadata_valor_servico := nullif(nullif(replace(coalesce(p_metadata ->> 'valorServico', ''), ',', '.'), ''), 'N/A');

  cancelled := (
    lower(coalesce(p_metadata ->> 'status', '')) like '%cancel%'
    or coalesce((p_metadata ->> 'isCancellation')::boolean, false) is true
    or lower(coalesce(p_tipo, '')) like '%cancel%'
  );

  insert into xml_nfse.documents (
    certificate_id,
    environment,
    nsu,
    tipo,
    chave,
    numero_nfse,
    data_emissao,
    prestador_cnpj,
    prestador_nome,
    tomador_cnpj,
    tomador_nome,
    valor_servico,
    municipio_prestacao,
    codigo_tributacao,
    file_name,
    xml_sha256,
    metadata,
    is_cancelled
  )
  values (
    p_certificate_id,
    p_environment,
    p_nsu,
    coalesce(p_tipo, 'NFSE'),
    nullif(p_chave, ''),
    nullif(p_metadata ->> 'numeroNfse', ''),
    case when metadata_data_emissao ~ '^\d{4}-\d{2}-\d{2}$' then metadata_data_emissao::date else null end,
    nullif(nullif(p_metadata ->> 'prestadorCnpj', ''), 'N/A'),
    nullif(nullif(p_metadata ->> 'prestadorNome', ''), 'N/A'),
    nullif(nullif(p_metadata ->> 'tomadorCnpj', ''), 'N/A'),
    nullif(nullif(p_metadata ->> 'tomadorNome', ''), 'N/A'),
    case
      when metadata_valor_servico ~ '^-?\d+(\.\d+)?$'
       and metadata_valor_servico::numeric >= 0
       and metadata_valor_servico::numeric < 1000000000
      then round(metadata_valor_servico::numeric, 2)
      else null
    end,
    nullif(nullif(p_metadata ->> 'municipioPrestacao', ''), 'N/A'),
    nullif(nullif(p_metadata ->> 'codigoTributacao', ''), 'N/A'),
    p_file_name,
    p_xml_sha256,
    coalesce(p_metadata, '{}'::jsonb),
    cancelled
  )
  on conflict (certificate_id, environment, nsu) do update
  set tipo = excluded.tipo,
      chave = excluded.chave,
      numero_nfse = excluded.numero_nfse,
      data_emissao = excluded.data_emissao,
      prestador_cnpj = excluded.prestador_cnpj,
      prestador_nome = excluded.prestador_nome,
      tomador_cnpj = excluded.tomador_cnpj,
      tomador_nome = excluded.tomador_nome,
      valor_servico = excluded.valor_servico,
      municipio_prestacao = excluded.municipio_prestacao,
      codigo_tributacao = excluded.codigo_tributacao,
      file_name = excluded.file_name,
      xml_sha256 = excluded.xml_sha256,
      metadata = excluded.metadata,
      -- nao rebaixa cancelamento se ja estava cancelada
      is_cancelled = xml_nfse.documents.is_cancelled or excluded.is_cancelled,
      last_seen_at = now()
  returning id, (xmax = 0) into doc_id, inserted_new;

  -- Mantém document_stats coerente em inserts de NFSe
  if inserted_new and upper(coalesce(p_tipo, 'NFSE')) <> 'EVENTO' then
    insert into xml_nfse.document_stats (
      certificate_id, environment, active_count, cancelled_count, active_value, cancelled_value, updated_at
    )
    values (
      p_certificate_id,
      p_environment,
      case when cancelled then 0 else 1 end,
      case when cancelled then 1 else 0 end,
      case
        when cancelled then 0
        when metadata_valor_servico ~ '^-?\d+(\.\d+)?$'
         and metadata_valor_servico::numeric >= 0
         and metadata_valor_servico::numeric < 1000000000
        then round(metadata_valor_servico::numeric, 2)
        else 0
      end,
      case
        when not cancelled then 0
        when metadata_valor_servico ~ '^-?\d+(\.\d+)?$'
         and metadata_valor_servico::numeric >= 0
         and metadata_valor_servico::numeric < 1000000000
        then round(metadata_valor_servico::numeric, 2)
        else 0
      end,
      now()
    )
    on conflict (certificate_id, environment) do update set
      active_count = xml_nfse.document_stats.active_count + case when cancelled then 0 else 1 end,
      cancelled_count = xml_nfse.document_stats.cancelled_count + case when cancelled then 1 else 0 end,
      active_value = xml_nfse.document_stats.active_value + case
        when cancelled then 0
        when metadata_valor_servico ~ '^-?\d+(\.\d+)?$'
         and metadata_valor_servico::numeric >= 0
         and metadata_valor_servico::numeric < 1000000000
        then round(metadata_valor_servico::numeric, 2)
        else 0
      end,
      cancelled_value = xml_nfse.document_stats.cancelled_value + case
        when not cancelled then 0
        when metadata_valor_servico ~ '^-?\d+(\.\d+)?$'
         and metadata_valor_servico::numeric >= 0
         and metadata_valor_servico::numeric < 1000000000
        then round(metadata_valor_servico::numeric, 2)
        else 0
      end,
      updated_at = now();
  end if;

  return jsonb_build_object('success', true, 'document_id', doc_id, 'inserted', inserted_new);
end;
$$;

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
declare
  doc_id uuid;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select id into doc_id
  from xml_nfse.documents
  where certificate_id = p_certificate_id
    and environment = p_environment
    and nsu = p_nsu;

  insert into xml_nfse.download_events (certificate_id, document_id, environment, nsu, file_name)
  values (p_certificate_id, doc_id, p_environment, p_nsu, p_file_name);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.xml_nfse_upsert_xml_payload(
  p_secret text,
  p_token text,
  p_certificate_id text,
  p_environment text,
  p_nsu bigint,
  p_file_name text,
  p_xml_content text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  bytes_len integer;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  bytes_len := octet_length(coalesce(p_xml_content, ''));

  insert into xml_nfse.xml_payloads (
    token,
    certificate_id,
    environment,
    nsu,
    file_name,
    xml_content,
    content_bytes,
    expires_at
  )
  values (
    p_token,
    p_certificate_id,
    p_environment,
    p_nsu,
    p_file_name,
    p_xml_content,
    bytes_len,
    null
  )
  on conflict (token) do update
  set certificate_id = excluded.certificate_id,
      environment = excluded.environment,
      nsu = excluded.nsu,
      file_name = excluded.file_name,
      xml_content = excluded.xml_content,
      content_bytes = excluded.content_bytes,
      expires_at = null;

  return jsonb_build_object('success', true, 'token', p_token);
end;
$$;

create or replace function public.xml_nfse_get_xml_payload(
  p_secret text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  row_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select to_jsonb(p.*) into row_data
  from xml_nfse.xml_payloads p
  where p.token = p_token
    and (p.expires_at is null or p.expires_at >= now());

  return row_data;
end;
$$;

create or replace function public.xml_nfse_get_xml_payloads_by_tokens(
  p_secret text,
  p_tokens text[]
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  rows_data jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if cardinality(coalesce(p_tokens, array[]::text[])) > 100 then
    raise exception 'maximum of 100 XML tokens per request' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p.*) order by p.created_at desc), '[]'::jsonb)
  into rows_data
  from xml_nfse.xml_payloads p
  where p.token = any(coalesce(p_tokens, array[]::text[]))
    and (p.expires_at is null or p.expires_at >= now());

  return rows_data;
end;
$$;

create or replace function public.xml_nfse_storage_summary(
  p_secret text,
  p_certificate_id text default null,
  p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  summary jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  select jsonb_build_object(
    'totalPayloads', count(*),
    'permanentPayloads', count(*) filter (where p.expires_at is null),
    'expiringPayloads', count(*) filter (where p.expires_at is not null),
    'expiredPayloads', count(*) filter (where p.expires_at is not null and p.expires_at < now()),
    'totalBytes', coalesce(sum(coalesce(p.content_bytes, octet_length(p.xml_content))), 0),
    'firstCreatedAt', min(p.created_at),
    'lastCreatedAt', max(p.created_at)
  )
  into summary
  from xml_nfse.xml_payloads p
  where (p_certificate_id is null or p.certificate_id = p_certificate_id)
    and (p_environment is null or p.environment = p_environment);

  return coalesce(summary, '{}'::jsonb);
end;
$$;

-- Marca NFSe (nao EVENTO) como Cancelada por chave — usado na varredura so para lotes novos
create or replace function public.xml_nfse_mark_cancelled_by_chave(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_chave text,
  p_event_nsu bigint default null,
  p_event_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  updated_count integer := 0;
  clean_chave text := nullif(trim(coalesce(p_chave, '')), '');
  moved_value numeric := 0;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if clean_chave is null or clean_chave = '' or clean_chave = 'N/A' then
    return jsonb_build_object('success', true, 'updated', false, 'updated_count', 0);
  end if;

  with upd as (
    update xml_nfse.documents d
    set metadata = coalesce(d.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'status', 'Cancelada',
          'isCancellation', true,
          'eventoDescricao', coalesce(p_event_meta ->> 'eventoDescricao', d.metadata ->> 'eventoDescricao'),
          'eventoMotivo', coalesce(p_event_meta ->> 'eventoMotivo', d.metadata ->> 'eventoMotivo'),
          'tpEvento', coalesce(p_event_meta ->> 'tpEvento', d.metadata ->> 'tpEvento'),
          'cancelledByEventNsu', p_event_nsu,
          'cancelledAt', now()
        )),
        is_cancelled = true,
        last_seen_at = now()
    where d.certificate_id = p_certificate_id
      and d.environment = p_environment
      and d.chave = clean_chave
      and d.tipo <> 'EVENTO'
      and d.is_cancelled = false
    returning case
      when d.valor_servico >= 0 and d.valor_servico < 1e9 then d.valor_servico else 0
    end as v
  )
  select count(*)::integer, coalesce(sum(v), 0)
  into updated_count, moved_value
  from upd;

  if updated_count > 0 then
    insert into xml_nfse.document_stats (certificate_id, environment, active_count, cancelled_count, active_value, cancelled_value, updated_at)
    values (p_certificate_id, p_environment, 0, updated_count, 0, moved_value, now())
    on conflict (certificate_id, environment) do update set
      active_count = greatest(0, xml_nfse.document_stats.active_count - updated_count),
      cancelled_count = xml_nfse.document_stats.cancelled_count + updated_count,
      active_value = greatest(0, xml_nfse.document_stats.active_value - moved_value),
      cancelled_value = xml_nfse.document_stats.cancelled_value + moved_value,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'success', true,
    'updated', updated_count > 0,
    'updated_count', updated_count
  );
end;
$$;

grant execute on function public.xml_nfse_upsert_certificate(text, text, text, text, boolean, timestamptz) to anon, authenticated;
grant execute on function public.xml_nfse_get_setting(text, text) to anon, authenticated;
grant execute on function public.xml_nfse_set_setting(text, text, jsonb) to anon, authenticated;
grant execute on function public.xml_nfse_upsert_certificate_secret(text, text, text, text, boolean, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_list_certificates(text) to anon, authenticated;
grant execute on function public.xml_nfse_set_active_certificate(text, text) to anon, authenticated;
grant execute on function public.xml_nfse_get_certificate_secret(text, text) to anon, authenticated;
grant execute on function public.xml_nfse_rename_certificate(text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_delete_certificate(text, text) to anon, authenticated;
grant execute on function public.xml_nfse_get_sync_state(text, text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_update_sync_state(text, text, text, text, bigint, bigint, text, timestamptz, text) to anon, authenticated;
grant execute on function public.xml_nfse_get_last_received_nsu(text, text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_start_run(text, text, text, text, bigint) to anon, authenticated;
grant execute on function public.xml_nfse_finish_run(text, uuid, text, bigint, bigint, integer, text) to anon, authenticated;
grant execute on function public.xml_nfse_upsert_document(text, text, text, bigint, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.xml_nfse_register_download(text, text, text, bigint, text) to anon, authenticated;
grant execute on function public.xml_nfse_upsert_xml_payload(text, text, text, text, bigint, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_get_xml_payload(text, text) to anon, authenticated;
grant execute on function public.xml_nfse_get_xml_payloads_by_tokens(text, text[]) to anon, authenticated;
grant execute on function public.xml_nfse_storage_summary(text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_mark_cancelled_by_chave(text, text, text, text, bigint, jsonb) to anon, authenticated;

-- Totais rapidos (document_stats quando sem filtro; senao agregacao filtrada)
create or replace function public.xml_nfse_get_document_totals(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_start_date date default null,
  p_end_date date default null,
  p_cnpj_consulta text default '',
  p_party_cnpj text default '',
  p_party_role text default 'tomador',
  p_search text default '',
  p_include_cancelled boolean default false,
  p_only_cancelled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
set statement_timeout = '15000'
as $$
declare
  search_term text := lower(trim(coalesce(p_search, '')));
  search_digits text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
  search_decimal text := replace(lower(trim(coalesce(p_search, ''))), ',', '.');
  cnpj_consulta_digits text := regexp_replace(coalesce(p_cnpj_consulta, ''), '\D', '', 'g');
  party_cnpj_digits text := regexp_replace(coalesce(p_party_cnpj, ''), '\D', '', 'g');
  search_numeric numeric;
  simple_filter boolean;
  total_count integer := 0;
  total_value numeric := 0;
  src text := 'scan';
  st record;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if search_decimal ~ '^[0-9]+(\.[0-9]+)?$' then
    search_numeric := search_decimal::numeric;
  end if;

  simple_filter := (
    search_term = ''
    and cnpj_consulta_digits = ''
    and party_cnpj_digits = ''
    and p_start_date is null
    and p_end_date is null
  );

  if simple_filter then
    select * into st
    from xml_nfse.document_stats s
    where s.certificate_id = p_certificate_id
      and s.environment = p_environment;

    if found then
      if coalesce(p_only_cancelled, false) then
        total_count := st.cancelled_count;
        total_value := st.cancelled_value;
      elsif coalesce(p_include_cancelled, false) then
        total_count := st.active_count + st.cancelled_count;
        total_value := st.active_value + st.cancelled_value;
      else
        total_count := st.active_count;
        total_value := st.active_value;
      end if;
      src := 'stats';
      return jsonb_build_object(
        'total', total_count,
        'totalValue', total_value,
        'source', src,
        'updatedAt', st.updated_at
      );
    end if;
  end if;

  select
    count(*)::integer,
    coalesce(sum(
      case when d.valor_servico >= 0 and d.valor_servico < 1000000000 then d.valor_servico else 0 end
    ), 0)::numeric
  into total_count, total_value
  from xml_nfse.documents d
  where d.certificate_id = p_certificate_id
    and d.environment = p_environment
    and d.tipo <> 'EVENTO'
    and (
      case
        when coalesce(p_only_cancelled, false) then d.is_cancelled = true
        when coalesce(p_include_cancelled, false) then true
        else d.is_cancelled = false
      end
    )
    and (p_start_date is null or d.data_emissao >= p_start_date)
    and (p_end_date is null or d.data_emissao <= p_end_date)
    and (cnpj_consulta_digits = '' or coalesce(d.tomador_cnpj, '') = cnpj_consulta_digits)
    and (
      party_cnpj_digits = ''
      or (coalesce(p_party_role, 'tomador') in ('prestador', 'ambos') and coalesce(d.prestador_cnpj, '') = party_cnpj_digits)
      or (coalesce(p_party_role, 'tomador') in ('tomador', 'ambos') and coalesce(d.tomador_cnpj, '') = party_cnpj_digits)
    )
    and (
      search_term = ''
      or lower(coalesce(d.prestador_nome, '')) like '%' || search_term || '%'
      or lower(coalesce(d.tomador_nome, '')) like '%' || search_term || '%'
      or (search_digits <> '' and coalesce(d.prestador_cnpj, '') like '%' || search_digits || '%')
      or (search_digits <> '' and coalesce(d.tomador_cnpj, '') like '%' || search_digits || '%')
      or (search_numeric is not null and coalesce(d.valor_servico, 0) = search_numeric)
      or (search_decimal <> '' and coalesce(d.valor_servico, 0)::text like '%' || search_decimal || '%')
      or (search_digits <> '' and coalesce(d.chave, '') like '%' || search_digits || '%')
      or (search_digits <> '' and coalesce(d.numero_nfse, '') like '%' || search_digits || '%')
    );

  return jsonb_build_object(
    'total', coalesce(total_count, 0),
    'totalValue', coalesce(total_value, 0),
    'source', src
  );
end;
$$;

grant execute on function public.xml_nfse_get_document_totals(text, text, text, date, date, text, text, text, text, boolean, boolean) to anon, authenticated;

drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text, integer, integer);
drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text, text, text, integer, integer);
drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text, text, text, text, boolean, integer, integer);
drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text, text, text, text, boolean, boolean, integer, integer);
drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text, text, text, text, boolean, boolean, integer, integer, boolean);

create or replace function public.xml_nfse_list_documents(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_start_date date default null,
  p_end_date date default null,
  p_cnpj_consulta text default '',
  p_party_cnpj text default '',
  p_party_role text default 'tomador',
  p_search text default '',
  p_include_cancelled boolean default false,
  p_only_cancelled boolean default false,
  p_limit integer default null,
  p_offset integer default null,
  p_skip_totals boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
set statement_timeout = 30000
as $$
declare
  search_term text := lower(trim(coalesce(p_search, '')));
  search_digits text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
  search_decimal text := replace(lower(trim(coalesce(p_search, ''))), ',', '.');
  cnpj_consulta_digits text := regexp_replace(coalesce(p_cnpj_consulta, ''), '\D', '', 'g');
  party_cnpj_digits text := regexp_replace(coalesce(p_party_cnpj, ''), '\D', '', 'g');
  search_numeric numeric;
  -- UI pede 10; export pagina até 500 por request (Node faz loop para o total)
  lim integer := least(greatest(coalesce(p_limit, 10), 1), 500);
  off integer := greatest(coalesce(p_offset, 0), 0);
  total_count integer := 0;
  total_value numeric := 0;
  docs_json jsonb := '[]'::jsonb;
  totals_json jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  if search_decimal ~ '^[0-9]+(\.[0-9]+)?$' then
    search_numeric := search_decimal::numeric;
  end if;

  if not coalesce(p_skip_totals, false) then
    totals_json := public.xml_nfse_get_document_totals(
      p_secret, p_certificate_id, p_environment,
      p_start_date, p_end_date, p_cnpj_consulta, p_party_cnpj, p_party_role,
      p_search, p_include_cancelled, p_only_cancelled
    );
    total_count := coalesce((totals_json ->> 'total')::integer, 0);
    total_value := coalesce((totals_json ->> 'totalValue')::numeric, 0);
  end if;

  select coalesce(jsonb_agg(to_jsonb(page_rows.*) order by page_rows.ord), '[]'::jsonb)
  into docs_json
  from (
    select
      d.id,
      d.certificate_id,
      d.environment,
      d.nsu,
      d.tipo,
      d.chave,
      d.numero_nfse,
      d.data_emissao,
      d.prestador_cnpj,
      d.prestador_nome,
      d.tomador_cnpj,
      d.tomador_nome,
      d.valor_servico,
      d.municipio_prestacao,
      d.codigo_tributacao,
      d.file_name,
      d.xml_sha256,
      d.metadata || jsonb_strip_nulls(jsonb_build_object(
        'prestadorCnpj', d.prestador_cnpj,
        'prestadorNome', d.prestador_nome,
        'tomadorCnpj', d.tomador_cnpj,
        'tomadorNome', d.tomador_nome,
        'valorServico', d.valor_servico::text,
        'municipioPrestacao', d.municipio_prestacao,
        'codigoTributacao', d.codigo_tributacao,
        'status', case when d.is_cancelled then 'Cancelada' else coalesce(d.metadata ->> 'status', 'Autorizada') end,
        'isCancellation', d.is_cancelled
      )) as metadata,
      d.first_seen_at,
      d.last_seen_at,
      row_number() over (order by d.data_emissao desc nulls last, d.nsu desc) as ord
    from xml_nfse.documents d
    where d.certificate_id = p_certificate_id
      and d.environment = p_environment
      and d.tipo <> 'EVENTO'
      and (
        case
          when coalesce(p_only_cancelled, false) then d.is_cancelled = true
          when coalesce(p_include_cancelled, false) then true
          else d.is_cancelled = false
        end
      )
      and (p_start_date is null or d.data_emissao >= p_start_date)
      and (p_end_date is null or d.data_emissao <= p_end_date)
      and (cnpj_consulta_digits = '' or coalesce(d.tomador_cnpj, '') = cnpj_consulta_digits)
      and (
        party_cnpj_digits = ''
        or (coalesce(p_party_role, 'tomador') in ('prestador', 'ambos') and coalesce(d.prestador_cnpj, '') = party_cnpj_digits)
        or (coalesce(p_party_role, 'tomador') in ('tomador', 'ambos') and coalesce(d.tomador_cnpj, '') = party_cnpj_digits)
      )
      and (
        search_term = ''
        or lower(coalesce(d.prestador_nome, '')) like '%' || search_term || '%'
        or lower(coalesce(d.tomador_nome, '')) like '%' || search_term || '%'
        or (search_digits <> '' and coalesce(d.prestador_cnpj, '') like '%' || search_digits || '%')
        or (search_digits <> '' and coalesce(d.tomador_cnpj, '') like '%' || search_digits || '%')
        or (search_numeric is not null and coalesce(d.valor_servico, 0) = search_numeric)
        or (search_decimal <> '' and coalesce(d.valor_servico, 0)::text like '%' || search_decimal || '%')
        or (search_digits <> '' and coalesce(d.chave, '') like '%' || search_digits || '%')
        or (search_digits <> '' and coalesce(d.numero_nfse, '') like '%' || search_digits || '%')
      )
    order by d.data_emissao desc nulls last, d.nsu desc
    limit lim
    offset off
  ) page_rows;

  return jsonb_build_object(
    'documents', coalesce(docs_json, '[]'::jsonb),
    'total', case when coalesce(p_skip_totals, false) then null else total_count end,
    'totalValue', case when coalesce(p_skip_totals, false) then null else total_value end,
    'totalsPending', coalesce(p_skip_totals, false)
  );
end;
$$;

grant execute on function public.xml_nfse_list_documents(text, text, text, date, date, text, text, text, text, boolean, boolean, integer, integer, boolean) to anon, authenticated;
grant execute on function public.xml_nfse_list_units(text) to anon, authenticated;
grant execute on function public.xml_nfse_upsert_unit(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_delete_unit(text, uuid) to anon, authenticated;


-- ==================================================
-- Função otimizada para o Dashboard de Cidades
-- ==================================================
create or replace function public.xml_nfse_get_dashboard_summary(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
set statement_timeout = '8000'
as $$
declare
  result_json jsonb;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  -- Stats O(1) + 1 row por certificado (index documents_dash_latest_emissao_idx)
  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into result_json
  from (
    select
      c.id as "certificateId",
      c.filename,
      c.cnpj,
      c.active,
      coalesce(st.active_count, 0) + coalesce(st.cancelled_count, 0) as "totalXmls",
      coalesce(last_doc.last_update, 'Sem XMLs') as "lastUpdate"
    from xml_nfse.certificates c
    inner join xml_nfse.certificate_secrets s on s.certificate_id = c.id
    left join xml_nfse.document_stats st
      on st.certificate_id = c.id
     and st.environment = 'producao'
    left join lateral (
      select coalesce(
        nullif(trim(d.metadata ->> 'dataEmissaoCompleta'), ''),
        nullif(trim(d.metadata ->> 'dataEmissao'), ''),
        to_char(d.data_emissao, 'YYYY-MM-DD'),
        to_char(
          d.first_seen_at at time zone 'America/Sao_Paulo',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ),
        'Sem XMLs'
      ) as last_update
      from xml_nfse.documents d
      where d.certificate_id = c.id
        and d.environment = 'producao'
        and d.tipo <> 'EVENTO'
      order by d.data_emissao desc nulls last, d.nsu desc
      limit 1
    ) last_doc on true
    order by c.active desc, c.filename
  ) t;

  return result_json;
end;
$$;

grant execute on function public.xml_nfse_get_dashboard_summary(text) to anon, authenticated;

-- ============================================================
-- Backfill de cancelamentos (e101101 / e105102) a partir de EVENTOs
-- ============================================================
create or replace function public.xml_nfse_backfill_cancellations(
  p_secret text,
  p_batch_limit integer default 50000
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
set statement_timeout = '120s'
as $$
declare
  eventos_found integer := 0;
  nfse_updated integer := 0;
  eventos_meta_updated integer := 0;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  create temporary table if not exists tmp_cancel_keys (
    certificate_id text not null,
    environment text not null,
    chave text,
    event_nsu bigint,
    evento_descricao text,
    evento_motivo text,
    tp_evento text
  ) on commit drop;

  truncate tmp_cancel_keys;

  insert into tmp_cancel_keys (certificate_id, environment, chave, event_nsu, evento_descricao, evento_motivo, tp_evento)
  select
    d.certificate_id,
    d.environment,
    coalesce(nullif(trim(d.chave), ''), substring(p.xml_content from '<chNFSe>([^<]+)</chNFSe>')),
    d.nsu,
    coalesce(
      substring(p.xml_content from '<xDesc>([^<]*[Cc]ancel[^<]*)</xDesc>'),
      substring(p.xml_content from '<xDesc>([^<]+)</xDesc>'),
      'Cancelamento de NFS-e'
    ),
    coalesce(substring(p.xml_content from '<xMotivo>([^<]+)</xMotivo>'), ''),
    case when p.xml_content ~* '<e105102[\s>]' then 'e105102' else 'e101101' end
  from xml_nfse.documents d
  join xml_nfse.xml_payloads p
    on p.certificate_id = d.certificate_id
   and p.nsu = d.nsu
  where d.tipo = 'EVENTO'
    and (
      p.xml_content ~* '<e101101[\s>]'
      or p.xml_content ~* '<e105102[\s>]'
      or p.xml_content ~* 'Cancelamento de NFS-e'
    )
  limit greatest(coalesce(p_batch_limit, 50000), 1);

  get diagnostics eventos_found = row_count;

  update xml_nfse.documents d
  set metadata = coalesce(d.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'status', 'Cancelada',
        'isCancellation', true,
        'eventoDescricao', t.evento_descricao,
        'eventoMotivo', nullif(t.evento_motivo, ''),
        'tpEvento', t.tp_evento
      )),
      last_seen_at = now()
  from tmp_cancel_keys t
  where d.certificate_id = t.certificate_id
    and d.environment = t.environment
    and d.nsu = t.event_nsu
    and d.tipo = 'EVENTO';

  get diagnostics eventos_meta_updated = row_count;

  update xml_nfse.documents d
  set metadata = coalesce(d.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'status', 'Cancelada',
        'isCancellation', true,
        'eventoDescricao', t.evento_descricao,
        'eventoMotivo', nullif(t.evento_motivo, ''),
        'tpEvento', t.tp_evento,
        'cancelledByEventNsu', t.event_nsu,
        'cancelledAt', now(),
        'cancelledByBackfill', true
      )),
      is_cancelled = true,
      last_seen_at = now()
  from (
    select distinct on (certificate_id, environment, chave)
      certificate_id, environment, chave, event_nsu, evento_descricao, evento_motivo, tp_evento
    from tmp_cancel_keys
    where chave is not null and chave <> '' and chave <> 'N/A'
    order by certificate_id, environment, chave, event_nsu desc
  ) t
  where d.certificate_id = t.certificate_id
    and d.environment = t.environment
    and d.chave = t.chave
    and d.tipo <> 'EVENTO';

  get diagnostics nfse_updated = row_count;

  return jsonb_build_object(
    'success', true,
    'eventos_cancel_found', eventos_found,
    'eventos_metadata_updated', eventos_meta_updated,
    'nfse_marked_cancelled', nfse_updated
  );
end;
$$;

grant execute on function public.xml_nfse_backfill_cancellations(text, integer) to anon, authenticated;

-- Lease distribuído para impedir duas varreduras automáticas do mesmo shard.
create table if not exists xml_nfse.scheduler_leases (
  name text primary key,
  lease_id uuid not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table xml_nfse.scheduler_leases enable row level security;
revoke all on table xml_nfse.scheduler_leases from public, anon, authenticated;

create or replace function public.xml_nfse_claim_scheduler_lease(
  p_secret text,
  p_name text,
  p_lease_seconds integer default 70
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, extensions, pg_temp
as $$
declare
  claimed_id uuid;
  current_until timestamptz;
  safe_seconds integer := least(greatest(coalesce(p_lease_seconds, 70), 30), 300);
begin
  perform xml_nfse.assert_app_secret(p_secret);
  insert into xml_nfse.scheduler_leases (name, lease_id, locked_until, updated_at)
  values (p_name, gen_random_uuid(), now() + make_interval(secs => safe_seconds), now())
  on conflict (name) do update
    set lease_id = gen_random_uuid(),
        locked_until = now() + make_interval(secs => safe_seconds),
        updated_at = now()
    where xml_nfse.scheduler_leases.locked_until <= now()
  returning lease_id, locked_until into claimed_id, current_until;

  if claimed_id is null then
    select locked_until into current_until from xml_nfse.scheduler_leases where name = p_name;
    return jsonb_build_object('acquired', false, 'lockedUntil', current_until);
  end if;
  return jsonb_build_object('acquired', true, 'leaseId', claimed_id, 'lockedUntil', current_until);
end;
$$;

create or replace function public.xml_nfse_release_scheduler_lease(
  p_secret text,
  p_name text,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = xml_nfse, extensions, pg_temp
as $$
declare
  released_count integer;
begin
  perform xml_nfse.assert_app_secret(p_secret);
  delete from xml_nfse.scheduler_leases where name = p_name and lease_id = p_lease_id;
  get diagnostics released_count = row_count;
  return released_count > 0;
end;
$$;

revoke execute on function public.xml_nfse_claim_scheduler_lease(text, text, integer) from public;
revoke execute on function public.xml_nfse_release_scheduler_lease(text, text, uuid) from public;
grant execute on function public.xml_nfse_claim_scheduler_lease(text, text, integer) to anon, authenticated;
grant execute on function public.xml_nfse_release_scheduler_lease(text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
