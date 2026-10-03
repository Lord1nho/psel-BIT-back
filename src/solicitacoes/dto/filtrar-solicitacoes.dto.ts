import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
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

// As 3 opções do seletor de atendente: só os meus, todos (sem filtro) e sem atendente.
export const FILTROS_ATENDENTE = ['meus', 'todos', 'sem'] as const;
export type FiltroAtendente = (typeof FILTROS_ATENDENTE)[number];

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

  // meus = chamados que o atendente logado assumiu (resolvido pelo token, só atendente);
  // sem = chamados que ninguém assumiu; todos (ou ausente) = sem filtro.
  @IsOptional()
  @IsIn(FILTROS_ATENDENTE)
  atendente?: FiltroAtendente;

  // Um atendente específico (mesma definição da coluna "atendente" da listagem).
  // Não combina com "atendente".
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
