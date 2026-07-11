-- Sobe o teto por página de xml_nfse_list_documents de 100 para 500.
-- A UI continua pedindo 10; Excel/ZIP paginam no Node até o total do filtro.
-- Rode no SQL Editor do Supabase se o banco já estiver implantado.

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
