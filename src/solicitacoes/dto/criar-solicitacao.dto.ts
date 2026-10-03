import {
  IdInteiro,
  TextoObrigatorio,
} from '../../common/validacao/decorators.js';
import { LIMITES } from '../../common/validacao/limites.js';

export class CriarSolicitacaoDto {
  @TextoObrigatorio(LIMITES.titulo)
  titulo!: string;

  @TextoObrigatorio(LIMITES.descricao)
  descricao!: string;

  @IdInteiro()
  categoriaId!: number;
}
