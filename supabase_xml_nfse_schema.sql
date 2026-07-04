create schema if not exists xml_nfse;
create extension if not exists pgcrypto with schema extensions;

create table if not exists xml_nfse.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into xml_nfse.settings (key, value)
values ('app_secret_sha256', '4a566d34c43e975e16796070f90078b27781e4f60180c0d497b37d169375f1ed')
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
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (certificate_id, environment, nsu)
);

alter table xml_nfse.documents
  alter column valor_servico type numeric(20,2);

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
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists sync_state_lookup_idx
  on xml_nfse.sync_state (certificate_id, environment, cnpj_consulta);

create index if not exists documents_certificate_environment_nsu_desc_idx
  on xml_nfse.documents (certificate_id, environment, nsu desc);

create index if not exists documents_tomador_lookup_idx
  on xml_nfse.documents (certificate_id, environment, tomador_cnpj, nsu desc);

create index if not exists documents_prestador_lookup_idx
  on xml_nfse.documents (certificate_id, environment, prestador_cnpj, nsu desc);

create index if not exists documents_emissao_lookup_idx
  on xml_nfse.documents (certificate_id, environment, data_emissao desc);

create index if not exists documents_chave_idx
  on xml_nfse.documents (chave);

create index if not exists xml_payloads_expires_at_idx
  on xml_nfse.xml_payloads (expires_at);

create index if not exists xml_payloads_certificate_environment_nsu_idx
  on xml_nfse.xml_payloads (certificate_id, environment, nsu);

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
  p_active boolean default true
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
  set last_nsu = excluded.last_nsu,
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
begin
  perform xml_nfse.assert_app_secret(p_secret);

  metadata_data_emissao := nullif(nullif(coalesce(p_metadata ->> 'dataEmissao', ''), ''), 'N/A');
  metadata_valor_servico := nullif(nullif(replace(coalesce(p_metadata ->> 'valorServico', ''), ',', '.'), ''), 'N/A');

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
    metadata
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
       and length(regexp_replace(split_part(metadata_valor_servico, '.', 1), '^-', '')) <= 18
      then round(metadata_valor_servico::numeric, 2)
      else null
    end,
    nullif(nullif(p_metadata ->> 'municipioPrestacao', ''), 'N/A'),
    nullif(nullif(p_metadata ->> 'codigoTributacao', ''), 'N/A'),
    p_file_name,
    p_xml_sha256,
    coalesce(p_metadata, '{}'::jsonb)
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
      last_seen_at = now()
  returning id, (xmax = 0) into doc_id, inserted_new;

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
begin
  perform xml_nfse.assert_app_secret(p_secret);

  insert into xml_nfse.xml_payloads (
    token,
    certificate_id,
    environment,
    nsu,
    file_name,
    xml_content,
    expires_at
  )
  values (
    p_token,
    p_certificate_id,
    p_environment,
    p_nsu,
    p_file_name,
    p_xml_content,
    null
  )
  on conflict (token) do update
  set certificate_id = excluded.certificate_id,
      environment = excluded.environment,
      nsu = excluded.nsu,
      file_name = excluded.file_name,
      xml_content = excluded.xml_content,
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

create or replace function public.xml_nfse_list_xml_payloads(
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

  select coalesce(jsonb_agg(to_jsonb(p.*) order by p.created_at desc), '[]'::jsonb)
  into rows_data
  from xml_nfse.xml_payloads p
  where p.expires_at is null or p.expires_at >= now()
  limit 500;

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
    'totalBytes', coalesce(sum(octet_length(p.xml_content)), 0),
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

grant execute on function public.xml_nfse_upsert_certificate(text, text, text, text, boolean) to anon, authenticated;
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
grant execute on function public.xml_nfse_list_xml_payloads(text) to anon, authenticated;
grant execute on function public.xml_nfse_storage_summary(text, text, text) to anon, authenticated;

drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text, integer, integer);

