import { BadRequestException } from '@nestjs/common';
import { SolicitacoesService } from './solicitacoes.service.js';

describe('SolicitacoesService', () => {
  const findCategoria = vi.fn();
  const createSolicitacao = vi.fn();
  let service: SolicitacoesService;

  const autor = { id: 5, usuario: 'solicitante.um', perfil: 'SOLICITANTE' } as const;
  const dto = { titulo: 'Notebook lento', descricao: 'Trava no Excel', categoriaId: 1 };

  beforeEach(() => {
    findCategoria.mockReset();
    createSolicitacao.mockReset();
    service = new SolicitacoesService({
      categoria: { findUnique: findCategoria },
      solicitacao: { create: createSolicitacao },
    } as never);
  });

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
