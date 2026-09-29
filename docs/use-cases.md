# Casos de Uso

Fonte: Memorial Técnico. O status de cada caso de uso é mantido pela skill `use-cases-burndown`.

**Status possíveis:** `Pendente` · `Aguardando Validação` · `Finalizado` (somente após aprovação explícita do usuário).

## Burndown

| Código | Caso de uso | Atores | Status |
|--------|-------------|--------|--------|
| UC01 | Efetuar Autenticação (Login e Logout) | Solicitante, Atendente | Pendente |
| UC02 | Registrar Nova Solicitação | Solicitante (e Atendente) | Pendente |
| UC03 | Editar Solicitação | Solicitante | Pendente |
| UC04 | Excluir Solicitação | Solicitante | Pendente |
| UC05 | Listar, Filtrar e Consultar Solicitações | Solicitante, Atendente | Pendente |
| UC06 | Alterar Status da Solicitação | Atendente | Pendente |
| UC07 | Visualizar Dashboard | Atendente | Pendente |

**Resumo:** 7 Pendentes · 0 Aguardando Validação · 0 Finalizados

## Detalhamento

### UC01 - Efetuar Autenticação (Login e Logout)
- **Atores:** Solicitante e Atendente.
- **Descrição:** O usuário informa usuário e senha para acessar o sistema, sendo estabelecido o controle de sessão. Também pode encerrar a sessão (logout).
- **Regras de negócio:** Apenas usuários autenticados entram em qualquer área do sistema.
- **Decisão técnica:** JWT com expiração de 1h + bcrypt; logout descarta o token no cliente.

### UC02 - Registrar Nova Solicitação
- **Atores:** Solicitante (e opcionalmente o Atendente, caso também precise abrir chamados).
- **Descrição:** Preenche Título, Descrição e seleciona a Categoria (TI, RH, Compras, Financeiro, Infraestrutura).
- **Regras de negócio:** O sistema preenche a data de criação, vincula o usuário solicitante e define o status inicial estritamente como "Aberto".
- **Decisão técnica:** grava também a linha inicial `null → ABERTO` em `historico_solicitacoes`. Categoria com `ativa=false` não pode ser escolhida.

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

### UC06 - Alterar Status da Solicitação
- **Atores:** Atendente.
- **Descrição:** Avança o fluxo do chamado: "Aberto" → "Em Atendimento" → "Concluído".
- **Regras de negócio:** Exclusivo do perfil Atendente.
- **Decisão técnica:** transições estritamente sequenciais; cada mudança gera registro em `historico_solicitacoes` (status anterior, novo, autor, data).

### UC07 - Visualizar Dashboard
- **Atores:** Atendente.
- **Descrição:** Painel com indicadores simples de operação.
- **Regras de negócio:** Exibe o total global de solicitações e a quantidade de abertas, em atendimento e concluídas. Acesso restrito ao perfil Atendente.
