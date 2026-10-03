# Guia da API para o front-end

Contrato da API por funcionalidade. Os casos de uso estão em [`use-cases.md`](use-cases.md).

## 1. Convenções gerais

- **Base URL:** `http://localhost:3000`, sem prefixo. A porta vem de `PORT`.
- **Formato:** JSON. Envie `Content-Type: application/json` nas requisições com corpo.
- **CORS:** liberado para as origens de `CORS_ORIGIN` (dev: `http://localhost:5173`). Outras origens são bloqueadas pelo navegador.
- **Autenticação:** todas as rotas exigem `Authorization: Bearer <accessToken>`, exceto `POST /auth/login`. O token vale 1h; depois disso qualquer rota responde 401.
- **Datas:** strings ISO em UTC (`"2026-09-30T14:22:10.123Z"`). Converta para o fuso local na tela.
- **Campos desconhecidos** no corpo ou na query dão 400. Envie só o que está documentado.
- **Enums (exatamente assim):**
  - `status`: `ABERTO`, `EM_ATENDIMENTO`, `CONCLUIDO` ("Em Atendimento" é só rótulo de exibição).
  - `perfil`: `SOLICITANTE`, `ATENDENTE`.

### Formato de erro

```json
{ "statusCode": 400, "message": ["titulo should not be empty"], "error": "Bad Request" }
```

`message` é **array de strings** nos erros de validação de corpo/query e **string** nos demais. Trate os dois casos.

| Código | Quando |
|---|---|
| 400 | Validação, categoria inexistente ou inativa, filtro malformado, `:codigo` não numérico |
| 401 | Sem token, token inválido ou expirado, login incorreto |
| 403 | Perfil sem permissão, ou solicitação de outro usuário |
| 404 | Solicitação não existe |
| 409 | Status não permite a operação, ou transição de status inválida |

### Permissões por perfil

| Ação | SOLICITANTE | ATENDENTE |
|---|---|---|
| Criar solicitação | sim | não (403) |
| Listar | só as próprias | todas |
| Consultar detalhe | só as próprias | qualquer uma |
| Editar / excluir | só as próprias em `ABERTO` | não (403) |
| Alterar status | não (403) | sim (assumir: qualquer atendente; depois, só o responsável) |
| Dashboard | sim (só as próprias) | sim (geral, ou só as que assumiu) |

Mostre editar e excluir só quando `status === 'ABERTO'` e a solicitação for do usuário; o servidor valida de qualquer forma.

### Usuários de teste (seed)

| usuario | senha | perfil |
|---|---|---|
| `solicitante.um` | `123456` | SOLICITANTE |
| `solicitante.dois` | `123456` | SOLICITANTE |
| `atendente.um` | `123456` | ATENDENTE |
| `atendente.dois` | `123456` | ATENDENTE |

## 2. Login e sessão

### `POST /auth/login` (pública)

```json
{ "usuario": "solicitante.um", "senha": "123456" }
```

**200**
```json
{
  "accessToken": "eyJhbGciOi...",
  "usuario": { "id": 2, "nome": "Solicitante Um", "usuario": "solicitante.um", "perfil": "SOLICITANTE" }
}
```

Guarde o `accessToken` e o `perfil` para montar as telas e as chamadas seguintes. Erros: **401** `"Usuário ou senha inválidos"` (mesma mensagem para usuário inexistente e senha errada); **400** se faltar campo.

### `POST /auth/logout`

Sem corpo. **204** sem conteúdo. É stateless: o servidor **não invalida** o token, então o front deve **descartá-lo** localmente. Sem token, responde 401.

### Sessão expirada

Qualquer rota que responda **401** fora do login indica token ausente ou expirado: limpe o token e leve o usuário à tela de login.

## 3. Categorias

### `GET /categorias` (qualquer perfil)

Sem parâmetros. Devolve só as categorias **ativas**, ordenadas por `id`.

**200**
```json
[ { "id": 1, "nome": "TI" }, { "id": 2, "nome": "RH" } ]
```

Use nos selects do formulário (criar/editar) e do filtro da listagem. Não deixe ids fixos no front.

## 4. Criar solicitação

### `POST /solicitacoes` (SOLICITANTE)

```json
{ "titulo": "Notebook lento", "descricao": "Trava ao abrir o Excel", "categoriaId": 1 }
```

`titulo`: texto não vazio, até 255 caracteres. `descricao`: texto não vazio. `categoriaId`: inteiro ≥ 1 de uma categoria ativa. O solicitante e a data vêm do servidor; não envie.

**201**
```json
{
  "codigo": 3, "titulo": "Notebook lento", "descricao": "Trava ao abrir o Excel",
  "categoriaId": 1, "status": "ABERTO", "dataCriacao": "2026-09-30T14:22:10.123Z",
  "usuarioId": 2, "categoria": { "id": 1, "nome": "TI", "ativa": true }
}
```

Erros: **400** validação ou `"Categoria inexistente ou inativa"`; **403** se o perfil for ATENDENTE.

## 5. Listar e filtrar

### `GET /solicitacoes` (SOLICITANTE: só as próprias · ATENDENTE: todas)

Todos os parâmetros de query são opcionais e combináveis:

| Query | Formato | Observação |
|---|---|---|
| `status` | um ou vários: `ABERTO`, `EM_ATENDIMENTO`, `CONCLUIDO` | Vários: separados por vírgula (`status=ABERTO,EM_ATENDIMENTO`) ou o parâmetro repetido (`status=ABERTO&status=EM_ATENDIMENTO`). Ausente ou vazio = todos. Repetidos são ignorados. |
| `categoriaId` | inteiro | |
| `atendente` | `meus`, `todos` ou `sem` | **As 3 opções do seletor de atendente** (veja abaixo). |
| `atendenteId` | inteiro | Um atendente específico: só os chamados que ele assumiu. **Não combina com `atendente`** (400). |
| `q` | texto, até 100 caracteres | Busca em parte do título, no nome ou usuário do solicitante e, se for só número, no código. Não diferencia maiúsculas. |
| `dataInicio` | `AAAA-MM-DD` | |
| `dataFim` | `AAAA-MM-DD` | Inclusiva. Não pode ser anterior a `dataInicio`. |
| `pagina` | inteiro ≥ 1 (até 1.000.000) | Padrão 1. |
| `tamanho` | inteiro de 1 a 100 | Itens por página. Padrão 20. |

Exemplos:
- `GET /solicitacoes?status=ABERTO,EM_ATENDIMENTO&pagina=1&tamanho=20` (tela inicial: abertos e em atendimento)
- `GET /solicitacoes?q=note&status=ABERTO&dataInicio=2026-09-01&dataFim=2026-09-30&pagina=2`
- `GET /solicitacoes?atendente=meus&status=EM_ATENDIMENTO` (meus chamados em atendimento)
- `GET /solicitacoes?atendente=sem` (chamados que ninguém assumiu ainda)

**200**: um envelope com a página pedida e os totais:
```json
{
  "itens": [
    {
      "codigo": 3, "titulo": "Notebook lento", "status": "ABERTO",
      "dataCriacao": "2026-09-30T14:22:10.123Z",
      "categoria": { "id": 1, "nome": "TI" },
      "solicitante": { "id": 2, "nome": "Solicitante Um" },
      "atendente": { "id": 1, "nome": "Atendente Um" },
      "ultimaAtualizacao": "2026-09-30T16:40:00.000Z",
      "dataConclusao": "2026-09-30T16:40:00.000Z"
    }
  ],
  "total": 153,
  "pagina": 1,
  "tamanho": 20,
  "totalPaginas": 8
}
```

| Campo | Significado |
|---|---|
| `itens` | Os chamados da página, da mais recente para a mais antiga (o código desempata datas iguais, então a ordem entre páginas é estável). Cada item tem os mesmos campos de antes. |
| `total` | Quantidade de chamados que atendem aos filtros (e ao escopo do perfil), somando todas as páginas. |
| `pagina`, `tamanho` | Os valores efetivamente usados (os padrões, se não enviados). |
| `totalPaginas` | `ceil(total / tamanho)`. É **0** quando não há resultados. |

Uma página além do fim responde **200** com `itens: []` (e o `total` correto). A última página pode trazer menos itens que `tamanho`.

> **Mudança de contrato:** antes a resposta era um array simples. Agora o array está em `itens`. Mudar de página, filtro ou busca é só pedir de novo com outros parâmetros, e volte a `pagina=1` quando um filtro mudar.

Colunas derivadas do histórico (não existem no detalhe como campos; lá use o array `historico`):

