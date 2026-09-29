---
name: use-cases-burndown
description: Atualiza o status dos casos de uso (UC01–UC07) em docs/use-cases.md durante o desenvolvimento, usando os status Pendente, Aguardando Validação e Finalizado. Use sempre que terminar de implementar um caso de uso, quando o usuário validar/aprovar ou reprovar um, ou quando pedir o andamento/burndown dos casos de uso.
---

# use-cases-burndown

Mantém o burndown dos casos de uso em `docs/use-cases.md` (tabela "Burndown" e linha "Resumo").

## Critérios de status (seguir rigorosamente)

- **Pendente:** o caso de uso ainda não foi implementado.
- **Aguardando Validação:** o código foi desenvolvido, mas aguarda conferência e teste do usuário.
- **Finalizado:** somente após validação e **aprovação explícita** do usuário.

## Regras

1. Ao concluir a implementação de um UC, marque-o como **Aguardando Validação** e avise o usuário como testá-lo. Nunca marque **Finalizado** por conta própria, nem por inferência (testes passando, build ok, "parece certo").
2. Só mude para **Finalizado** quando o usuário disser explicitamente, no chat, que validou/aprovou aquele UC (ex.: "UC03 aprovado"). Aprovação de um UC não vale para os outros.
3. Se o usuário reprovar ou pedir ajustes num UC Aguardando Validação ou Finalizado, volte-o para **Pendente** (ou mantenha Aguardando Validação se os ajustes já foram feitos na mesma conversa) e registre o motivo em uma nota curta abaixo do detalhamento do UC.
4. Um UC só vai a Aguardando Validação quando todas as suas regras de negócio listadas no detalhamento estiverem implementadas.
5. Não altere descrição, regras ou atores dos UCs; apenas status, resumo e notas de reprovação.

## Como atualizar

1. Leia `docs/use-cases.md`.
2. Edite a coluna **Status** do UC na tabela "Burndown".
3. Recalcule a linha **Resumo** (`N Pendentes · N Aguardando Validação · N Finalizados`); a soma deve ser 7.
4. Informe ao usuário, em uma linha, qual UC mudou de qual status para qual.

Quando o usuário pedir apenas o andamento, leia o arquivo e resuma sem editar.
