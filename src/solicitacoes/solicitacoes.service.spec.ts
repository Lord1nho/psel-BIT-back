import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SolicitacoesService } from './solicitacoes.service.js';

describe('SolicitacoesService', () => {
  const findCategoria = vi.fn();
  const createSolicitacao = vi.fn();
  const findSolicitacao = vi.fn();
  const findSolicitacaoOrThrow = vi.fn();
  const updateMany = vi.fn();
  const deleteMany = vi.fn();
  const findMany = vi.fn();
  const contar = vi.fn();
  const criarHistorico = vi.fn();
  let service: SolicitacoesService;

  const atendente = { id: 9, usuario: 'atendente.um', perfil: 'ATENDENTE' } as const;

  const autor = { id: 5, usuario: 'solicitante.um', perfil: 'SOLICITANTE' } as const;
  const dto = { titulo: 'Notebook lento', descricao: 'Trava no Excel', categoriaId: 1 };
  const solicitacaoAberta = { codigo: 10, usuarioId: 5, status: 'ABERTO' };

  beforeEach(() => {
    vi.resetAllMocks();
    const solicitacao = {
      create: createSolicitacao,
      findUnique: findSolicitacao,
      findUniqueOrThrow: findSolicitacaoOrThrow,
      findMany,
      count: contar,
      updateMany,
      deleteMany,
    };
    const historicoSolicitacao = { create: criarHistorico };
    service = new SolicitacoesService({
      categoria: { findUnique: findCategoria },
      solicitacao,
      historicoSolicitacao,
      // Aceita as duas formas: callback (transação interativa) e lista de operações.
      $transaction: (arg: unknown) =>
        typeof arg === 'function'
          ? arg({ solicitacao, historicoSolicitacao })
          : Promise.all(arg as Promise<unknown>[]),
    } as never);
  });

  describe('criar', () => {
    it('cria solicitação ABERTO do autor com histórico null → ABERTO', async () => {
      findCategoria.mockResolvedValue({ id: 1, nome: 'TI', ativa: true });
      createSolicitacao.mockResolvedValue({ codigo: 10 });

      await service.criar(dto, autor);

      expect(createSolicitacao).toHaveBeenCalledWith({
        data: {
          titulo: 'Notebook lento',
          descricao: 'Trava no Excel',
          categoriaId: 1,
          usuarioId: 5,
          status: 'ABERTO',
          historico: {
            create: { usuarioId: 5, statusAnterior: null, statusNovo: 'ABERTO' },
          },
        },
        include: { categoria: true },
      });
    });

    it('rejeita categoria inexistente', async () => {
      findCategoria.mockResolvedValue(null);

      await expect(service.criar(dto, autor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(createSolicitacao).not.toHaveBeenCalled();
    });

    it('rejeita categoria inativa', async () => {
      findCategoria.mockResolvedValue({ id: 1, nome: 'TI', ativa: false });

      await expect(service.criar(dto, autor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(createSolicitacao).not.toHaveBeenCalled();
    });
  });

  describe('editar', () => {
    it('edita solicitação própria com status ABERTO', async () => {
      findSolicitacao.mockResolvedValue(solicitacaoAberta);
      findCategoria.mockResolvedValue({ id: 2, nome: 'RH', ativa: true });
      updateMany.mockResolvedValue({ count: 1 });
      findSolicitacaoOrThrow.mockResolvedValue({ codigo: 10, titulo: 'Novo' });

      const resultado = await service.editar(
        10,
        { titulo: 'Novo', categoriaId: 2 },
        autor,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { codigo: 10, usuarioId: 5, status: 'ABERTO' },
        data: { titulo: 'Novo', descricao: undefined, categoriaId: 2 },
      });
      expect(resultado).toEqual({ codigo: 10, titulo: 'Novo' });
    });

    it('rejeita corpo sem nenhum campo', async () => {
      await expect(service.editar(10, {}, autor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(findSolicitacao).not.toHaveBeenCalled();
    });

    it('retorna 404 quando a solicitação não existe', async () => {
      findSolicitacao.mockResolvedValue(null);

      await expect(
        service.editar(99, { titulo: 'x' }, autor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retorna 403 quando a solicitação é de outro usuário', async () => {
      findSolicitacao.mockResolvedValue({ ...solicitacaoAberta, usuarioId: 6 });

      await expect(
        service.editar(10, { titulo: 'x' }, autor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it.each(['EM_ATENDIMENTO', 'CONCLUIDO'])(
      'retorna 409 quando o status é %s',
      async (status) => {
        findSolicitacao.mockResolvedValue({ ...solicitacaoAberta, status });

        await expect(
          service.editar(10, { titulo: 'x' }, autor),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it('retorna 409 quando o status muda entre a checagem e a escrita', async () => {
      findSolicitacao.mockResolvedValue(solicitacaoAberta);
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.editar(10, { titulo: 'x' }, autor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejeita categoria inexistente ou inativa na edição', async () => {
      findSolicitacao.mockResolvedValue(solicitacaoAberta);
      findCategoria.mockResolvedValue({ id: 2, nome: 'RH', ativa: false });

      await expect(
        service.editar(10, { categoriaId: 2 }, autor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('excluir', () => {
    it('exclui solicitação própria com status ABERTO', async () => {
      findSolicitacao.mockResolvedValue(solicitacaoAberta);
      deleteMany.mockResolvedValue({ count: 1 });

      await service.excluir(10, autor);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { codigo: 10, usuarioId: 5, status: 'ABERTO' },
      });
    });

    it('retorna 404 quando a solicitação não existe', async () => {
      findSolicitacao.mockResolvedValue(null);

      await expect(service.excluir(99, autor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna 403 quando a solicitação é de outro usuário', async () => {
      findSolicitacao.mockResolvedValue({ ...solicitacaoAberta, usuarioId: 6 });

      await expect(service.excluir(10, autor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it.each(['EM_ATENDIMENTO', 'CONCLUIDO'])(
      'retorna 409 quando o status é %s',
      async (status) => {
        findSolicitacao.mockResolvedValue({ ...solicitacaoAberta, status });

        await expect(service.excluir(10, autor)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(deleteMany).not.toHaveBeenCalled();
      },
    );

    it('retorna 409 quando o status muda entre a checagem e a exclusão', async () => {
      findSolicitacao.mockResolvedValue(solicitacaoAberta);
      deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.excluir(10, autor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('listar', () => {
    const linha = {
      codigo: 1,
      titulo: 'T',
      status: 'ABERTO',
      dataCriacao: new Date(),
      categoria: { id: 1, nome: 'TI' },
      usuario: { id: 5, nome: 'Solicitante Um' },
      historico: [
        { statusNovo: 'ABERTO', dataAlteracao: new Date('2026-09-30T10:00:00Z'), usuario: { id: 5, nome: 'Solicitante Um' } },
      ],
    };

    const whereUsado = () => findMany.mock.calls[0][0].where;

    beforeEach(() => {
      findMany.mockResolvedValue([linha]);
      contar.mockResolvedValue(1);
    });

    it('solicitante só enxerga as próprias e recebe o campo solicitante', async () => {
      const resultado = await service.listar({}, autor);

      expect(whereUsado()).toEqual({ usuarioId: 5 });
      expect(findMany.mock.calls[0][0].orderBy).toEqual([
        { dataCriacao: 'desc' },
        { codigo: 'desc' },
      ]);
      expect(resultado.itens[0]).toMatchObject({
        solicitante: { id: 5, nome: 'Solicitante Um' },
      });
      expect(resultado.itens[0]).not.toHaveProperty('usuario');
    });

    it('chamado só aberto: sem atendente nem conclusão, atualizado na criação', async () => {
      const {
        itens: [item],
      } = await service.listar({}, atendente);

      expect(item.atendente).toBeNull();
      expect(item.dataConclusao).toBeNull();
      expect(item.ultimaAtualizacao).toEqual(new Date('2026-09-30T10:00:00Z'));
      expect(item).not.toHaveProperty('historico');
    });

    it('chamado em atendimento: atendente é quem assumiu e a atualização é a última mudança', async () => {
      findMany.mockResolvedValue([
        {
          ...linha,
          status: 'EM_ATENDIMENTO',
          historico: [
            ...linha.historico,
            { statusNovo: 'EM_ATENDIMENTO', dataAlteracao: new Date('2026-09-30T11:00:00Z'), usuario: { id: 9, nome: 'Atendente Um' } },
          ],
        },
      ]);

      const {
        itens: [item],
      } = await service.listar({}, atendente);

      expect(item.atendente).toEqual({ id: 9, nome: 'Atendente Um' });
      expect(item.ultimaAtualizacao).toEqual(new Date('2026-09-30T11:00:00Z'));
      expect(item.dataConclusao).toBeNull();
    });

    it('chamado concluído: data de conclusão e última atualização coincidem; atendente é quem assumiu', async () => {
      findMany.mockResolvedValue([
        {
          ...linha,
          status: 'CONCLUIDO',
          historico: [
            ...linha.historico,
            { statusNovo: 'EM_ATENDIMENTO', dataAlteracao: new Date('2026-09-30T11:00:00Z'), usuario: { id: 9, nome: 'Atendente Um' } },
            { statusNovo: 'CONCLUIDO', dataAlteracao: new Date('2026-09-30T12:00:00Z'), usuario: { id: 8, nome: 'Atendente Dois' } },
          ],
        },
      ]);

      const {
        itens: [item],
      } = await service.listar({}, atendente);

      expect(item.atendente).toEqual({ id: 9, nome: 'Atendente Um' });
      expect(item.dataConclusao).toEqual(new Date('2026-09-30T12:00:00Z'));
      expect(item.ultimaAtualizacao).toEqual(new Date('2026-09-30T12:00:00Z'));
    });

    it('atendente enxerga todas (sem filtro de usuário)', async () => {
      await service.listar({}, atendente);

      expect(whereUsado()).toEqual({});
    });

    it('aplica status e categoria', async () => {
      await service.listar({ status: ['CONCLUIDO'], categoriaId: 2 }, atendente);

      expect(whereUsado()).toEqual({
        status: { in: ['CONCLUIDO'] },
        categoriaId: 2,
      });
    });

    it('vários status viram um filtro "in" (aberto + em atendimento)', async () => {
      await service.listar({ status: ['ABERTO', 'EM_ATENDIMENTO'] }, atendente);

      expect(whereUsado()).toEqual({
        status: { in: ['ABERTO', 'EM_ATENDIMENTO'] },
      });
      expect(contar).toHaveBeenCalledWith({
        where: { status: { in: ['ABERTO', 'EM_ATENDIMENTO'] } },
      });
    });

    it('lista de status vazia não filtra', async () => {
      await service.listar({ status: [] }, atendente);

      expect(whereUsado()).toEqual({});
    });

    it('sem paginação informada usa a página 1 com 20 itens', async () => {
      const resultado = await service.listar({}, atendente);

      expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
      expect(resultado).toMatchObject({ pagina: 1, tamanho: 20 });
    });

    it('calcula skip e take pela página e pelo tamanho', async () => {
      await service.listar({ pagina: 3, tamanho: 10 }, atendente);

      expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
    });

    it('devolve o envelope com total e totalPaginas', async () => {
      contar.mockResolvedValue(153);

      const resultado = await service.listar({ pagina: 2, tamanho: 20 }, atendente);

      expect(resultado).toMatchObject({
        total: 153,
        pagina: 2,
        tamanho: 20,
        totalPaginas: 8,
      });
      expect(resultado.itens).toHaveLength(1);
    });

    it.each([
      [0, 20, 0],
      [20, 20, 1],
      [21, 20, 2],
      [100, 100, 1],
    ])('total %i com tamanho %i resulta em %i página(s)', async (total, tamanho, esperado) => {
      contar.mockResolvedValue(total);

      const resultado = await service.listar({ tamanho }, atendente);

      expect(resultado.totalPaginas).toBe(esperado);
    });

    it('atendenteId filtra pelos chamados que o atendente assumiu (histórico → EM_ATENDIMENTO)', async () => {
      await service.listar({ atendenteId: 9 }, atendente);

      const esperado = {
        historico: { some: { statusNovo: 'EM_ATENDIMENTO', usuarioId: 9 } },
      };
      expect(whereUsado()).toEqual(esperado);
      // O total conta com o mesmo filtro, senão a paginação mentiria.
      expect(contar).toHaveBeenCalledWith({ where: esperado });
    });

    it('atendenteId combina com status, setor, busca e o escopo do solicitante', async () => {
      await service.listar(
        { atendenteId: 9, status: ['EM_ATENDIMENTO'], categoriaId: 2, q: '12' },
        autor,
      );

      expect(whereUsado()).toMatchObject({
        usuarioId: 5,
        status: { in: ['EM_ATENDIMENTO'] },
        categoriaId: 2,
        historico: { some: { statusNovo: 'EM_ATENDIMENTO', usuarioId: 9 } },
      });
      expect(whereUsado().OR).toBeDefined();
    });

    it('sem atendenteId não toca no histórico', async () => {
      await service.listar({ status: ['ABERTO'] }, atendente);

      expect(whereUsado()).not.toHaveProperty('historico');
    });

    it('o total respeita o escopo do solicitante e os filtros', async () => {
      await service.listar({ status: ['ABERTO'], categoriaId: 2 }, autor);

      expect(contar).toHaveBeenCalledWith({
        where: { usuarioId: 5, status: { in: ['ABERTO'] }, categoriaId: 2 },
      });
      expect(whereUsado()).toEqual({
        usuarioId: 5,
        status: { in: ['ABERTO'] },
        categoriaId: 2,
      });
    });

    it('busca livre procura em título e solicitante, sem diferenciar maiúsculas', async () => {
      await service.listar({ q: 'note' }, atendente);

      const contem = { contains: 'note', mode: 'insensitive' };
      expect(whereUsado()).toEqual({
        OR: [
          { titulo: contem },
          { usuario: { nome: contem } },
          { usuario: { usuario: contem } },
        ],
      });
    });

    it('busca livre numérica também procura pelo código', async () => {
      await service.listar({ q: '12' }, atendente);

      expect(whereUsado().OR).toContainEqual({ codigo: 12 });
    });

    it('busca livre numérica grande demais não filtra por código', async () => {
      await service.listar({ q: '99999999999' }, atendente);

      expect(whereUsado().OR).not.toContainEqual({ codigo: expect.anything() });
    });

    it('busca livre vazia é ignorada', async () => {
      await service.listar({ q: '' }, atendente);

      expect(whereUsado()).toEqual({});
    });

    it('busca livre combina com o escopo do solicitante', async () => {
      await service.listar({ q: 'x' }, autor);

      expect(whereUsado()).toMatchObject({ usuarioId: 5 });
      expect(whereUsado().OR).toBeDefined();
    });

    it('período: dataFim é inclusiva (até o fim do dia)', async () => {
      await service.listar(
        { dataInicio: '2026-09-01', dataFim: '2026-09-30' },
        atendente,
      );

      expect(whereUsado().dataCriacao).toEqual({
        gte: new Date('2026-09-01T00:00:00.000Z'),
        lt: new Date('2026-10-01T00:00:00.000Z'),
      });
    });

    it('período aceita apenas um dos limites', async () => {
      await service.listar({ dataInicio: '2026-09-01' }, atendente);

      expect(whereUsado().dataCriacao).toEqual({
        gte: new Date('2026-09-01T00:00:00.000Z'),
      });
    });

    it('rejeita dataInicio maior que dataFim', async () => {
      await expect(
        service.listar({ dataInicio: '2026-09-30', dataFim: '2026-09-01' }, atendente),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('rejeita data inexistente', async () => {
      await expect(
        service.listar({ dataInicio: '2026-13-45' }, atendente),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('consultar', () => {
    const detalhe = {
      codigo: 10,
      usuarioId: 5,
      usuario: { id: 5, nome: 'Solicitante Um', usuario: 'solicitante.um' },
      historico: [],
    };

    it('retorna 404 quando não existe', async () => {
      findSolicitacao.mockResolvedValue(null);

      await expect(service.consultar(99, autor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('solicitante consulta a própria e recebe histórico e solicitante', async () => {
      findSolicitacao.mockResolvedValue(detalhe);

      const resultado = await service.consultar(10, autor);

      expect(resultado).toMatchObject({
        codigo: 10,
        solicitante: { id: 5, usuario: 'solicitante.um' },
        historico: [],
      });
      expect(resultado).not.toHaveProperty('usuario');
    });

    it('solicitante não consulta solicitação de outro (403)', async () => {
      findSolicitacao.mockResolvedValue({ ...detalhe, usuarioId: 6 });

      await expect(service.consultar(10, autor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('atendente consulta qualquer solicitação', async () => {
      findSolicitacao.mockResolvedValue({ ...detalhe, usuarioId: 6 });

      await expect(service.consultar(10, atendente)).resolves.toMatchObject({
        codigo: 10,
      });
    });
  });

  describe('alterarStatus', () => {
    it.each([
      ['ABERTO', 'EM_ATENDIMENTO'],
      ['EM_ATENDIMENTO', 'CONCLUIDO'],
    ])('avança de %s para %s e grava o histórico', async (atual, novo) => {
      findSolicitacao.mockResolvedValue({ ...solicitacaoAberta, status: atual });
      updateMany.mockResolvedValue({ count: 1 });
      findSolicitacaoOrThrow.mockResolvedValue({ codigo: 10, status: novo });

      const resultado = await service.alterarStatus(
        10,
        { status: novo as never },
        atendente,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { codigo: 10, status: atual },
        data: { status: novo },
      });
      expect(criarHistorico).toHaveBeenCalledWith({
        data: {
          solicitacaoCodigo: 10,
          usuarioId: 9,
          statusAnterior: atual,
          statusNovo: novo,
        },
      });
      expect(resultado).toEqual({ codigo: 10, status: novo });
    });

    it.each([
      ['ABERTO', 'CONCLUIDO'],
      ['ABERTO', 'ABERTO'],
      ['EM_ATENDIMENTO', 'ABERTO'],
      ['EM_ATENDIMENTO', 'EM_ATENDIMENTO'],
    ])('rejeita a transição %s → %s com 409', async (atual, novo) => {
      findSolicitacao.mockResolvedValue({ ...solicitacaoAberta, status: atual });

      await expect(
        service.alterarStatus(10, { status: novo as never }, atendente),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(updateMany).not.toHaveBeenCalled();
      expect(criarHistorico).not.toHaveBeenCalled();
    });

    it.each(['ABERTO', 'EM_ATENDIMENTO', 'CONCLUIDO'])(
      'solicitação CONCLUIDO não aceita mudança para %s',
      async (novo) => {
        findSolicitacao.mockResolvedValue({
          ...solicitacaoAberta,
          status: 'CONCLUIDO',
        });

        await expect(
          service.alterarStatus(10, { status: novo as never }, atendente),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(criarHistorico).not.toHaveBeenCalled();
      },
    );

    it('retorna 404 quando a solicitação não existe', async () => {
      findSolicitacao.mockResolvedValue(null);

      await expect(
        service.alterarStatus(99, { status: 'EM_ATENDIMENTO' }, atendente),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retorna 409 sem gravar histórico quando outro atendente chegou primeiro', async () => {
      findSolicitacao.mockResolvedValue(solicitacaoAberta);
      updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.alterarStatus(10, { status: 'EM_ATENDIMENTO' }, atendente),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(criarHistorico).not.toHaveBeenCalled();
    });
  });
});
