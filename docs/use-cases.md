# Casos de Uso

Fonte: Memorial Técnico. O status de cada caso de uso é mantido pela skill `use-cases-burndown`.

**Status possíveis:** `Pendente` · `Aguardando Validação` · `Finalizado` (somente após aprovação explícita do usuário).

## Burndown

| Código | Caso de uso | Atores | Status |
|--------|-------------|--------|--------|
| UC01 | Efetuar Autenticação (Login e Logout) | Solicitante, Atendente | Finalizado |
| UC02 | Registrar Nova Solicitação | Solicitante | Finalizado |
| UC03 | Editar Solicitação | Solicitante | Finalizado |
| UC04 | Excluir Solicitação | Solicitante | Finalizado |
| UC05 | Listar, Filtrar e Consultar Solicitações | Solicitante, Atendente | Aguardando Validação |
| UC06 | Alterar Status da Solicitação | Atendente | Aguardando Validação |
| UC07 | Visualizar Dashboard | Solicitante, Atendente | Aguardando Validação |
| UC08 | Comunicação no Chamado (Comentários) | Solicitante, Atendente | Aguardando Validação |

**Resumo:** 0 Pendentes · 4 Aguardando Validação · 4 Finalizados

## Detalhamento

### UC01 - Efetuar Autenticação (Login e Logout)
- **Atores:** Solicitante e Atendente.
- **Descrição:** O usuário informa usuário e senha para acessar o sistema, sendo estabelecido o controle de sessão. Também pode encerrar a sessão (logout).
- **Regras de negócio:** Apenas usuários autenticados entram em qualquer área do sistema.
- **Decisão técnica:** JWT com expiração de 1h + bcrypt; logout descarta o token no cliente.

### UC02 - Registrar Nova Solicitação
- **Atores:** Solicitante. O Atendente não abre solicitações, apenas atende.
- **Descrição:** Preenche Título, Descrição e seleciona a Categoria (TI, RH, Compras, Financeiro, Infraestrutura).
- **Regras de negócio:** O sistema preenche a data de criação, vincula o usuário solicitante e define o status inicial estritamente como "Aberto".
- **Decisão técnica:** grava também a linha inicial `null → ABERTO` em `historico_solicitacoes`. Categoria com `ativa=false` não pode ser escolhida.
- **Nota de ajuste:** após a primeira aprovação, o ator foi restringido a Solicitante (Atendente não abre chamados); reaprovado em seguida.

### UC03 - Editar Solicitação
- **Atores:** Solicitante.
- **Descrição:** Altera título, descrição ou categoria de um pedido que abriu.
- **Regras de negócio:** Só é permitido se a solicitação for do próprio usuário **e** o status ainda for "Aberto".

### UC04 - Excluir Solicitação
- **Atores:** Solicitante.
- **Descrição:** Remove um pedido feito por engano.
- **Regras de negócio:** Só é permitido se a solicitação for do próprio usuário **e** o status ainda for "Aberto".
- **Decisão técnica:** o histórico é removido em cascata (`ON DELETE CASCADE`).

### UC05 - Listar, Filtrar e Consultar Solicitações
- **Atores:** Solicitante e Atendente.
- **Descrição:** Listagem com código, título, categoria, solicitante, data de abertura e status. Filtros por período, categoria, status e texto livre (título). Ao clicar num registro, exibe os detalhes completos.
- **Regras de negócio:** O Solicitante vê apenas as suas próprias solicitações; o Atendente vê as de todos os usuários.
- **Filtro de atendente (3 opções):** "apenas os meus atendimentos" (`atendente=meus`, resolvido pelo token e exclusivo do atendente), "todos" (`todos`, sem filtro, inclui os chamados dos colegas) e "sem atendente" (`sem`, chamados que ninguém assumiu). "Atendente" é quem moveu o chamado para Em Atendimento. Roda no servidor, junto da paginação.
- **Nota de ajuste:** o filtro de atendente com 3 opções foi acrescentado após a aprovação; o UC voltou para validação.

