# XML NFS-e em Lote

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

O projeto suporta deploy na Vercel usando Node Functions. Em producao, o certificado A1 deve vir de variaveis de ambiente, porque o filesystem da Vercel nao deve ser usado para persistir `.pfx`.

Configure estas variaveis na Vercel:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_APP_SECRET
NFSE_CERT_PFX_BASE64
NFSE_CERT_PASSPHRASE
NFSE_CERT_CNPJ
NFSE_CERT_ID
NFSE_CERT_NAME
```

Para gerar o Base64 do certificado no PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\certificado.pfx"))
```

Na Vercel, uploads de certificado pela interface ficam desabilitados. Para trocar certificado em producao, altere as variaveis `NFSE_CERT_*` e redeploye.

Os XMLs consultados sao gravados temporariamente no Supabase por ate 12 horas para permitir download individual ou ZIP em ambiente serverless.

## Segurança

Nao commite certificados, senhas, XMLs baixados ou arquivos locais de configuracao. O `.gitignore` ja ignora:

- `config/supabase.json`
- `config/settings.json`
- `config/certificates.json`
- `config/certificates/`
- `downloads/`
- `*.pfx`, `*.p12`, `*.pem`, `*.key`
