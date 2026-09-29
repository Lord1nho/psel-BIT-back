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
  let service: SolicitacoesService;

  const autor = { id: 5, usuario: 'solicitante.um', perfil: 'SOLICITANTE' } as const;
  const dto = { titulo: 'Notebook lento', descricao: 'Trava no Excel', categoriaId: 1 };
  const solicitacaoAberta = { codigo: 10, usuarioId: 5, status: 'ABERTO' };

  beforeEach(() => {
    vi.resetAllMocks();
    service = new SolicitacoesService({
      categoria: { findUnique: findCategoria },
      solicitacao: {
        create: createSolicitacao,
        findUnique: findSolicitacao,
        findUniqueOrThrow: findSolicitacaoOrThrow,
        updateMany,
        deleteMany,
      },
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
});
