# Casos de Uso

Fonte: Memorial Técnico. O status de cada caso de uso é mantido pela skill `use-cases-burndown`. Este documento descreve a **versão final** implementada; o contrato da API está em [`api.md`](api.md) e o modelo de dados em [`dicionario-de-dados.md`](dicionario-de-dados.md).

**Status possíveis:** `Pendente` · `Aguardando Validação` · `Finalizado` (somente após aprovação explícita do usuário).

## Burndown

| Código | Caso de uso | Atores | Status |
|--------|-------------|--------|--------|
| UC01 | Efetuar Autenticação (Login e Logout) | Solicitante, Atendente | Finalizado |
| UC02 | Registrar Nova Solicitação | Solicitante | Finalizado |
| UC03 | Editar Solicitação | Solicitante | Finalizado |
| UC04 | Excluir Solicitação | Solicitante | Finalizado |
| UC05 | Listar, Filtrar e Consultar Solicitações | Solicitante, Atendente | Finalizado |
| UC06 | Alterar Status da Solicitação | Atendente | Finalizado |
| UC07 | Visualizar Dashboard | Solicitante, Atendente | Finalizado |
| UC08 | Comunicação no Chamado (Comentários) | Solicitante, Atendente | Finalizado |

**Resumo:** 0 Pendentes · 4 Aguardando Validação · 4 Finalizados

## Detalhamento

### UC01 - Efetuar Autenticação (Login e Logout)
- **Atores:** Solicitante e Atendente.
- **Descrição:** O usuário informa usuário e senha para acessar o sistema, sendo estabelecido o controle de sessão. Também pode encerrar a sessão (logout).
- **Regras de negócio:** Apenas usuários autenticados entram em qualquer área do sistema: todas as rotas exigem token, exceto o login. A mensagem de erro do login é a mesma para usuário inexistente e senha incorreta.
- **Decisão técnica:** JWT com expiração de 1h + bcrypt. A sessão é stateless: o logout (`POST /auth/logout`, 204) apenas faz o cliente descartar o token, que continua válido até expirar. Quando o token expira (401), o front limpa a sessão e volta ao login. Não há cadastro de usuários: eles vêm do seed.

### UC02 - Registrar Nova Solicitação
- **Atores:** Solicitante. O Atendente não abre solicitações, apenas atende.
- **Descrição:** Preenche Título, Descrição e seleciona a Categoria (TI, RH, Compras, Financeiro, Infraestrutura).
- **Regras de negócio:** O sistema preenche a data de criação, vincula o usuário solicitante e define o status inicial estritamente como "Aberto". Título de 1 a 255 caracteres e descrição de 1 a 3.500, sem espaços nas pontas; texto vazio ou só com espaços é recusado.
- **Decisão técnica:** grava também a linha inicial `null → ABERTO` em `historico_solicitacoes`, na mesma transação. Categoria com `ativa=false` não pode ser escolhida. As entradas passam por validação central (tamanho, caractere nulo, ids dentro do limite do banco): valor inválido é sempre 400, nunca 500.

### UC03 - Editar Solicitação
- **Atores:** Solicitante.
- **Descrição:** Altera título, descrição ou categoria de um pedido que abriu. Envia-se só o que mudou.
- **Regras de negócio:** Só é permitido se a solicitação for do próprio usuário **e** o status ainda for "Aberto". Valem os mesmos limites do UC02.

### UC04 - Excluir Solicitação
- **Atores:** Solicitante.
- **Descrição:** Remove um pedido feito por engano.
- **Regras de negócio:** Só é permitido se a solicitação for do próprio usuário **e** o status ainda for "Aberto". O front pede confirmação antes de excluir.
- **Decisão técnica:** o histórico, os comentários e as revisões dos comentários são removidos em cascata (`ON DELETE CASCADE`). Consequência: a trilha de auditoria dos comentários não sobrevive à exclusão do chamado inteiro.

