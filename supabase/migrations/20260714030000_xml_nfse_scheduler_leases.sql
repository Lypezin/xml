begin;

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
    select locked_until into current_until
    from xml_nfse.scheduler_leases
    where name = p_name;
    return jsonb_build_object('acquired', false, 'lockedUntil', current_until);
  end if;

  return jsonb_build_object(
    'acquired', true,
    'leaseId', claimed_id,
    'lockedUntil', current_until
  );
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
  delete from xml_nfse.scheduler_leases
  where name = p_name and lease_id = p_lease_id;
  get diagnostics released_count = row_count;
  return released_count > 0;
end;
$$;

revoke execute on function public.xml_nfse_claim_scheduler_lease(text, text, integer) from public;
revoke execute on function public.xml_nfse_release_scheduler_lease(text, text, uuid) from public;
grant execute on function public.xml_nfse_claim_scheduler_lease(text, text, integer) to anon, authenticated;
grant execute on function public.xml_nfse_release_scheduler_lease(text, text, uuid) to anon, authenticated;

-- Fecha apenas telemetria antiga abandonada; os cursores NSU não são alterados.
update xml_nfse.sync_runs
set status = 'error',
    finished_at = coalesce(finished_at, now()),
    error_message = coalesce(error_message, 'Execução antiga encerrada ao ativar o agendador diário.')
where status = 'running'
  and started_at < now() - interval '1 day';

commit;

notify pgrst, 'reload schema';
