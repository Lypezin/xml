const fs = require('fs');
const path = require('path');
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
  const sql = fs.readFileSync(path.join(__dirname, 'fix-ranking-indicators.sql'), 'utf8');
  await client.query(sql);
  console.log('SQL applied');

  const units = await client.query(`
    select
      coalesce(nullif(trim(c.filename), ''), 'sem-cert') as name,
      count(*)::int as n,
      coalesce(sum(d.valor_servico) filter (
        where d.valor_servico > 0 and d.valor_servico <= 100000
      ), 0)::numeric as value
    from xml_nfse.documents d
    left join xml_nfse.certificates c on c.id = d.certificate_id
    where d.environment = 'producao'
      and d.tipo <> 'EVENTO'
      and not d.is_cancelled
    group by c.id, c.filename
    order by value desc
    limit 8
  `);
  console.log('unidades:', units.rows);

  const prest = await client.query(`
    select
      coalesce(nullif(max(prestador_nome), ''), prestador_cnpj) as name,
      prestador_cnpj,
      count(*) filter (where valor_servico > 0 and valor_servico <= 100000)::int as n,
      coalesce(sum(valor_servico) filter (
        where valor_servico > 0 and valor_servico <= 100000
      ), 0)::numeric as value
    from xml_nfse.documents
    where environment = 'producao'
      and tipo <> 'EVENTO'
      and not is_cancelled
      and prestador_cnpj is not null
    group by prestador_cnpj
    having coalesce(sum(valor_servico) filter (
      where valor_servico > 0 and valor_servico <= 100000
    ), 0) > 0
    order by value desc
    limit 10
  `);
  console.log('prestadores:', prest.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