create or replace function public.xml_nfse_list_documents(
  p_secret text,
  p_certificate_id text,
  p_environment text,
  p_start_date date default null,
  p_end_date date default null,
  p_cnpj_consulta text default '',
  p_party_cnpj text default '',
  p_party_role text default 'tomador',
  p_limit integer default null,
  p_offset integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = xml_nfse, public, extensions
as $$
declare
  rows_data jsonb;
  total_count integer;
begin
  perform xml_nfse.assert_app_secret(p_secret);

  with enriched as (
    select
      d.*,
      coalesce(d.data_emissao, base.data_emissao) as effective_data_emissao,
      coalesce(d.prestador_cnpj, base.prestador_cnpj) as effective_prestador_cnpj,
      coalesce(d.prestador_nome, base.prestador_nome) as effective_prestador_nome,
      coalesce(d.tomador_cnpj, base.tomador_cnpj) as effective_tomador_cnpj,
      coalesce(d.tomador_nome, base.tomador_nome) as effective_tomador_nome,
      coalesce(d.valor_servico, base.valor_servico) as effective_valor_servico,
      coalesce(d.municipio_prestacao, base.municipio_prestacao) as effective_municipio_prestacao,
      coalesce(d.codigo_tributacao, base.codigo_tributacao) as effective_codigo_tributacao,
      d.metadata || jsonb_strip_nulls(jsonb_build_object(
        'prestadorCnpj', coalesce(d.metadata ->> 'prestadorCnpj', base.prestador_cnpj),
        'prestadorNome', coalesce(d.metadata ->> 'prestadorNome', base.prestador_nome),
        'tomadorCnpj', coalesce(d.metadata ->> 'tomadorCnpj', base.tomador_cnpj),
        'tomadorNome', coalesce(d.metadata ->> 'tomadorNome', base.tomador_nome),
        'valorServico', coalesce(d.metadata ->> 'valorServico', base.valor_servico::text),
        'municipioPrestacao', coalesce(d.metadata ->> 'municipioPrestacao', base.municipio_prestacao),
        'codigoTributacao', coalesce(d.metadata ->> 'codigoTributacao', base.codigo_tributacao)
      )) as effective_metadata
    from xml_nfse.documents d
    left join lateral (
      select b.*
      from xml_nfse.documents b
      where b.certificate_id = d.certificate_id
        and b.environment = d.environment
        and b.chave = d.chave
        and b.tipo <> 'EVENTO'
      order by b.nsu desc
      limit 1
    ) base on true
  ),
  filtered as (
    select *
    from enriched d
    where d.certificate_id = p_certificate_id
      and d.environment = p_environment
      and (p_start_date is null or d.effective_data_emissao >= p_start_date)
      and (p_end_date is null or d.effective_data_emissao <= p_end_date)
      and (
        coalesce(p_cnpj_consulta, '') = ''
        or regexp_replace(coalesce(d.effective_tomador_cnpj, ''), '\D', '', 'g') = regexp_replace(p_cnpj_consulta, '\D', '', 'g')
      )
      and (
        coalesce(p_party_cnpj, '') = ''
        or (
          coalesce(p_party_role, 'tomador') in ('prestador', 'ambos')
          and regexp_replace(coalesce(d.effective_prestador_cnpj, ''), '\D', '', 'g') = regexp_replace(p_party_cnpj, '\D', '', 'g')
        )
        or (
          coalesce(p_party_role, 'tomador') in ('tomador', 'ambos')
          and regexp_replace(coalesce(d.effective_tomador_cnpj, ''), '\D', '', 'g') = regexp_replace(p_party_cnpj, '\D', '', 'g')
        )
      )
  ),
  ranked as (
    select
      filtered.*,
      row_number() over (
        partition by case
          when nullif(filtered.chave, '') is not null and filtered.chave <> 'N/A' then filtered.chave
          else filtered.id::text
        end
        order by case when filtered.tipo = 'EVENTO' then 1 else 0 end, filtered.nsu desc
      ) as dedupe_rank
    from filtered
  )
  select count(*) into total_count
  from ranked
  where dedupe_rank = 1;

  with enriched as (
    select
      d.*,
      coalesce(d.data_emissao, base.data_emissao) as effective_data_emissao,
      coalesce(d.prestador_cnpj, base.prestador_cnpj) as effective_prestador_cnpj,
      coalesce(d.prestador_nome, base.prestador_nome) as effective_prestador_nome,
      coalesce(d.tomador_cnpj, base.tomador_cnpj) as effective_tomador_cnpj,
      coalesce(d.tomador_nome, base.tomador_nome) as effective_tomador_nome,
      coalesce(d.valor_servico, base.valor_servico) as effective_valor_servico,
      coalesce(d.municipio_prestacao, base.municipio_prestacao) as effective_municipio_prestacao,
      coalesce(d.codigo_tributacao, base.codigo_tributacao) as effective_codigo_tributacao,
      d.metadata || jsonb_strip_nulls(jsonb_build_object(
        'prestadorCnpj', coalesce(d.metadata ->> 'prestadorCnpj', base.prestador_cnpj),
        'prestadorNome', coalesce(d.metadata ->> 'prestadorNome', base.prestador_nome),
        'tomadorCnpj', coalesce(d.metadata ->> 'tomadorCnpj', base.tomador_cnpj),
        'tomadorNome', coalesce(d.metadata ->> 'tomadorNome', base.tomador_nome),
        'valorServico', coalesce(d.metadata ->> 'valorServico', base.valor_servico::text),
        'municipioPrestacao', coalesce(d.metadata ->> 'municipioPrestacao', base.municipio_prestacao),
        'codigoTributacao', coalesce(d.metadata ->> 'codigoTributacao', base.codigo_tributacao)
      )) as effective_metadata
    from xml_nfse.documents d
    left join lateral (
      select b.*
      from xml_nfse.documents b
      where b.certificate_id = d.certificate_id
        and b.environment = d.environment
        and b.chave = d.chave
        and b.tipo <> 'EVENTO'
      order by b.nsu desc
      limit 1
    ) base on true
  ),
  filtered as (
    select
      d.id,
      d.certificate_id,
      d.environment,
      d.nsu,
      d.tipo,
      d.chave,
      d.numero_nfse,
      d.effective_data_emissao as data_emissao,
      d.effective_prestador_cnpj as prestador_cnpj,
      d.effective_prestador_nome as prestador_nome,
      d.effective_tomador_cnpj as tomador_cnpj,
      d.effective_tomador_nome as tomador_nome,
      d.effective_valor_servico as valor_servico,
      d.effective_municipio_prestacao as municipio_prestacao,
      d.effective_codigo_tributacao as codigo_tributacao,
      d.file_name,
      d.xml_sha256,
      d.effective_metadata as metadata,
      d.first_seen_at,
      d.last_seen_at
    from enriched d
    where d.certificate_id = p_certificate_id
      and d.environment = p_environment
      and (p_start_date is null or d.effective_data_emissao >= p_start_date)
      and (p_end_date is null or d.effective_data_emissao <= p_end_date)
      and (
        coalesce(p_cnpj_consulta, '') = ''
        or regexp_replace(coalesce(d.effective_tomador_cnpj, ''), '\D', '', 'g') = regexp_replace(p_cnpj_consulta, '\D', '', 'g')
      )
      and (
        coalesce(p_party_cnpj, '') = ''
        or (
          coalesce(p_party_role, 'tomador') in ('prestador', 'ambos')
          and regexp_replace(coalesce(d.effective_prestador_cnpj, ''), '\D', '', 'g') = regexp_replace(p_party_cnpj, '\D', '', 'g')
        )
        or (
          coalesce(p_party_role, 'tomador') in ('tomador', 'ambos')
          and regexp_replace(coalesce(d.effective_tomador_cnpj, ''), '\D', '', 'g') = regexp_replace(p_party_cnpj, '\D', '', 'g')
        )
      )
  ),
  ranked as (
    select
      filtered.*,
      row_number() over (
        partition by case
          when nullif(filtered.chave, '') is not null and filtered.chave <> 'N/A' then filtered.chave
          else filtered.id::text
        end
        order by case when filtered.tipo = 'EVENTO' then 1 else 0 end, filtered.nsu desc
      ) as dedupe_rank
    from filtered
  ),
  page_rows as (
    select
      id,
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
      first_seen_at,
      last_seen_at
    from ranked
    where dedupe_rank = 1
    order by nsu desc
    limit coalesce(p_limit, 100000)
    offset coalesce(p_offset, 0)
  )
  select coalesce(jsonb_agg(to_jsonb(filtered.*)), '[]'::jsonb)
  into rows_data
  from page_rows filtered;

  return jsonb_build_object('documents', rows_data, 'total', total_count);
end;
$$;

grant execute on function public.xml_nfse_list_documents(text, text, text, date, date, text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.xml_nfse_list_units(text) to anon, authenticated;
grant execute on function public.xml_nfse_upsert_unit(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.xml_nfse_delete_unit(text, uuid) to anon, authenticated;

