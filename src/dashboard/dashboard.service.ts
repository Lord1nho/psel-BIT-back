import { BadRequestException, Injectable } from '@nestjs/common';
import { PerfilUsuario, Prisma } from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FiltrarDashboardDto } from './dto/filtrar-dashboard.dto.js';
import {
  fusoValido,
  hojeNoFuso,
  precisaDaPrimeiraData,
  resolverPeriodo,
  type Agrupamento,
} from './periodo.js';

const FUSO_PADRAO = 'America/Sao_Paulo';

// Valores fixos (nunca vêm da requisição): são os únicos que entram no texto do SQL.
const UNIDADE_SQL: Record<Agrupamento, string> = {
  dia: 'day',
  semana: 'week',
  mes: 'month',
};

interface LinhaCategoria {
  categoriaId: number;
  total: bigint;
  abertas: bigint;
  emAtendimento: bigint;
  concluidas: bigint;
}

interface LinhaSerie {
  data: string;
  criadas: bigint;
  concluidas: bigint;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async obter(filtros: FiltrarDashboardDto, usuario: UsuarioAutenticado) {
    const ehAtendente = usuario.perfil === PerfilUsuario.ATENDENTE;
    if (filtros.escopo && !ehAtendente) {
      throw new BadRequestException('O filtro "escopo" é exclusivo do atendente');
    }
    const fuso = filtros.fuso ?? FUSO_PADRAO;
    if (!fusoValido(fuso)) {
      throw new BadRequestException(`Fuso horário inválido: ${fuso}`);
    }

    // Escopo e categoria valem para tudo; o período é aplicado por cima.
    const condicoesBase = this.condicoesBase(filtros, usuario, ehAtendente);

    const hoje = hojeNoFuso(fuso);
    const primeiraData = precisaDaPrimeiraData(filtros)
      ? await this.primeiraData(condicoesBase, fuso)
      : null;
    const periodo = resolverPeriodo(filtros, hoje, primeiraData);

    const condicoes = [
      ...condicoesBase,
      Prisma.sql`s.data_criacao >= (${periodo.dataInicio}::date)::timestamp AT TIME ZONE ${fuso}`,
      Prisma.sql`s.data_criacao < ((${periodo.dataFim}::date + 1))::timestamp AT TIME ZONE ${fuso}`,
    ];

    const [linhasCategoria, linhasSerie, categorias] = await Promise.all([
      this.porCategoria(condicoes),
      this.serie(condicoes, periodo, fuso),
      this.prisma.categoria.findMany({
        select: { id: true, nome: true, ativa: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const porCategoria = this.montarPorCategoria(
      linhasCategoria,
      categorias,
      filtros.categoriaId,
    );
    const totais = {
      total: soma(porCategoria, 'total'),
      abertas: soma(porCategoria, 'abertas'),
      emAtendimento: soma(porCategoria, 'emAtendimento'),
      concluidas: soma(porCategoria, 'concluidas'),
    };

    return {
      periodo: { ...periodo, fuso },
      escopo: ehAtendente ? (filtros.escopo ?? 'geral') : 'proprias',
      totais,
      porStatus: [
        { status: 'ABERTO', total: totais.abertas },
        { status: 'EM_ATENDIMENTO', total: totais.emAtendimento },
        { status: 'CONCLUIDO', total: totais.concluidas },
      ],
      porCategoria,
      serie: linhasSerie.map((l) => ({
        data: l.data,
        criadas: Number(l.criadas),
        concluidas: Number(l.concluidas),
      })),
    };
  }

  private condicoesBase(
    filtros: FiltrarDashboardDto,
    usuario: UsuarioAutenticado,
    ehAtendente: boolean,
  ): Prisma.Sql[] {
    const condicoes: Prisma.Sql[] = [];

    // O escopo vem do token: o solicitante nunca enxerga solicitações alheias.
    if (!ehAtendente) {
      condicoes.push(Prisma.sql`s.usuario_id = ${usuario.id}`);
    } else if (filtros.escopo === 'meus') {
      condicoes.push(Prisma.sql`EXISTS (
        SELECT 1 FROM historico_solicitacoes hm
        WHERE hm.solicitacao_codigo = s.codigo
          AND hm.status_novo = 'EM_ATENDIMENTO'
          AND hm.usuario_id = ${usuario.id}
      )`);
    }
    if (filtros.categoriaId) {
      condicoes.push(Prisma.sql`s.categoria_id = ${filtros.categoriaId}`);
    }
    return condicoes;
  }

  private async primeiraData(
    condicoesBase: Prisma.Sql[],
    fuso: string,
  ): Promise<string | null> {
    const [linha] = await this.prisma.$queryRaw<{ primeira: string | null }[]>(
      Prisma.sql`
        SELECT to_char(min((s.data_criacao AT TIME ZONE ${fuso})::date), 'YYYY-MM-DD') AS primeira
        FROM solicitacoes s
        ${onde(condicoesBase)}`,
    );
    return linha?.primeira ?? null;
  }

  private porCategoria(condicoes: Prisma.Sql[]) {
    return this.prisma.$queryRaw<LinhaCategoria[]>(
      Prisma.sql`
        SELECT s.categoria_id AS "categoriaId",
               count(*) AS total,
               count(*) FILTER (WHERE s.status = 'ABERTO') AS abertas,
               count(*) FILTER (WHERE s.status = 'EM_ATENDIMENTO') AS "emAtendimento",
               count(*) FILTER (WHERE s.status = 'CONCLUIDO') AS concluidas
        FROM solicitacoes s
        ${onde(condicoes)}
        GROUP BY s.categoria_id`,
    );
  }

  // Um ponto por bucket do período (zeros incluídos), pronto para o gráfico.
  private serie(
    condicoes: Prisma.Sql[],
    periodo: { dataInicio: string; dataFim: string; agrupamento: Agrupamento },
    fuso: string,
  ) {
    const unidade = Prisma.raw(`'${UNIDADE_SQL[periodo.agrupamento]}'`);
    const passo = Prisma.raw(`interval '1 ${UNIDADE_SQL[periodo.agrupamento]}'`);
    const { dataInicio, dataFim } = periodo;

    return this.prisma.$queryRaw<LinhaSerie[]>(
      Prisma.sql`
        WITH buckets AS (
          SELECT generate_series(
                   date_trunc(${unidade}, ${dataInicio}::date::timestamp),
                   ${dataFim}::date::timestamp,
                   ${passo}
                 )::date AS data
        ),
        criadas AS (
          SELECT date_trunc(${unidade}, s.data_criacao AT TIME ZONE ${fuso})::date AS data,
                 count(*) AS n
          FROM solicitacoes s
          ${onde(condicoes)}
          GROUP BY 1
        ),
        concluidas AS (
          SELECT date_trunc(${unidade}, h.data_alteracao AT TIME ZONE ${fuso})::date AS data,
                 count(*) AS n
          FROM historico_solicitacoes h
          JOIN solicitacoes s ON s.codigo = h.solicitacao_codigo
          ${onde([
            ...condicoes,
            Prisma.sql`h.status_novo = 'CONCLUIDO'`,
            Prisma.sql`h.data_alteracao < ((${dataFim}::date + 1))::timestamp AT TIME ZONE ${fuso}`,
          ])}
          GROUP BY 1
        )
        SELECT to_char(b.data, 'YYYY-MM-DD') AS data,
               coalesce(c.n, 0) AS criadas,
               coalesce(k.n, 0) AS concluidas
        FROM buckets b
        LEFT JOIN criadas c ON c.data = b.data
        LEFT JOIN concluidas k ON k.data = b.data
        ORDER BY b.data`,
    );
  }

  // Todas as categorias ativas (zeros incluídos, para barras estáveis) mais as
  // inativas que tenham chamados; com filtro de setor, só a escolhida.
  private montarPorCategoria(
    linhas: LinhaCategoria[],
    categorias: { id: number; nome: string; ativa: boolean }[],
    categoriaId?: number,
  ) {
    const porId = new Map(linhas.map((l) => [l.categoriaId, l]));
    return categorias
      .filter((c) =>
        categoriaId ? c.id === categoriaId : c.ativa || porId.has(c.id),
      )
      .map((c) => {
        const l = porId.get(c.id);
        return {
          categoriaId: c.id,
          nome: c.nome,
          total: Number(l?.total ?? 0),
          abertas: Number(l?.abertas ?? 0),
          emAtendimento: Number(l?.emAtendimento ?? 0),
          concluidas: Number(l?.concluidas ?? 0),
        };
      });
  }
}

function onde(condicoes: Prisma.Sql[]): Prisma.Sql {
  return condicoes.length
    ? Prisma.sql`WHERE ${Prisma.join(condicoes, ' AND ')}`
    : Prisma.sql`WHERE TRUE`;
}

function soma<T extends Record<string, number | string>>(
  itens: T[],
  campo: keyof T,
): number {
  return itens.reduce((acc, item) => acc + Number(item[campo]), 0);
}