### UC06 - Alterar Status da Solicitação
- **Atores:** Atendente.
- **Descrição:** Avança o fluxo do chamado: "Aberto" → "Em Atendimento" → "Concluído".
- **Regras de negócio:** Exclusivo do perfil Atendente. **Bloqueio de concorrência:** quem assume o chamado ("Aberto" → "Em Atendimento") passa a ser o responsável, e só ele pode alterar o status dali em diante (concluir). Qualquer atendente pode assumir um chamado aberto, mas o primeiro a chegar vence. Comentar num chamado aberto também assume o chamado (veja o UC08).
- **Decisão técnica:** transições estritamente sequenciais; cada mudança gera registro em `historico_solicitacoes` (status anterior, novo, autor, data). O responsável é derivado do histórico (autor da transição para Em Atendimento), sem coluna nova. A condição vai na própria escrita (`UPDATE ... WHERE`), então duas assunções simultâneas nunca geram dois responsáveis. Outro atendente que tente alterar recebe 403; quem perde a corrida pela assunção recebe 409.
- **Nota de ajuste:** o bloqueio de concorrência foi acrescentado após a aprovação; o UC voltou para validação. Limitação conhecida: não há como liberar ou transferir um chamado se o responsável estiver ausente.

### UC07 - Visualizar Dashboard
- **Atores:** Solicitante e Atendente.
- **Descrição:** Painel com indicadores simples de operação: quantidade total de solicitações e quantidade de abertas, em atendimento e concluídas, com divisão por setor (categoria) e evolução no tempo. Períodos rápidos (Tudo, 30 dias, 7 dias) e filtro por datas.
- **Regras de negócio:** O Solicitante vê apenas os números das suas próprias solicitações; o Atendente vê o total global, ou apenas o que ele assumiu (filtro pessoal). Tudo o que aparece respeita o período e o setor escolhidos.
- **Decisão técnica:** `GET /dashboard` devolve agregados calculados no banco (um SQL por bloco, índices em `solicitacoes(usuario_id, data_criacao)` e `historico_solicitacoes(status_novo, solicitacao_codigo)`), séries já preenchidas com zeros e `ETag`/304 para revalidar barato. Contrato em [`api.md`](api.md).
- **Nota de ajuste:** o Memorial previa o dashboard só para o Atendente; o acesso do Solicitante (às próprias solicitações) foi incluído a pedido do usuário.

### UC08 - Comunicação no Chamado (Comentários)
- **Atores:** Solicitante e Atendente.
- **Descrição:** Conversa dentro do chamado entre o solicitante e o atendente responsável (por exemplo, o atendente pede mais informações e o solicitante responde). Os comentários aparecem em ordem cronológica no detalhe do chamado.
- **Regras de negócio:** Só o **solicitante dono** e o **atendente responsável** escrevem; outro solicitante não vê nem escreve, e outro atendente só lê. **Comentar num chamado "Aberto" assume o chamado** (vira "Em Atendimento" e o atendente é o responsável, com a mesma trava de concorrência do UC06: o primeiro vence, o outro recebe 409). Chamado "Concluído" fica somente leitura. O autor pode editar (com marca de "editado") e excluir o próprio comentário. **Auditoria:** a exclusão é lógica (quem e quando) e cada edição guarda o texto anterior; essa trilha é interna e não aparece na API nem no front.
- **Decisão técnica:** tabela `comentarios` (1:N com a solicitação e com o usuário, `ON DELETE CASCADE` na solicitação; colunas `excluido_em`/`excluido_por_id` para a exclusão lógica) e `comentarios_revisoes` (uma linha por edição, com o texto anterior e quem editou), rotas aninhadas `/solicitacoes/:codigo/comentarios`. Atualização da tela por polling com o cursor `proxComentario` (só traz os novos) e `ETag`/304; sem tempo real. A escrita da assunção é a mesma do UC06 (`gravarTransicao`, `UPDATE ... WHERE` condicional dentro da transação do comentário). Contrato em [`api.md`](api.md).
- **Fora de escopo:** notificações, anexos, menções e indicador de "não lidos".
