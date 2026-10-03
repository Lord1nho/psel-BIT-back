import { IsOptional } from 'class-validator';
import { IdInteiro, TextoOpcional } from '../../common/validacao/decorators.js';
import { LIMITES } from '../../common/validacao/limites.js';

export class EditarSolicitacaoDto {
  @TextoOpcional(LIMITES.titulo)
  titulo?: string;

  @TextoOpcional(LIMITES.descricao)
  descricao?: string;

  @IsOptional()
  @IdInteiro()
  categoriaId?: number;
}
