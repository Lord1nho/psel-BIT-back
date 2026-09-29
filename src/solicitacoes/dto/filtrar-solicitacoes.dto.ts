import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { StatusSolicitacao } from '../../generated/prisma/client.js';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export class FiltrarSolicitacoesDto {
  @IsOptional()
  @IsEnum(StatusSolicitacao)
  status?: StatusSolicitacao;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoriaId?: number;

  // Busca livre (título, solicitante ou código), pensada para digitação dinâmica.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataInicio deve estar no formato AAAA-MM-DD' })
  dataInicio?: string;

  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataFim deve estar no formato AAAA-MM-DD' })
  dataFim?: string;
}
