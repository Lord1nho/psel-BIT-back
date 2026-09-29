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
docker compose up -d --wait        # sobe o Postgres
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
- Login no padrão `nome.sobrenome`. Seeds: `atendente.um` (ATENDENTE) e `solicitante.um` (SOLICITANTE), senha em `SEED_PASSWORD` (dev: 123456).
- **Não há cadastro** de usuários nem de categorias: ambos vêm só do seed. Categoria `ativa=false` não pode ser usada em novas solicitações.

## Regras de negócio essenciais
- Todas as rotas exigem autenticação, exceto login.
- Solicitante: edita/exclui só solicitações **próprias** com status `ABERTO`; lista só as próprias.
- Atendente: lista todas, altera status, vê o dashboard (total + abertas/em atendimento/concluídas). Também pode abrir chamados.
- Criar solicitação: status `ABERTO`, data e usuário automáticos, e grava histórico `null → ABERTO`.
- Status muda só em sequência `ABERTO → EM_ATENDIMENTO → CONCLUIDO`, sempre com registro em `historico_solicitacoes`.

## Estrutura
- `src/prisma/`: `PrismaService` (único acesso ao banco, injetado nos demais services) e `PrismaModule` (global).
- `prisma/`: schema, migrations, `seed.ts`.
- `docs/use-cases.md`: casos de uso e burndown.

## Fluxo de trabalho
- **Casos de uso:** o andamento fica em `docs/use-cases.md`, atualizado pela skill `use-cases-burndown`. Status: `Pendente`, `Aguardando Validação`, `Finalizado`. **Finalizado só com aprovação explícita do usuário**; ao terminar de codar, marque `Aguardando Validação`.
- **Commits:** Conventional Commits em pt-BR via skill `commits`. Só commitar quando o usuário pedir.
- Não editar nem mover o `Memorial Técnico.docx`.
