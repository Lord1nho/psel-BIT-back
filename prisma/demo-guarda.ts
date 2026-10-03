// Decide se o seed de demonstração deve escrever. Com `--se-vazio` (usado na subida do
// container) só semeia com a tabela de chamados vazia e nunca trata isso como erro.
export function deveSemear(totalDeChamados: number, seVazio: boolean): boolean {
  return !seVazio || totalDeChamados === 0;
}
