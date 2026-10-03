import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IdInteiro } from '../../common/validacao/decorators.js';
import {
  AGRUPAMENTOS,
  PRESETS,
  type AgrupamentoEntrada,
  type Preset,
} from '../periodo.js';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const ESCOPOS = ['geral', 'meus'] as const;
export type EscopoEntrada = (typeof ESCOPOS)[number];

export class FiltrarDashboardDto {
  @IsOptional()
  @IsIn(PRESETS)
  periodo?: Preset;

  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataInicio deve estar no formato AAAA-MM-DD' })
  dataInicio?: string;

  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataFim deve estar no formato AAAA-MM-DD' })
  dataFim?: string;

  @IsOptional()
  @Type(() => Number)
  @IdInteiro()
  categoriaId?: number;

  @IsOptional()
  @IsIn(AGRUPAMENTOS)
  agrupamento?: AgrupamentoEntrada;

  // Somente atendente: "meus" = chamados que ele assumiu.
  @IsOptional()
  @IsIn(ESCOPOS)
  escopo?: EscopoEntrada;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  fuso?: string;
}
