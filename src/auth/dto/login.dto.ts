import { TextoObrigatorio } from '../../common/validacao/decorators.js';
import { LIMITES } from '../../common/validacao/limites.js';

export class LoginDto {
  @TextoObrigatorio(LIMITES.usuario)
  usuario!: string;

  // Os espaços da senha fazem parte dela: não é aparada.
  @TextoObrigatorio(LIMITES.senha, { aparar: false })
  senha!: string;
}