| Campo | Significado |
|---|---|
| `atendente` | Quem moveu o chamado para `EM_ATENDIMENTO` (`{ id, nome }`); `null` se ainda não foi assumido. Se outro atendente concluir depois, continua sendo quem assumiu. |
| `ultimaAtualizacao` | Horário da última **mudança de status**; igual a `dataCriacao` se nunca mudou. Editar título, descrição ou categoria **não** altera este campo. |
| `dataConclusao` | Horário em que virou `CONCLUIDO`; `null` enquanto não concluído. |

**Filtro de atendente (3 opções):**

| Opção na tela | Envie | O que volta |
|---|---|---|
| Apenas os meus atendimentos | `atendente=meus` | Os chamados que **o atendente logado** assumiu. O servidor usa o token, então não precisa mandar o id. |
| Todos | `atendente=todos` (ou não envie nada) | Sem filtro: inclui os chamados dos colegas. |
| Sem atendente | `atendente=sem` | Os chamados que ninguém assumiu (a coluna `atendente` vem `null`). |

- **"Atendente" de um chamado** é quem o moveu para `EM_ATENDIMENTO`; é o mesmo `atendente` que aparece em cada linha.
- `atendente=meus` é **exclusivo do atendente**: o solicitante recebe 400. `sem` e `todos` funcionam para ele, dentro dos próprios chamados.
- Combina com os outros filtros e com a paginação: o `total` acompanha. `sem` junto de `status=EM_ATENDIMENTO` ou `CONCLUIDO` devolve vazio, porque esses status sempre têm atendente.
- Mudou a opção, volte para `pagina=1`.
- Não filtre por atendente no front sobre a lista: com a paginação ele só enxergaria a página atual. O mesmo vale para qualquer outro filtro: use os parâmetros acima, que contam no `total`.

**Filtro padrão da tela:** o backend **não** filtra nada por padrão. Para abrir a tela mostrando só "Aberto + Em atendimento", o front envia `status=ABERTO,EM_ATENDIMENTO`; para "Todos", não envia `status`.

**Busca dinâmica:** chame esta mesma rota a cada digitação, com *debounce* de ~300 ms. Se o campo ficar vazio, **não envie `q=`** (volta à lista completa). O escopo do solicitante vale também na busca.

**Cache HTTP:** a resposta traz `Cache-Control: private, no-cache` e `ETag`. O navegador revalida a cada chamada e, se nada mudou naquela página e naquele conjunto de filtros, recebe **304** sem corpo. O dado nunca fica desatualizado, e o conteúdo é por usuário (`private`).

Erros: **400** para `status` fora do enum, `atendente` fora de `meus`/`todos`/`sem`, `atendente` junto de `atendenteId`, `atendente=meus` enviado por solicitante, `categoriaId` ou `atendenteId` inválidos (não inteiro ou menor que 1), data fora do formato, período invertido, `pagina` menor que 1 ou não inteira, `tamanho` menor que 1, maior que 100 ou não inteiro, ou parâmetro desconhecido.

## 6. Detalhe e histórico

### `GET /solicitacoes/:codigo` (SOLICITANTE: só as próprias · ATENDENTE: qualquer uma)

**200**
```json
{
  "codigo": 3, "titulo": "Notebook lento", "descricao": "Trava ao abrir o Excel",
  "categoriaId": 1, "status": "EM_ATENDIMENTO",
  "dataCriacao": "2026-09-30T14:22:10.123Z", "usuarioId": 2,
  "categoria": { "id": 1, "nome": "TI", "ativa": true },
  "solicitante": { "id": 2, "nome": "Solicitante Um", "usuario": "solicitante.um" },
  "atendente": { "id": 1, "nome": "Atendente Um" },
  "historico": [
    { "statusAnterior": null, "statusNovo": "ABERTO",
      "dataAlteracao": "2026-09-30T14:22:10.123Z", "usuario": { "id": 2, "nome": "Solicitante Um" } },
    { "statusAnterior": "ABERTO", "statusNovo": "EM_ATENDIMENTO",
      "dataAlteracao": "2026-09-30T15:01:00.000Z", "usuario": { "id": 1, "nome": "Atendente Um" } }
  ]
}
```

`atendente` é o atendente responsável (quem assumiu o chamado), ou `null` se ninguém assumiu. É com ele que o front compara o usuário logado para habilitar a mudança de status (seção 9).

