# CLAUDE.md

Backend do portal de solicitações (processo seletivo BIT). Fonte dos requisitos: `Memorial Técnico.docx` (casos de uso e DER). Idioma do projeto: português brasileiro (código de domínio, commits, docs).

## Stack
- NestJS 12 (TypeScript, ESM: imports relativos com extensão `.js`)
- Prisma 7.10.0 (CLI e client fixados na mesma versão) com `@prisma/adapter-pg`
- PostgreSQL 16 via Docker (`docker-compose.yml`), **porta 5433** (a 5432 da máquina já é ocupada por outro Postgres)
- Auth: JWT (expira em 1h) + bcrypt; logout = cliente descarta o token
- Lint: oxlint · Testes: vitest

## Comandos
```bash
docker compose up --build          # tudo (db + api + front) para execução/avaliação; ver README
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db   # só o Postgres (porta 5433), dev no host
npx prisma migrate dev             # aplica/gera migrations
npx prisma db seed                 # categorias + usuários de teste
npx prisma generate                # gera o client em src/generated (não versionado)
npm run start:dev | build | lint | test
```
Copie `.env.example` para `.env` antes de tudo.

## Banco de dados
`prisma/schema.prisma` é a **fonte da verdade**; o SQL sai das migrations. Nunca versionar `DROP` no SQL; para resetar use `prisma migrate reset`.

- Tabelas: `usuarios`, `categorias`, `solicitacoes` (PK `codigo`), `historico_solicitacoes`.
- Enums em ASCII maiúsculo, sem `@map` de valor: `StatusSolicitacao` = `ABERTO | EM_ATENDIMENTO | CONCLUIDO`; `PerfilUsuario` = `SOLICITANTE | ATENDENTE`. "Em Atendimento" é só rótulo de exibição.
- Código em camelCase, banco em snake_case (`@map` / `@@map`). Datas em `Timestamptz(6)`.
- `historico_solicitacoes` tem `ON DELETE CASCADE` na solicitação (necessário para o UC04).
- Login no padrão `nome.sobrenome`. Seeds: `atendente.um` e `atendente.dois` (ATENDENTE); `solicitante.um` e `solicitante.dois` (SOLICITANTE), senha em `SEED_PASSWORD` (dev: 123456).
- **Não há cadastro** de usuários nem de categorias: ambos vêm só do seed. Categoria `ativa=false` não pode ser usada em novas solicitações.

## Regras de negócio essenciais
- Todas as rotas exigem autenticação, exceto login.
- Solicitante: edita/exclui só solicitações **próprias** com status `ABERTO`; lista só as próprias.
- Listagem (`GET /solicitacoes`): paginada (`pagina`, `tamanho` até 100) e devolve `{ itens, total, pagina, tamanho, totalPaginas }`; `status` aceita vários valores (`ABERTO,EM_ATENDIMENTO`) e `atendente=meus|todos|sem` (ou `atendenteId`) filtra por quem assumiu o chamado (`meus` é só do atendente e resolvido pelo token). Todo filtro da listagem roda no servidor (o front não filtra sobre a página). O backend não filtra status por padrão: o front envia o padrão.
- Atendente: lista todas, altera status e vê o dashboard geral (ou só o que assumiu). **Não abre chamados**: só atende.
- Dashboard (`GET /dashboard`): solicitante e atendente. Solicitante vê só as próprias; atendente vê tudo ou `escopo=meus`. Tudo respeita o período (`tudo`/`30d`/`7d`/datas) e o setor escolhidos.
- Validação de entrada (`src/common/validacao/` e `src/common/pipes/`): textos usam `@TextoObrigatorio`/`@TextoOpcional` (aparam espaços, rejeitam vazio, tamanho acima do limite e o caractere nulo); ids usam `@IdInteiro` (1 a 2.147.483.647, o teto do `integer` do Postgres) e a rota usa `ParseIdPipe`. Limites em `limites.ts` (`descricao` 3.500, `titulo` 255). Todo valor fora disso é 400, nunca 500; a busca `q` escapa `%`, `_` e `\`. Campo novo de texto ou id deve usar esses decoradores.
- Criar solicitação: status `ABERTO`, data e usuário automáticos, e grava histórico `null → ABERTO`.
- Status muda só em sequência `ABERTO → EM_ATENDIMENTO → CONCLUIDO`, sempre com registro em `historico_solicitacoes`.
- Dono do chamado: quem assumiu (a transição para `EM_ATENDIMENTO`, derivada do histórico) é o responsável; qualquer atendente pode assumir um chamado `ABERTO` (o primeiro vence), mas só o responsável conclui (outro atendente recebe 403). A condição vai no `WHERE` da escrita, sem coluna nova.

## Estrutura
- `src/prisma/`: `PrismaService` (único acesso ao banco, injetado nos demais services) e `PrismaModule` (global).
- `src/configurar-app.ts`: `ValidationPipe` global e CORS (origens em `CORS_ORIGIN`, separadas por vírgula; vazio = nenhuma), usado por `main.ts` e pelo e2e.
- `src/auth/`, `src/categorias/` (`GET /categorias`, só ativas), `src/solicitacoes/` e `src/dashboard/`: um módulo por área, com controller fino e regra no service. O dashboard usa SQL agregado (`$queryRaw` com `Prisma.sql`, valores sempre como parâmetros) e funções puras de período em `periodo.ts`.
- `prisma/`: schema, migrations, `seed.ts`.
- `docs/use-cases.md`: casos de uso e burndown.
- `docs/api.md`: contrato da API para o front (URLs, payloads, erros). Atualize junto com qualquer mudança de endpoint.

## Fluxo de trabalho
- **Casos de uso:** o andamento fica em `docs/use-cases.md`, atualizado pela skill `use-cases-burndown`. Status: `Pendente`, `Aguardando Validação`, `Finalizado`. **Finalizado só com aprovação explícita do usuário**; ao terminar de codar, marque `Aguardando Validação`.
- **Commits:** Conventional Commits em pt-BR via skill `commits`. Só commitar quando o usuário pedir.
- Não editar nem mover o `Memorial Técnico.docx`.
