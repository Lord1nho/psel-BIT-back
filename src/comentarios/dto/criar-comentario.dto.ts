import { TextoObrigatorio } from '../../common/validacao/decorators.js';
import { LIMITES } from '../../common/validacao/limites.js';

export class CriarComentarioDto {
  @TextoObrigatorio(LIMITES.comentario)
  texto!: string;
}
