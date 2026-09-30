import { BadRequestException } from '@nestjs/common';

export const PRESETS = ['tudo', '30d', '7d'] as const;
export type Preset = (typeof PRESETS)[number];

export const AGRUPAMENTOS = ['auto', 'dia', 'semana', 'mes'] as const;
export type AgrupamentoEntrada = (typeof AGRUPAMENTOS)[number];
export type Agrupamento = Exclude<AgrupamentoEntrada, 'auto'>;

export type PeriodoTipo = Preset | 'personalizado';

// Máximo de pontos que a série pode ter (protege o payload e o gráfico).
export const MAX_PONTOS = 400;

// Até 62 dias cabem bem por dia; até 364 por semana; além disso por mês.
const LIMITE_AUTO_DIA = 62;
const LIMITE_AUTO_SEMANA = 364;

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_FUSO = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

export interface EntradaPeriodo {
  periodo?: Preset;
  dataInicio?: string;
  dataFim?: string;
  agrupamento?: AgrupamentoEntrada;
}

export interface PeriodoResolvido {
  tipo: PeriodoTipo;
  dataInicio: string;
  dataFim: string;
  agrupamento: Agrupamento;
}

export function fusoValido(fuso: string): boolean {
  if (!FORMATO_FUSO.test(fuso)) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

// "Hoje" como AAAA-MM-DD no fuso informado (22h em São Paulo ainda é o mesmo dia).
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

function paraData(data: string): Date {
  return new Date(`${data}T00:00:00.000Z`);
}

export function dataValida(data: string): boolean {
  if (!DATA_ISO.test(data)) return false;
  const d = paraData(data);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data;
}

export function somarDias(data: string, dias: number): string {
  const d = paraData(data);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Quantidade de dias do intervalo, contando os dois extremos.
export function diasNoIntervalo(inicio: string, fim: string): number {
  return Math.round((paraData(fim).getTime() - paraData(inicio).getTime()) / 86_400_000) + 1;
}

function inicioDaSemana(data: string): string {
  const diaDaSemana = (paraData(data).getUTCDay() + 6) % 7; // segunda = 0
  return somarDias(data, -diaDaSemana);
}

export function contarPontos(
  inicio: string,
  fim: string,
  agrupamento: Agrupamento,
): number {
  if (agrupamento === 'dia') return diasNoIntervalo(inicio, fim);
  if (agrupamento === 'semana') {
    // Distância entre as segundas-feiras dos dois extremos, em semanas, mais a primeira.
    const dias = diasNoIntervalo(inicioDaSemana(inicio), inicioDaSemana(fim)) - 1;
    return dias / 7 + 1;
  }
  const [anoI, mesI] = inicio.split('-').map(Number);
  const [anoF, mesF] = fim.split('-').map(Number);
  return (anoF - anoI) * 12 + (mesF - mesI) + 1;
}

export function escolherAgrupamento(
  pedido: AgrupamentoEntrada,
  inicio: string,
  fim: string,
): Agrupamento {
  if (pedido !== 'auto') return pedido;
  const dias = diasNoIntervalo(inicio, fim);
  if (dias <= LIMITE_AUTO_DIA) return 'dia';
  if (dias <= LIMITE_AUTO_SEMANA) return 'semana';
  return 'mes';
}

export function tipoDoPeriodo({ periodo, dataInicio, dataFim }: EntradaPeriodo): PeriodoTipo {
  if (dataInicio || dataFim) return 'personalizado';
  return periodo ?? 'tudo';
}

// O início depende da primeira solicitação quando não há uma janela fixa.
export function precisaDaPrimeiraData(entrada: EntradaPeriodo): boolean {
  const tipo = tipoDoPeriodo(entrada);
  return tipo === 'tudo' || (tipo === 'personalizado' && !entrada.dataInicio);
}

export function resolverPeriodo(
  entrada: EntradaPeriodo,
  hoje: string,
  primeiraData?: string | null,
): PeriodoResolvido {
  const { periodo, dataInicio, dataFim, agrupamento = 'auto' } = entrada;

  if (periodo && (dataInicio || dataFim)) {
    throw new BadRequestException(
      'Use "periodo" ou "dataInicio/dataFim", não os dois juntos',
    );
  }
  for (const [nome, valor] of [['dataInicio', dataInicio], ['dataFim', dataFim]] as const) {
    if (valor !== undefined && !dataValida(valor)) {
      throw new BadRequestException(`${nome} inválida (use AAAA-MM-DD)`);
    }
  }
  if (dataInicio && dataFim && dataInicio > dataFim) {
    throw new BadRequestException('dataInicio não pode ser maior que dataFim');
  }

  const tipo = tipoDoPeriodo(entrada);
  const primeira = primeiraData ?? hoje;
  let inicio: string;
  let fim: string;

  if (tipo === '7d' || tipo === '30d') {
    fim = hoje;
    inicio = somarDias(hoje, tipo === '7d' ? -6 : -29);
  } else if (tipo === 'personalizado') {
    // Só um limite informado: o outro assume (primeira solicitação / hoje).
    fim = dataFim ?? (hoje < (dataInicio as string) ? (dataInicio as string) : hoje);
    inicio = dataInicio ?? (primeira > fim ? fim : primeira);
  } else {
    fim = hoje;
    inicio = primeira > hoje ? hoje : primeira;
  }

  const agrupamentoFinal = escolherAgrupamento(agrupamento, inicio, fim);
  if (contarPontos(inicio, fim, agrupamentoFinal) > MAX_PONTOS) {
    throw new BadRequestException(
      `O período geraria mais de ${MAX_PONTOS} pontos; reduza o período ou use um agrupamento maior (semana ou mes)`,
    );
  }

  return { tipo, dataInicio: inicio, dataFim: fim, agrupamento: agrupamentoFinal };
}
