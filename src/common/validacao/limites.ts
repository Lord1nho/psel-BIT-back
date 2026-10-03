// Maior valor do tipo integer (32 bits com sinal) do Postgres e do Prisma `Int`. Acima disso o
// banco rejeita o valor e a API responderia 500; com este teto a resposta é 400.
export const INT_MAX = 2_147_483_647;

// Tamanhos máximos dos campos de texto livre. `titulo` e `usuario` acompanham o VarChar(255) do
// banco; `descricao` é TEXT no banco e precisa de um teto próprio; `senha` fica abaixo do
// limite útil do bcrypt (72 bytes) com folga para caracteres multibyte.
export const LIMITES = {
  titulo: 255,
  descricao: 3500,
  usuario: 255,
  senha: 128,
  busca: 100,
} as const;
