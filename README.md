# XML Sigma

Ferramenta local em Node.js para consultar XMLs de NFS-e Nacional em lote via API ADN por NSU, usando certificado A1 com mTLS.

## Recursos

- Consulta em lote por NSU na API nacional de contribuintes.
- Suporte a multiplos certificados A1 `.pfx`/`.p12`.
- Selecao de certificado ativo.
- Busca crescente ou reversa por NSU.
- Tabela de metadados das NFS-e consultadas.
- Download individual de XML somente ao clicar em `XML`.
- Download ZIP somente ao clicar em `Baixar Pacote ZIP`.
- Integracao opcional com Supabase para persistir estado da varredura, execucoes e metadados.

## Como rodar

```bash
npm install
npm start
```

Acesse:

```text
http://localhost:3000
```

## Supabase

O schema isolado esta em:

```text
supabase_xml_nfse_schema.sql
```

Para habilitar a integracao local, copie:

```text
config/supabase.example.json
```

para:

```text
config/supabase.json
```

e preencha a URL, chave publishable e segredo local da aplicacao.

## Deploy na Vercel

O projeto suporta deploy na Vercel usando Node Functions. Em producao, os certificados A1 enviados pela interface sao criptografados automaticamente no backend e salvos no Supabase.

Configure estas variaveis na Vercel:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_APP_SECRET
```

Depois do deploy, o usuario pode enviar varios certificados pela propria interface, selecionar qual certificado usar e remover certificados cadastrados.

O login usa Supabase Auth. Qualquer usuario autenticado nesse projeto Supabase pode acessar e operar o sistema.

Os XMLs consultados sao gravados temporariamente no Supabase por ate 12 horas para permitir download individual ou ZIP em ambiente serverless.

### Varredura diaria

Em producao, a Vercel executa uma varredura de todos os certificados todos os dias com o cron `0 8 * * *` (08:00 UTC, 05:00 no horario de Brasilia). No plano Hobby, a execucao pode ocorrer em qualquer momento dentro da hora das 05:00.

A rotina foi dividida em sete partes, uma para cada certificado cadastrado, para respeitar o limite de duracao das Functions. Cada parte possui uma trava distribuida no Supabase, evitando execucoes duplicadas. Cada certificado usa um cursor independente por certificado, ambiente e CNPJ; a consulta sempre comeca no ultimo NSU confirmado e o banco nunca reduz um NSU ja salvo.

O `CRON_SECRET` esta configurado somente no ambiente de producao da Vercel e autentica essas rotas internas. Ele nao deve ser colocado no codigo nem exposto no navegador.

## Segurança

Nao commite certificados, senhas, XMLs baixados ou arquivos locais de configuracao. O `.gitignore` ja ignora:

- `config/supabase.json`
- `config/settings.json`
- `config/certificates.json`
- `config/certificates/`
- `downloads/`
- `*.pfx`, `*.p12`, `*.pem`, `*.key`

## Operacao empresarial

O sistema tambem exporta Excel e um Manifesto de Integridade CSV. O manifesto registra NSU, chave de acesso, status, participantes, valor, SHA-256 do XML e datas de primeiro/ultimo registro para conciliacao e cadeia de custodia.

O acesso exige apenas uma sessao valida do Supabase. A verificacao TLS da ADN permanece sempre ativa e a chave dos certificados e gerada ou derivada automaticamente.

Os metadados e payloads XML sao persistidos no schema `xml_nfse`. Defina uma politica fiscal de retencao antes de remover ou arquivar payloads historicos; nao execute limpeza destrutiva apenas para reduzir volume.

## Banco e migrations

As migrations incrementais ficam em `supabase/migrations/`. A migration `20260714020000_xml_nfse_security_limits.sql` remove RPCs antigas sem limite, restringe a leitura de payloads a 100 tokens por chamada e protege `document_stats` com RLS. A migration `20260714030000_xml_nfse_scheduler_leases.sql` cria as travas do agendador e encerra apenas registros antigos de telemetria que ficaram presos como `running`, sem alterar os cursores NSU.

Antes de aplicar `supabase_xml_nfse_schema.sql` em um projeto novo, substitua `REPLACE_WITH_SHA256_OF_SUPABASE_APP_SECRET` pelo SHA-256 de um segredo aleatorio forte. O hash real do ambiente nao deve ser versionado.

## Documentacao oficial

- Portal tecnico: https://www.gov.br/nfse/pt-br/nfs-e-via/documentacao-tecnica
- Ambientes e Swagger: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
- Manual de APIs ADN para contribuintes: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf
