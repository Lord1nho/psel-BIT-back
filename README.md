# Portal de Solicitações Internas (back-end)

API NestJS + Prisma + PostgreSQL do portal de solicitações internas (processo seletivo BIT). O front-end está em outro repositório: [psel-BIT-front](https://github.com/Lord1nho/psel-BIT-front).

## Documentação

| Documento | Conteúdo |
|---|---|
| [Memorial Técnico](docs/Memorial%20T%C3%A9cnico.docx) | Arquitetura, decisões técnicas e análise crítica |
| [Casos de uso](docs/use-cases.md) | UC01 a UC08, regras de negócio e andamento |
| [Contrato da API](docs/api.md) | Rotas, payloads, erros e permissões por perfil |
| [Dicionário de dados](docs/dicionario-de-dados.md) | Tabelas, colunas, índices, relacionamentos e enums |

## Como executar (Docker)

Pré-requisito: Docker com Compose. Nada mais (sem Node, sem Postgres, sem `.env`).

```bash
git clone https://github.com/Lord1nho/psel-BIT-back.git
cd psel-BIT-back
docker compose up --build
```

A primeira subida baixa o front do GitHub, compila as imagens, aplica as migrations, cria os usuários de teste e **150 chamados de demonstração** (só se a tabela estiver vazia). Quando os três serviços estiverem `healthy`:

| O quê | Endereço |
|---|---|
| Front | http://localhost:5173 |
| API | http://localhost:3000 |

Usuários de teste (senha `123456`): `solicitante.um`, `solicitante.dois`, `atendente.um`, `atendente.dois`.

Comandos úteis:

```bash
docker compose down        # para tudo, mantém os dados
docker compose down -v     # para tudo e apaga o banco (a próxima subida recria do zero)
```

Configuração opcional (variáveis de ambiente ou `.env`; os padrões já funcionam):

| Variável | Padrão | Observação |
|---|---|---|
| `FRONT_PORT` / `API_PORT` | `5173` / `3000` | O front grava a URL da API no build: mudou `API_PORT`, rode `up --build` de novo. |
| `SEED_DEMO` | `true` | `false` sobe só com usuários e categorias, sem chamados. |
| `FRONT_CONTEXT` | repositório do front no GitHub | Aponte para uma cópia local, ex.: `../psel-BIT-front`. |
| `JWT_SECRET`, `SEED_PASSWORD` | valores de desenvolvimento | Apenas para execução local/avaliação. |

Desenvolvimento no host (só o banco no Docker, porta 5433):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
cp .env.example .env && npx prisma migrate dev && npx prisma db seed && npm run start:dev
```
