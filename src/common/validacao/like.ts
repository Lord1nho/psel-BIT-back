// Escapa os curingas do LIKE/ILIKE (% _) e a própria barra, para a busca livre tratar o que o
// usuário digitou como texto literal: sem isso "%" casa tudo e "100%" traz resultados indevidos.
export const escaparCuringasLike = (texto: string) =>
  texto.replace(/[\\%_]/g, '\\$&');
