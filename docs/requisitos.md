# Requisitos

Este documento reúne os requisitos do mini-projeto (especificação da 2ª etapa do processo seletivo, "Portal de Solicitações Internas") e mostra **como cada um ficou na versão final**, com a referência ao caso de uso e à documentação correspondente. Os casos de uso estão em [`use-cases.md`](use-cases.md), o contrato da API em [`api.md`](api.md) e o modelo de dados em [`dicionario-de-dados.md`](dicionario-de-dados.md).

**Legenda:** ✅ atendido · ➕ atendido e ampliado além do pedido · ⚠️ atendido em parte · ❌ não implementado.

## 1. Escopo

Um Portal de Solicitações Internas em que colaboradores registram demandas internas e acompanham sua evolução até a conclusão. A solução tem back-end (API), front-end (SPA) e persistência em banco de dados SQL (PostgreSQL).

Perfis de usuário:

| Perfil | O que faz |
|---|---|
| **Solicitante** | Abre solicitações, edita e exclui as próprias (enquanto abertas), acompanha o andamento e conversa no chamado. |
| **Atendente** | Vê todas as solicitações, assume e conclui chamados, comenta como responsável e acompanha o dashboard. Não abre chamados. |

## 2. Requisitos funcionais

### RF01. Autenticação ([UC01](use-cases.md#uc01---efetuar-autenticação-login-e-logout))

| Requisito | Situação | Como ficou |
|---|---|---|
| Login com usuário e senha | ✅ | `POST /auth/login`. Senhas guardadas como hash bcrypt; erro único para usuário inexistente e senha incorreta. |
| Controle de sessão | ✅ | JWT com validade de 1 hora, enviado em todas as requisições (sessão sem estado no servidor). |
| Logout | ✅ | `POST /auth/logout`; o cliente descarta o token. |
| Apenas usuários autenticados acessam o sistema | ➕ | Todas as rotas exigem token, exceto o login (negação por padrão). No front, qualquer tela sem sessão mostra o login. |

### RF02. Cadastro de solicitações ([UC02](use-cases.md#uc02---registrar-nova-solicitação), [UC03](use-cases.md#uc03---editar-solicitação), [UC04](use-cases.md#uc04---excluir-solicitação))

| Requisito | Situação | Como ficou |
|---|---|---|
| Campos título, descrição e categoria | ✅ | Título de 1 a 255 caracteres e descrição de 1 a 3.500, sem espaços nas pontas. |
| Categorias sugeridas (TI, RH, Compras, Financeiro, Infraestrutura) | ✅ | Carregadas pelo seed. Categoria inativa não pode ser escolhida. |
| Campos automáticos: data de criação, usuário solicitante e status "Aberto" | ✅ | Preenchidos pelo servidor a partir do token; o cliente não os envia. Grava também a linha inicial do histórico. |
| Criar solicitação | ✅ | `POST /solicitacoes`, exclusivo do Solicitante. |
| Editar solicitação aberta | ✅ | `PATCH /solicitacoes/:codigo`, só pelo dono e só em "Aberto". |
| Excluir solicitação aberta | ✅ | `DELETE /solicitacoes/:codigo`, só pelo dono e só em "Aberto", com confirmação no front. Histórico e comentários saem em cascata. |

### RF03. Gerenciamento das solicitações ([UC05](use-cases.md#uc05---listar-filtrar-e-consultar-solicitações), [UC06](use-cases.md#uc06---alterar-status-da-solicitação))

| Requisito | Situação | Como ficou |
|---|---|---|
| Listagem com código, título, categoria, solicitante, data de abertura e status | ➕ | Inclui também o atendente responsável e a última atualização; paginada no servidor. |
| Status: Aberto, Em Atendimento e Concluído | ✅ | Enumerado no banco (`ABERTO`, `EM_ATENDIMENTO`, `CONCLUIDO`); "Em Atendimento" é só o rótulo de exibição. |
| Alterar status | ➕ | Exclusivo do Atendente, em sequência estrita (Aberto, Em Atendimento, Concluído), com registro no histórico. Quem assume o chamado é o único que o conclui, e duas assunções simultâneas nunca geram dois responsáveis. |
| Consultar detalhes | ✅ | `GET /solicitacoes/:codigo`: descrição, histórico de transições, responsável e conversa do chamado. |
| O Solicitante vê só as próprias solicitações; o Atendente vê todas | ✅ | Escopo definido pelo token no servidor. |

### RF04. Consulta e filtros ([UC05](use-cases.md#uc05---listar-filtrar-e-consultar-solicitações))

| Requisito | Situação | Como ficou |
|---|---|---|
| Pesquisa por período | ✅ | `dataInicio` e `dataFim`. |
| Pesquisa por categoria | ✅ | `categoriaId`. |
| Pesquisa por status | ➕ | Um ou vários status ao mesmo tempo. |
| Pesquisa por texto livre (título) | ➕ | Busca no título, no nome ou usuário do solicitante e no código, enquanto o usuário digita. Os curingas do `LIKE` são tratados como texto. |
| (Além do pedido) Filtro de atendente | ➕ | "Meus atendimentos", "todos" e "sem atendente". |

Todos os filtros e a paginação rodam no servidor.

### RF05. Dashboard ([UC07](use-cases.md#uc07---visualizar-dashboard))

