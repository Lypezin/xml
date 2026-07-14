begin;

-- Obsolete unbounded endpoints. The application uses paginated documents and
-- token-scoped payload retrieval instead.
drop function if exists public.xml_nfse_list_xml_payloads(text);
drop function if exists public.xml_nfse_list_documents(text, text, text, date, date, text);

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

revoke execute on function public.xml_nfse_get_xml_payloads_by_tokens(text, text[]) from public;
grant execute on function public.xml_nfse_get_xml_payloads_by_tokens(text, text[]) to anon, authenticated;

alter table xml_nfse.document_stats enable row level security;
revoke all on table xml_nfse.document_stats from public, anon, authenticated;

commit;
