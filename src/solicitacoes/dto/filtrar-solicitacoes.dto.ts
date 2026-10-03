import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StatusSolicitacao } from '../../generated/prisma/client.js';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const TAMANHO_PADRAO = 20;
export const TAMANHO_MAXIMO = 100;
// Evita um OFFSET absurdo (a lista só tem sentido em páginas razoáveis).
const PAGINA_MAXIMA = 1_000_000;

// Aceita "ABERTO,EM_ATENDIMENTO" e o parâmetro repetido (status=A&status=B). Remove
// repetidos e espaços; vazio equivale a não filtrar. Valores inválidos seguem para a validação.
function paraListaDeStatus({ value }: { value: unknown }) {
  if (value === undefined || value === null) return undefined;
  const itens = (Array.isArray(value) ? value : [value])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => v !== '');
  return itens.length ? [...new Set(itens)] : undefined;
}

export class FiltrarSolicitacoesDto {
  @IsOptional()
  @Transform(paraListaDeStatus)
  @IsEnum(StatusSolicitacao, { each: true })
  status?: StatusSolicitacao[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoriaId?: number;

  // Atendente que assumiu o chamado (mesma definição da coluna "atendente" da listagem).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  atendenteId?: number;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINA_MAXIMA)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANHO_MAXIMO)
  tamanho?: number;
}
