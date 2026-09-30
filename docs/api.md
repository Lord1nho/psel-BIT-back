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
| Alterar status | não (403) | sim |

Mostre editar e excluir só quando `status === 'ABERTO'` e a solicitação for do usuário; o servidor valida de qualquer forma.

### Usuários de teste (seed)

| usuario | senha | perfil |
|---|---|---|
| `solicitante.um` | `123456` | SOLICITANTE |
| `atendente.um` | `123456` | ATENDENTE |

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
| `status` | enum | |
| `categoriaId` | inteiro | |
| `q` | texto, até 100 caracteres | Busca em parte do título, no nome ou usuário do solicitante e, se for só número, no código. Não diferencia maiúsculas. |
| `dataInicio` | `AAAA-MM-DD` | |
| `dataFim` | `AAAA-MM-DD` | Inclusiva. Não pode ser anterior a `dataInicio`. |

Exemplo: `GET /solicitacoes?q=note&status=ABERTO&dataInicio=2026-09-01&dataFim=2026-09-30`

**200**: array (sem paginação), da mais recente para a mais antiga:
```json
[
  {
    "codigo": 3, "titulo": "Notebook lento", "status": "ABERTO",
    "dataCriacao": "2026-09-30T14:22:10.123Z",
    "categoria": { "id": 1, "nome": "TI" },
    "solicitante": { "id": 2, "nome": "Solicitante Um" }
  }
]
```

**Busca dinâmica:** chame esta mesma rota a cada digitação, com *debounce* de ~300 ms. Se o campo ficar vazio, **não envie `q=`** (volta à lista completa). O escopo do solicitante vale também na busca.

Erros: **400** para `status` fora do enum, `categoriaId` não numérico, data fora do formato, período invertido ou parâmetro desconhecido.

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
  "historico": [
    { "statusAnterior": null, "statusNovo": "ABERTO",
      "dataAlteracao": "2026-09-30T14:22:10.123Z", "usuario": { "id": 2, "nome": "Solicitante Um" } },
    { "statusAnterior": "ABERTO", "statusNovo": "EM_ATENDIMENTO",
      "dataAlteracao": "2026-09-30T15:01:00.000Z", "usuario": { "id": 1, "nome": "Atendente Um" } }
  ]
}
```

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

**200**: a solicitação atualizada, no formato do "Criar". A sequência é estrita e **cada mudança gera uma linha no histórico**:

`ABERTO → EM_ATENDIMENTO → CONCLUIDO`

Pular etapa, voltar, repetir ou alterar uma solicitação concluída dá **409**; a `message` informa o próximo status permitido. No front, use **um único botão "avançar"** que envia o próximo status, e nenhum botão quando `CONCLUIDO`.

Erros: **400** (status fora do enum); **403** (perfil SOLICITANTE); **404**; **409** (transição inválida, ou outro atendente alterou antes).

## 10. Dashboard

Em breve (UC07).
