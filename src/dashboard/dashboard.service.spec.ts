import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { DashboardService } from './dashboard.service.js';

describe('DashboardService', () => {
  const queryRaw = vi.fn();
  const findCategorias = vi.fn();
  let service: DashboardService;

  const solicitante = { id: 5, usuario: 'solicitante.um', perfil: 'SOLICITANTE' } as const;
  const atendente = { id: 9, usuario: 'atendente.um', perfil: 'ATENDENTE' } as const;

  const categorias = [
    { id: 1, nome: 'TI', ativa: true },
    { id: 2, nome: 'RH', ativa: true },
    { id: 3, nome: 'Legado', ativa: false },
  ];

  const linhasCategoria = [
    { categoriaId: 1, total: 6n, abertas: 3n, emAtendimento: 2n, concluidas: 1n },
    { categoriaId: 3, total: 1n, abertas: 0n, emAtendimento: 0n, concluidas: 1n },
  ];
  const linhasSerie = [
    { data: '2026-09-29', criadas: 4n, concluidas: 0n },
    { data: '2026-09-30', criadas: 3n, concluidas: 2n },
  ];

  // As consultas são diferenciadas pelo texto do SQL.
  const sqls = () => queryRaw.mock.calls.map(([sql]: [Prisma.Sql]) => sql);
  const sqlDe = (trecho: string) => sqls().find((s) => s.sql.includes(trecho));

  beforeEach(() => {
    queryRaw.mockReset();
    findCategorias.mockReset();
    findCategorias.mockResolvedValue(categorias);
    queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
      if (sql.sql.includes('min(')) return [{ primeira: '2026-09-29' }];
      if (sql.sql.includes('generate_series')) return linhasSerie;
      return linhasCategoria;
    });
    service = new DashboardService({
      $queryRaw: queryRaw,
      categoria: { findMany: findCategorias },
    } as never);
  });

  it('converte bigint em número e soma os totais pelas categorias', async () => {
    const r = await service.obter({ periodo: '7d' }, atendente);

    expect(r.totais).toEqual({ total: 7, abertas: 3, emAtendimento: 2, concluidas: 2 });
    expect(r.serie).toEqual([
      { data: '2026-09-29', criadas: 4, concluidas: 0 },
      { data: '2026-09-30', criadas: 3, concluidas: 2 },
    ]);
  });

  it('porStatus sempre traz os 3 status', async () => {
    const r = await service.obter({ periodo: '7d' }, atendente);

    expect(r.porStatus).toEqual([
      { status: 'ABERTO', total: 3 },
      { status: 'EM_ATENDIMENTO', total: 2 },
      { status: 'CONCLUIDO', total: 2 },
    ]);
  });

  it('porCategoria traz as ativas (com zero) e a inativa que tem chamados', async () => {
    const r = await service.obter({ periodo: '7d' }, atendente);

    expect(r.porCategoria).toEqual([
      { categoriaId: 1, nome: 'TI', total: 6, abertas: 3, emAtendimento: 2, concluidas: 1 },
      { categoriaId: 2, nome: 'RH', total: 0, abertas: 0, emAtendimento: 0, concluidas: 0 },
      { categoriaId: 3, nome: 'Legado', total: 1, abertas: 0, emAtendimento: 0, concluidas: 1 },
    ]);
  });

  it('categoria inativa sem chamados não aparece', async () => {
    queryRaw.mockImplementation(async (sql: Prisma.Sql) =>
      sql.sql.includes('generate_series') ? [] : [],
    );

    const r = await service.obter({ periodo: '7d' }, atendente);

    expect(r.porCategoria.map((c) => c.categoriaId)).toEqual([1, 2]);
    expect(r.totais).toEqual({ total: 0, abertas: 0, emAtendimento: 0, concluidas: 0 });
  });

  it('filtro de setor devolve só a categoria escolhida', async () => {
    const r = await service.obter({ periodo: '7d', categoriaId: 2 }, atendente);

    expect(r.porCategoria.map((c) => c.categoriaId)).toEqual([2]);
    expect(sqlDe('GROUP BY s.categoria_id')?.values).toContain(2);
  });

  it('solicitante fica sempre restrito ao próprio usuário e recebe escopo "proprias"', async () => {
    const r = await service.obter({ periodo: '7d' }, solicitante);

    expect(r.escopo).toBe('proprias');
    for (const sql of sqls()) expect(sql.sql).toContain('s.usuario_id =');
    expect(sqlDe('GROUP BY s.categoria_id')?.values).toContain(5);
  });

  it('atendente geral não filtra por usuário; escopo "meus" usa o histórico', async () => {
    const geral = await service.obter({ periodo: '7d' }, atendente);
    expect(geral.escopo).toBe('geral');
    for (const sql of sqls()) expect(sql.sql).not.toContain('s.usuario_id =');

    queryRaw.mockClear();
    const meus = await service.obter({ periodo: '7d', escopo: 'meus' }, atendente);
    expect(meus.escopo).toBe('meus');
    const sql = sqlDe('GROUP BY s.categoria_id')!;
    expect(sql.sql).toContain("hm.status_novo = 'EM_ATENDIMENTO'");
    expect(sql.values).toContain(9);
  });

  it('solicitante não pode usar o filtro escopo (400)', async () => {
    await expect(
      service.obter({ escopo: 'meus' }, solicitante),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejeita fuso inválido antes de consultar o banco', async () => {
    await expect(
      service.obter({ fuso: 'Marte/Olympus' }, atendente),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('valores da requisição vão como parâmetros, nunca no texto do SQL', async () => {
    await service.obter(
      { dataInicio: '2026-09-01', dataFim: '2026-09-30', categoriaId: 1 },
      atendente,
    );

    for (const sql of sqls()) {
      expect(sql.sql).not.toContain('2026-09');
      expect(sql.sql).not.toContain('America/Sao_Paulo');
    }
    expect(sqlDe('generate_series')?.values).toEqual(
      expect.arrayContaining(['2026-09-01', '2026-09-30', 'America/Sao_Paulo']),
    );
  });

  it('agrupamento define a unidade do SQL (fixa, vinda de uma lista fechada)', async () => {
    await service.obter(
      { dataInicio: '2026-09-01', dataFim: '2026-09-30', agrupamento: 'semana' },
      atendente,
    );

    expect(sqlDe('generate_series')?.sql).toContain("date_trunc('week'");
    expect(sqlDe('generate_series')?.sql).toContain("interval '1 week'");
  });

  it('informa o período realmente usado, com o fuso', async () => {
    const r = await service.obter({ periodo: '7d', fuso: 'UTC' }, atendente);

    expect(r.periodo).toMatchObject({ tipo: '7d', agrupamento: 'dia', fuso: 'UTC' });
    expect(r.periodo.dataInicio < r.periodo.dataFim).toBe(true);
  });

  it('só consulta a primeira data quando o período depende dela', async () => {
    await service.obter({ periodo: '7d' }, atendente);
    expect(sqlDe('min(')).toBeUndefined();

    queryRaw.mockClear();
    const r = await service.obter({}, atendente);
    expect(sqlDe('min(')).toBeDefined();
    expect(r.periodo).toMatchObject({ tipo: 'tudo', dataInicio: '2026-09-29' });
  });
});