O histórico vem em ordem cronológica; `statusAnterior` é `null` na primeira linha. Erros: **403** (solicitante consultando solicitação alheia), **404**.

## 7. Editar solicitação

### `PATCH /solicitacoes/:codigo` (SOLICITANTE, própria, em `ABERTO`)

Envie só o que mudou, e ao menos um campo:
```json
{ "titulo": "Novo título", "descricao": "Nova descrição", "categoriaId": 2 }
```

**200**: a solicitação atualizada, no mesmo formato do "Criar" (com `categoria`).

Erros: **400** (corpo vazio, campo não permitido como `status`, categoria inexistente ou inativa); **403** (perfil ATENDENTE ou solicitação de outro usuário); **404**; **409** `"Só é possível alterar solicitações com status ABERTO"`.

## 8. Excluir solicitação

### `DELETE /solicitacoes/:codigo` (SOLICITANTE, própria, em `ABERTO`)

Sem corpo. **204** sem conteúdo; o histórico é removido junto. Erros: **403**, **404**, **409** (mesmas causas da edição).

## 9. Alterar status

### `PATCH /solicitacoes/:codigo/status` (ATENDENTE)

```json
{ "status": "EM_ATENDIMENTO" }
```

**200**: a solicitação atualizada, no formato do "Criar", mais `atendente: { id, nome }` (o responsável) e sem o array `historico`. **Cada mudança gera uma linha no histórico.**

A sequência é estrita: `ABERTO → EM_ATENDIMENTO → CONCLUIDO`. Pular etapa, voltar, repetir ou alterar um chamado concluído dá **409**, e a `message` informa o próximo status permitido.

**Quem assumiu é o dono do chamado.** Depois que um atendente assume (`ABERTO → EM_ATENDIMENTO`), só ele pode alterar o status dali em diante:

| Situação | Quem pode | Quem tentar sem poder recebe |
|---|---|---|
| `ABERTO → EM_ATENDIMENTO` | Qualquer atendente (o primeiro a chegar assume) | Perdeu a corrida: **409** "já foi assumido por outro atendente; atualize a tela" |
| `EM_ATENDIMENTO → CONCLUIDO` | **Só o atendente responsável** | Outro atendente: **403** "Somente o atendente responsável (*Nome*) pode alterar o status deste chamado" |
| `CONCLUIDO` | Ninguém | **409** |
| Qualquer mudança | Solicitante | **403** |

Se dois atendentes clicarem em "Em atendimento" ao mesmo tempo, **só um** assume (200) e o outro recebe 409. O dono nunca muda depois disso.

**Como o front deve usar (seletor de status + salvar):**
- Para habilitar a mudança, compare `atendente.id` (da listagem ou do detalhe) com o `usuario.id` do login:
  - chamado `ABERTO` (`atendente` é `null`): habilitado para qualquer atendente, e a única opção é `EM_ATENDIMENTO`;
  - chamado `EM_ATENDIMENTO`: habilitado só se `atendente.id` for o do usuário logado, e a única opção é `CONCLUIDO`; para os demais atendentes, desabilitado (mostre quem é o responsável);
  - chamado `CONCLUIDO`: sem mudança.
- Trate o **403** (alguém assumiu antes de a tela atualizar) e o **409** (perdeu a corrida): mostre a mensagem e recarregue o chamado.

Erros: **400** (status fora do enum); **403** (perfil SOLICITANTE, ou atendente que não é o responsável); **404**; **409** (transição inválida, ou outro atendente alterou antes).

## 10. Dashboard

### `GET /dashboard` (SOLICITANTE e ATENDENTE)

Uma única rota alimenta painéis numéricos e gráficos (feita para Recharts). **Tudo na resposta obedece ao período escolhido**, e o escopo vem do token: o solicitante vê só as próprias solicitações; o atendente vê todas (ou só as que assumiu).

**Query (todos opcionais, combináveis):**

| Parâmetro | Valores | Observação |
|---|---|---|
| `periodo` | `tudo` (padrão), `30d`, `7d` | `7d`/`30d` = hoje e os 6/29 dias anteriores. `tudo` = da primeira solicitação até hoje. |
| `dataInicio`, `dataFim` | `AAAA-MM-DD` | Período personalizado, ambos inclusivos. **Não combine com `periodo`** (400). Com só um deles, o outro assume (início = primeira solicitação; fim = hoje). |
| `categoriaId` | inteiro | Filtra por setor. |
| `agrupamento` | `auto` (padrão), `dia`, `semana`, `mes` | `auto`: até 62 dias por dia; até 364 por semana; acima disso por mês. Máximo de 400 pontos na série (400 se passar). |
| `escopo` | `geral` (padrão), `meus` | **Só atendente** (solicitante recebe 400). `meus` = chamados que ele assumiu. |
| `fuso` | nome IANA, padrão `America/Sao_Paulo` | Define onde começa e termina cada dia. |

