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

## Segurança

Nao commite certificados, senhas, XMLs baixados ou arquivos locais de configuracao. O `.gitignore` ja ignora:

- `config/supabase.json`
- `config/settings.json`
- `config/certificates.json`
- `config/certificates/`
- `downloads/`
- `*.pfx`, `*.p12`, `*.pem`, `*.key`
