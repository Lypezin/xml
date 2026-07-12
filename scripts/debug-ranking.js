const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: 5432,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const certs = await client.query(`
    select id, filename, cnpj, active
    from xml_nfse.certificates
    order by filename
  `);
  console.log('certs:', certs.rows);

  const topP = await client.query(`
    select prestador_cnpj, prestador_nome,
           count(*)::int as n,
           sum(valor_servico)::numeric as total,
           max(valor_servico)::numeric as maxv,
           percentile_cont(0.5) within group (order by valor_servico) as median
    from xml_nfse.documents
    where environment = 'producao' and tipo <> 'EVENTO' and not is_cancelled
    group by 1, 2
    order by total desc nulls last
    limit 15
  `);
  console.log('top prestadores raw:', topP.rows);

  const topT = await client.query(`
    select tomador_cnpj, tomador_nome,
           count(*)::int as n,
           sum(valor_servico)::numeric as total,
           count(distinct certificate_id)::int as certs
    from xml_nfse.documents
    where environment = 'producao' and tipo <> 'EVENTO' and not is_cancelled
    group by 1, 2
    order by total desc nulls last
    limit 15
  `);
  console.log('top tomadores raw:', topT.rows);

  const byCert = await client.query(`
    select d.certificate_id, c.filename, c.cnpj as cert_cnpj,
           count(*)::int as n,
           sum(d.valor_servico)::numeric as total
    from xml_nfse.documents d
    left join xml_nfse.certificates c on c.id = d.certificate_id
    where d.environment = 'producao' and d.tipo <> 'EVENTO' and not d.is_cancelled
    group by 1, 2, 3
    order by total desc nulls last
  `);
  console.log('by certificate:', byCert.rows);

  const outliers = await client.query(`
    select prestador_cnpj, prestador_nome, valor_servico, nsu, data_emissao,
           left(chave, 20) as chave, metadata->>'valorServicos' as meta_valor
    from xml_nfse.documents
    where environment = 'producao' and tipo <> 'EVENTO' and not is_cancelled
      and valor_servico > 100000
    order by valor_servico desc
    limit 25
  `);
  console.log('outliers >100k:', outliers.rows);

  const sampleMeta = await client.query(`
    select valor_servico, metadata
    from xml_nfse.documents
    where environment = 'producao' and tipo <> 'EVENTO' and not is_cancelled
      and valor_servico > 1000000
    order by valor_servico desc
    limit 3
  `);
  console.log('sample meta:', JSON.stringify(sampleMeta.rows, null, 2).slice(0, 3000));

  // How is valor stored - cents vs reais?
  const dist = await client.query(`
    select
      count(*) filter (where valor_servico < 100)::int as lt100,
      count(*) filter (where valor_servico between 100 and 1000)::int as b100_1k,
      count(*) filter (where valor_servico between 1000 and 10000)::int as b1k_10k,
      count(*) filter (where valor_servico between 10000 and 100000)::int as b10k_100k,
      count(*) filter (where valor_servico > 100000)::int as gt100k,
      count(*) filter (where valor_servico > 1000000)::int as gt1m,
      max(valor_servico)::numeric as maxv,
      avg(valor_servico)::numeric as avgv
    from xml_nfse.documents
    where environment = 'producao' and tipo <> 'EVENTO' and not is_cancelled
  `);
  console.log('value distribution:', dist.rows[0]);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