Exemplos: `GET /dashboard?periodo=7d` · `GET /dashboard?periodo=30d&categoriaId=1` · `GET /dashboard?dataInicio=2026-09-01&dataFim=2026-09-30&agrupamento=semana` · `GET /dashboard?escopo=meus` (atendente).

**200**
```json
{
  "periodo": { "tipo": "30d", "dataInicio": "2026-09-01", "dataFim": "2026-09-30", "agrupamento": "dia", "fuso": "America/Sao_Paulo" },
  "escopo": "geral",
  "totais": { "total": 120, "abertas": 40, "emAtendimento": 30, "concluidas": 50 },
  "porStatus": [
    { "status": "ABERTO", "total": 40 },
    { "status": "EM_ATENDIMENTO", "total": 30 },
    { "status": "CONCLUIDO", "total": 50 }
  ],
  "porCategoria": [
    { "categoriaId": 1, "nome": "TI", "total": 60, "abertas": 20, "emAtendimento": 15, "concluidas": 25 }
  ],
  "serie": [
    { "data": "2026-09-01", "criadas": 4, "concluidas": 2 }
  ]
}
```

| Campo | Para que usar |
|---|---|
| `periodo` | Intervalo **realmente usado** (útil para o subtítulo dos gráficos e para preencher o filtro de datas no "Tudo"). `tipo` é `tudo`, `30d`, `7d` ou `personalizado`. |
| `escopo` | `proprias` (solicitante), `geral` ou `meus` (atendente). |
| `totais` | Os 4 painéis numéricos. |
| `porStatus` | Sempre os 3 status (zero incluído): `<PieChart>` direto. |
| `porCategoria` | Uma linha por setor, com as contagens por status: `<BarChart>` empilhado (`abertas`, `emAtendimento`, `concluidas`). Traz todas as categorias ativas, mesmo com zero, para as barras não "pularem"; com `categoriaId` vem só a escolhida. |
| `serie` | Linha do tempo **sem lacunas** (dias/semanas/meses sem movimento vêm com 0): `<LineChart>`/`<BarChart>` direto, `dataKey="data"`. Em `semana`, `data` é a segunda-feira; em `mes`, o dia 1. |

**Regra do período:** uma solicitação pertence ao período pela **data de criação**, e todos os blocos usam essa mesma coleção. Por isso `sum(serie.criadas) = totais.total` e `sum(porCategoria.total) = totais.total`. `serie.concluidas` conta, dessas solicitações, as concluídas dentro da janela (por data de conclusão); nos presets, que terminam hoje, ela também soma `totais.concluidas`.

**Atenção no `escopo=meus`:** `abertas` é sempre 0, porque um chamado aberto ainda não tem atendente.

**Performance no front:**
- Uma chamada por mudança de filtro (preset, datas, setor, escopo). Com TanStack Query: `queryKey: ['dashboard', filtros]`, `placeholderData: keepPreviousData` (troca de filtro sem piscar) e `staleTime` curto (~30 s). Invalide `['dashboard']` depois de criar, excluir ou mudar o status de uma solicitação.
- A resposta traz `Cache-Control: private, no-cache` e `ETag`: o navegador revalida a cada chamada e, se nada mudou, recebe **304** sem corpo (o `fetch` já devolve o conteúdo em cache). Dado nunca fica desatualizado.
- Clique numa barra de setor pode aplicar `categoriaId`; os botões **Tudo / 30 dias / 7 dias** enviam `periodo`; o seletor de datas envia `dataInicio`/`dataFim` (e deixa de enviar `periodo`).

Erros: **400** para `periodo`/`agrupamento`/`escopo` fora dos valores, `periodo` junto de datas, data inexistente, `dataInicio` maior que `dataFim`, `categoriaId` não numérico, `fuso` inválido, parâmetro desconhecido, série com mais de 400 pontos ou `escopo` enviado por solicitante; **401** sem token.