| Requisito | Situação | Como ficou |
|---|---|---|
| Quantidade total de solicitações | ✅ | Indicador no topo do painel. |
| Solicitações abertas, em atendimento e concluídas | ✅ | Indicadores por status. |
| (Além do pedido) Divisão por setor e evolução no tempo | ➕ | Gráficos de pizza, barras e área, com períodos (Tudo, 30 dias, 7 dias), filtro por datas e por setor. |
| (Além do pedido) Escopo por perfil | ➕ | O Solicitante vê as próprias; o Atendente vê o geral ou só o que assumiu. |

## 3. Requisitos técnicos

A especificação deixa a stack livre e avalia a capacidade de estruturar a aplicação, modelar os dados, desenvolver APIs consistentes, implementar interfaces utilizáveis, aplicar boas práticas, justificar decisões e documentar.

| Área | Requisito | Situação | Como ficou |
|---|---|---|---|
| Back-end | API para acesso aos dados | ✅ | API REST em NestJS (TypeScript), documentada em [`api.md`](api.md). |
| Back-end | Persistência das informações | ✅ | PostgreSQL 16, acessado pelo Prisma. |
| Back-end | Regras de negócio | ✅ | Concentradas na camada de serviço (permissões por perfil, fluxo de status, dono do chamado, concorrência). |
| Back-end | Tratamento adequado de erros e validações | ✅ | Validação central de todas as entradas (tamanho, tipo, caractere nulo, ids); códigos 400, 401, 403, 404, 409 e 413 com mensagem; valor inválido nunca vira erro 500. |
| Front-end | Interface para interação do usuário | ✅ | SPA em React, com menu, trilha de navegação e transições. |
| Front-end | Consumo da API desenvolvida | ✅ | Camada única de acesso (`http.js` e `api.js`), com token, erros padronizados e cache. |
| Front-end | Formulários e listagens previstos nos requisitos funcionais | ✅ | Login, nova solicitação, edição, listagem com filtros e paginação, detalhe, comentários e dashboard. |
| Banco de dados | Dados persistidos em banco SQL | ✅ | PostgreSQL. |
| Banco de dados | Mecanismo para criar a estrutura (scripts SQL ou equivalente) | ✅ | Migrations SQL versionadas em `prisma/migrations`, aplicadas automaticamente na subida em Docker, mais o seed dos dados iniciais. |

## 4. Requisitos de documentação e deploy

O projeto deve poder ser executado sem adaptações. Mapa dos itens exigidos para o README e para a entrega:

| Item | Situação | Onde |
|---|---|---|
| Código-fonte completo (back-end e front-end) | ✅ | Repositórios [psel-BIT-back](https://github.com/Lord1nho/psel-BIT-back) e [psel-BIT-front](https://github.com/Lord1nho/psel-BIT-front). |
| Instruções de execução | ✅ | [README](../README.md): `docker compose up --build` sobe banco, API e front. |
| Configuração (variáveis de ambiente) | ✅ | Tabela de variáveis no README; todas têm valor padrão e o arquivo `.env` é opcional. |
| Credenciais de demonstração e acesso | ✅ | Usuários de teste e endereços no README. |
| Banco: scripts de criação e dicionário de dados | ✅ | `prisma/migrations` e [`dicionario-de-dados.md`](dicionario-de-dados.md). |
| Memorial Técnico | ✅ | [Memorial Técnico](Memorial%20T%C3%A9cnico.docx). |
| Documentação da API | ✅ | [`api.md`](api.md). |

## 5. Diferenciais (não obrigatórios)

| Diferencial | Situação | Como ficou |
|---|---|---|
| Docker e Docker Compose | ✅ | Três serviços (banco, API e front), com verificações de saúde, migrations e seed automáticos. |
| Testes automatizados | ✅ | **No back-end:** 292 testes unitários (`npm test`), com o banco simulado, e 148 testes de ponta a ponta (`npm run test:e2e`), com requisições HTTP reais contra o PostgreSQL. Cobrem regras de negócio, permissões, concorrência, validações, filtros e comentários. O front-end não tem testes automatizados. |
| CI/CD | ❌ | Não há pipeline de integração contínua. |
| Responsividade | ✅ | A interface se adapta a telas menores: o menu lateral vira uma gaveta recolhível (até 960 px), as grades passam para uma coluna, os indicadores do dashboard vão de quatro para dois e para um por linha, os filtros ocupam toda a largura e a trilha de navegação se resume. |

## 6. Requisitos além do especificado

Itens incluídos na versão final que não constavam na especificação:

| Item | Descrição | Referência |
|---|---|---|
| Comunicação no chamado | Comentários entre o solicitante dono e o atendente responsável, com edição, exclusão e auditoria interna (exclusão lógica e histórico de edições). | [UC08](use-cases.md#uc08---comunicação-no-chamado-comentários) |
| Trava de concorrência | Quem assume o chamado é o responsável e o único que o conclui; assunções simultâneas são resolvidas na escrita, no banco. | [UC06](use-cases.md#uc06---alterar-status-da-solicitação) |
| Dashboard para o Solicitante | O Solicitante também acessa o painel, restrito às próprias solicitações. | [UC07](use-cases.md#uc07---visualizar-dashboard) |
| Paginação e filtros no servidor | Listagem paginada com filtros combináveis e cache por `ETag`. | [UC05](use-cases.md#uc05---listar-filtrar-e-consultar-solicitações) |
| Validação central de entradas | Limites de tamanho, caractere nulo e ids dentro do limite do banco, com resposta 400. | [`api.md`](api.md) |
| Execução com um comando | Docker Compose com migrations, seed e dados de demonstração opcionais. | [README](../README.md) |

As diferenças em relação ao texto original do Memorial estão na seção "Diferenças em relação ao Memorial Técnico" de [`use-cases.md`](use-cases.md).
