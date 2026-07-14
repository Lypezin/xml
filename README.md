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

O projeto suporta deploy na Vercel usando Node Functions. Em producao, os certificados A1 enviados pela interface sao criptografados no backend e salvos no Supabase. A chave de criptografia fica somente nas variaveis da Vercel.

Configure estas variaveis na Vercel:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_APP_SECRET
CERT_ENCRYPTION_KEY
AUTH_ALLOWED_EMAILS
AUTH_ALLOWED_DOMAINS
```

Use o valor local salvo em:

```text
config/cert-encryption-key.txt
```

Depois do deploy, o usuario pode enviar varios certificados pela propria interface, selecionar qual certificado usar e remover certificados cadastrados.

O login usa Supabase Auth. Crie os usuarios da empresa no painel do Supabase Auth e limite o acesso com `AUTH_ALLOWED_EMAILS` ou `AUTH_ALLOWED_DOMAINS`.

Exemplos:

```text
AUTH_ALLOWED_EMAILS=ana@suaempresa.com.br,joao@suaempresa.com.br
AUTH_ALLOWED_DOMAINS=suaempresa.com.br
```

Não deixe `AUTH_ALLOWED_EMAILS` e `AUTH_ALLOWED_DOMAINS` vazios em producao se o projeto Supabase tiver usuarios externos.

Os XMLs consultados sao gravados temporariamente no Supabase por ate 12 horas para permitir download individual ou ZIP em ambiente serverless.

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

Em producao, o acesso falha de forma segura quando nao existe allowlist nem a claim `app_metadata.xml_nfse_role`. Em um Supabase compartilhado, mantenha `AUTH_ALLOW_ALL_SUPABASE_USERS=false`. Os perfis suportados sao `admin`, `operator` e `viewer`.

O endpoint de cron aceita `SCHEDULER_SECRET` somente no header `Authorization: Bearer ...`; nunca envie segredos na URL. A verificacao TLS da ADN fica ativa por padrao com `NFSE_TLS_REJECT_UNAUTHORIZED=true`.

Os metadados e payloads XML sao persistidos no schema `xml_nfse`. Defina uma politica fiscal de retencao antes de remover ou arquivar payloads historicos; nao execute limpeza destrutiva apenas para reduzir volume.

## Banco e migrations

As migrations incrementais ficam em `supabase/migrations/`. A migration `20260714020000_xml_nfse_security_limits.sql` remove RPCs antigas sem limite, restringe a leitura de payloads a 100 tokens por chamada e protege `document_stats` com RLS.

Antes de aplicar `supabase_xml_nfse_schema.sql` em um projeto novo, substitua `REPLACE_WITH_SHA256_OF_SUPABASE_APP_SECRET` pelo SHA-256 de um segredo aleatorio forte. O hash real do ambiente nao deve ser versionado.

## Documentacao oficial

- Portal tecnico: https://www.gov.br/nfse/pt-br/nfs-e-via/documentacao-tecnica
- Ambientes e Swagger: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
- Manual de APIs ADN para contribuintes: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf
