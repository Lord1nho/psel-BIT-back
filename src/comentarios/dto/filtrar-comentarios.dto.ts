import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IdInteiro } from '../../common/validacao/decorators.js';

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 100;

export class FiltrarComentariosDto {
  // Cursor: id do último comentário que o front já tem; devolve só os posteriores a ele.
  @IsOptional()
  @Type(() => Number)
  @IdInteiro()
  proxComentario?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMO)
  limite?: number;
}