### UC05 - Listar, Filtrar e Consultar Solicitações
- **Atores:** Solicitante e Atendente.
- **Descrição:** Listagem com código, título, categoria, solicitante, atendente, data de abertura, última atualização e status, paginada. Filtros por período, categoria, status (um ou vários), atendente e texto livre (título, nome ou usuário do solicitante e código), com busca enquanto o usuário digita. Ao clicar num registro, exibe os detalhes completos: descrição, histórico de transições, atendente responsável e a conversa do chamado (UC08).
- **Regras de negócio:** O Solicitante vê apenas as suas próprias solicitações; o Atendente vê as de todos os usuários. Todos os filtros e a paginação (`pagina`, `tamanho` de 1 a 100) rodam no servidor, e a resposta traz o total e o número de páginas.
- **Filtro de atendente (3 opções):** "apenas os meus atendimentos" (`atendente=meus`, resolvido pelo token e exclusivo do atendente), "todos" (`todos`, sem filtro, inclui os chamados dos colegas) e "sem atendente" (`sem`, chamados que ninguém assumiu). "Atendente" é quem moveu o chamado para Em Atendimento.
- **Decisão técnica:** a busca livre escapa os curingas do `LIKE` (`%`, `_` e `\` valem como texto). A listagem responde com `ETag` e `Cache-Control: private, no-cache`, então a revalidação devolve 304 sem corpo quando nada mudou. Os filtros ativos podem vir pela URL (por exemplo, a partir de um indicador do dashboard).

### UC06 - Alterar Status da Solicitação
- **Atores:** Atendente.
- **Descrição:** Avança o fluxo do chamado: "Aberto" → "Em Atendimento" → "Concluído". Na tela, o atendente escolhe o novo status e salva.
- **Regras de negócio:** Exclusivo do perfil Atendente. **Bloqueio de concorrência:** quem assume o chamado ("Aberto" → "Em Atendimento") passa a ser o responsável, e só ele pode alterar o status dali em diante (concluir). Qualquer atendente pode assumir um chamado aberto, mas o primeiro a chegar vence. Comentar num chamado aberto também assume o chamado (veja o UC08). Um chamado concluído não muda mais.
- **Decisão técnica:** transições estritamente sequenciais; cada mudança gera registro em `historico_solicitacoes` (status anterior, novo, autor, data). O responsável é derivado do histórico (autor da transição para Em Atendimento), sem coluna nova. A condição vai na própria escrita (`UPDATE ... WHERE`), dentro de uma transação junto com o registro do histórico, então duas assunções simultâneas nunca geram dois responsáveis. Outro atendente que tente alterar recebe 403; quem perde a corrida pela assunção recebe 409.
- **Limitação conhecida:** não há como liberar ou transferir um chamado se o responsável estiver ausente.

### UC07 - Visualizar Dashboard
- **Atores:** Solicitante e Atendente.
- **Descrição:** Painel com indicadores simples de operação: quantidade total de solicitações e quantidade de abertas, em atendimento e concluídas, com divisão por setor (categoria) e evolução no tempo, em gráficos. Períodos rápidos (Tudo, 30 dias, 7 dias) e filtro por datas e por setor. Os indicadores levam à listagem já filtrada.
- **Regras de negócio:** O Solicitante vê apenas os números das suas próprias solicitações; o Atendente vê o total global, ou apenas o que ele assumiu (escopo pessoal). Tudo o que aparece respeita o período e o setor escolhidos.
- **Decisão técnica:** `GET /dashboard` devolve agregados calculados no banco (um SQL por bloco, com valores sempre parametrizados e índices em `solicitacoes(usuario_id, data_criacao)` e `historico_solicitacoes(status_novo, solicitacao_codigo)`), séries já preenchidas com zeros, agrupamento automático (dia, semana ou mês), fuso horário configurável e `ETag`/304 para revalidar barato. No front os dados ficam em cache e são atualizados a cada 60 s com a aba em uso.

### UC08 - Comunicação no Chamado (Comentários)
- **Atores:** Solicitante e Atendente.
- **Descrição:** Conversa dentro do chamado entre o solicitante e o atendente responsável (por exemplo, o atendente pede mais informações e o solicitante responde). Os comentários aparecem em ordem cronológica no detalhe do chamado, de 1 a 2.000 caracteres.
- **Regras de negócio:** Só o **solicitante dono** e o **atendente responsável** escrevem; outro solicitante não vê nem escreve, e outro atendente só lê. **Comentar num chamado "Aberto" assume o chamado** (vira "Em Atendimento" e o atendente é o responsável, com a mesma trava de concorrência do UC06: o primeiro vence, o outro recebe 409). Chamado "Concluído" fica somente leitura. O autor pode editar (com marca de "editado") e excluir o próprio comentário. **Auditoria:** a exclusão é lógica (quem e quando) e cada edição guarda o texto anterior; essa trilha é interna e não aparece na API nem no front.
- **Decisão técnica:** tabela `comentarios` (1:N com a solicitação e com o usuário, `ON DELETE CASCADE` na solicitação; colunas `excluido_em`/`excluido_por_id` para a exclusão lógica) e `comentarios_revisoes` (uma linha por edição, com o texto anterior e quem editou), rotas aninhadas `/solicitacoes/:codigo/comentarios`. Sem tempo real: o front carrega a conversa inteira e, a cada 15 s com a aba visível, pede só os novos pelo cursor `proxComentario`, com `ETag`/304. A escrita da assunção é a mesma do UC06 (`gravarTransicao`, dentro da transação do comentário). O detalhe do chamado traz `totalComentarios`.
- **Fora de escopo:** notificações, anexos, menções e indicador de "não lidos".

## Regras transversais

- **Autenticação global:** toda rota exige token, exceto o login; as regras por perfil e por dono do chamado são aplicadas no servidor, e o front apenas adapta a interface.
- **Validação de entrada:** textos são aparados e limitados, o caractere nulo é recusado e os ids ficam dentro do limite do banco; valor inválido é 400.
- **Execução:** `docker compose up --build` sobe banco, API e front, aplica as migrations e carrega os dados iniciais e, opcionalmente, os de demonstração (veja o README).

## Diferenças em relação ao Memorial Técnico

| Ponto | Memorial | Versão final |
|---|---|---|
| UC02 | O Atendente poderia, opcionalmente, abrir chamados | Só o Solicitante abre; o Atendente apenas atende |
| UC05 | Filtros por período, categoria, status e título | Busca livre também por solicitante e código, vários status, filtro de atendente e paginação no servidor |
| UC06 | Apenas muda o status | Bloqueio de concorrência: quem assume é o único que conclui |
| UC07 | Acesso só do Atendente | O Solicitante também acessa, apenas às próprias solicitações; o Atendente pode ver só o que assumiu |
| UC08 | Não previsto | Comunicação no chamado, com auditoria interna |
