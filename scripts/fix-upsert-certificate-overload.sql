-- Fix PGRST203: duas assinaturas de xml_nfse_upsert_certificate
-- Mantém apenas a versão com p_valid_until (default null).

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

notify pgrst, 'reload schema';
