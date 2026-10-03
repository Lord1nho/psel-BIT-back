import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ComentariosService } from './comentarios.service.js';

describe('ComentariosService', () => {
  const findChamado = vi.fn();
  const updateMany = vi.fn();
  const criarHistorico = vi.fn();
  const criarComentario = vi.fn();
  const listarComentarios = vi.fn();
  const contar = vi.fn();
  const buscarComentario = vi.fn();
  const atualizarComentario = vi.fn();
  const criarRevisao = vi.fn();
  let service: ComentariosService;

  const solicitante = { id: 5, usuario: 'solicitante.um', perfil: 'SOLICITANTE' } as const;
  const outroSolicitante = { id: 6, usuario: 'solicitante.dois', perfil: 'SOLICITANTE' } as const;
  const atendente = { id: 9, usuario: 'atendente.um', perfil: 'ATENDENTE' } as const;
  const outroAtendente = { id: 8, usuario: 'atendente.dois', perfil: 'ATENDENTE' } as const;
  const dono = { id: 9, nome: 'Atendente Um' };

  const aberto = { usuarioId: 5, status: 'ABERTO', historico: [] };
  const emAtendimento = { usuarioId: 5, status: 'EM_ATENDIMENTO', historico: [{ usuario: dono }] };
  const concluido = { usuarioId: 5, status: 'CONCLUIDO', historico: [{ usuario: dono }] };

  const gravado = {
    id: 1,
    texto: 'Olá',
    dataCriacao: new Date(),
    dataEdicao: null,
    usuario: { id: 9, nome: 'Atendente Um', perfil: 'ATENDENTE' },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    criarComentario.mockResolvedValue(gravado);
    const solicitacao = { findUnique: findChamado, updateMany };
    const historicoSolicitacao = { create: criarHistorico };
    const comentario = {
      create: criarComentario,
      findMany: listarComentarios,
      count: contar,
      findFirst: buscarComentario,
      update: atualizarComentario,
    };
    const comentarioRevisao = { create: criarRevisao };
    service = new ComentariosService({
      solicitacao,
      historicoSolicitacao,
      comentario,
      comentarioRevisao,
      $transaction: (cb: (tx: unknown) => unknown) =>
        cb({ solicitacao, historicoSolicitacao, comentario, comentarioRevisao }),
    } as never);
  });

  describe('listar', () => {
    it('404 quando o chamado não existe', async () => {
      findChamado.mockResolvedValue(null);

      await expect(service.listar(99, {}, atendente)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('solicitante não lê comentários de chamado alheio (403)', async () => {
      findChamado.mockResolvedValue(aberto);

      await expect(
        service.listar(10, {}, outroSolicitante),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('qualquer atendente lê, mesmo com outro responsável', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      listarComentarios.mockResolvedValue([]);
      contar.mockResolvedValue(0);

      await expect(service.listar(10, {}, outroAtendente)).resolves.toBeDefined();
    });

    it('devolve em ordem, com "autor", total e o cursor do último item', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      listarComentarios.mockResolvedValue([
        { ...gravado, id: 4 },
        { ...gravado, id: 7 },
      ]);
      contar.mockResolvedValue(9);

      const resultado = await service.listar(10, {}, solicitante);

      expect(listarComentarios).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { solicitacaoCodigo: 10, excluidoEm: null },
          orderBy: { id: 'asc' },
          take: 50,
        }),
      );
      expect(resultado.total).toBe(9);
      expect(resultado.proxComentario).toBe(7);
      expect(resultado.itens[0]).toHaveProperty('autor');
      expect(resultado.itens[0]).not.toHaveProperty('usuario');
    });

    it('o total e a lista ignoram os comentários excluídos', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      listarComentarios.mockResolvedValue([]);
      contar.mockResolvedValue(0);

      await service.listar(10, {}, solicitante);

      expect(contar).toHaveBeenCalledWith({
        where: { solicitacaoCodigo: 10, excluidoEm: null },
      });
    });

    it('com proxComentario busca só os posteriores e respeita o limite', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      listarComentarios.mockResolvedValue([]);
      contar.mockResolvedValue(3);

      const resultado = await service.listar(
        10,
        { proxComentario: 42, limite: 10 },
        solicitante,
      );

      expect(listarComentarios).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { solicitacaoCodigo: 10, excluidoEm: null, id: { gt: 42 } },
          take: 10,
        }),
      );
      // Sem novidade, repete o cursor recebido.
      expect(resultado).toMatchObject({ itens: [], proxComentario: 42 });
    });

    it('sem comentários e sem cursor, o cursor é null', async () => {
      findChamado.mockResolvedValue(aberto);
      listarComentarios.mockResolvedValue([]);
      contar.mockResolvedValue(0);

      const resultado = await service.listar(10, {}, solicitante);

      expect(resultado.proxComentario).toBeNull();
    });
  });

  describe('criar', () => {
    it('404 quando o chamado não existe', async () => {
      findChamado.mockResolvedValue(null);

      await expect(
        service.criar(99, { texto: 'Oi' }, solicitante),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('solicitante comenta no próprio chamado, sem mexer no status', async () => {
      findChamado.mockResolvedValue(aberto);

      await service.criar(10, { texto: 'Mais detalhes' }, solicitante);

      expect(criarComentario).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { solicitacaoCodigo: 10, usuarioId: 5, texto: 'Mais detalhes' },
        }),
      );
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('outro solicitante não comenta em chamado alheio (403)', async () => {
      findChamado.mockResolvedValue(aberto);

      await expect(
        service.criar(10, { texto: 'Oi' }, outroSolicitante),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(criarComentario).not.toHaveBeenCalled();
    });

    it('chamado concluído é somente leitura (409), para qualquer perfil', async () => {
      findChamado.mockResolvedValue(concluido);

      await expect(
        service.criar(10, { texto: 'Oi' }, solicitante),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.criar(10, { texto: 'Oi' }, atendente),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(criarComentario).not.toHaveBeenCalled();
    });

    describe('atendente em chamado ABERTO', () => {
      it('assume o chamado (status + histórico) e comenta na mesma transação', async () => {
        findChamado.mockResolvedValue(aberto);
        updateMany.mockResolvedValue({ count: 1 });

        await service.criar(10, { texto: 'Vou ajudar' }, atendente);

        expect(updateMany).toHaveBeenCalledWith({
          where: { codigo: 10, status: 'ABERTO' },
          data: { status: 'EM_ATENDIMENTO' },
        });
        expect(criarHistorico).toHaveBeenCalledWith({
          data: {
            solicitacaoCodigo: 10,
            usuarioId: 9,
            statusAnterior: 'ABERTO',
            statusNovo: 'EM_ATENDIMENTO',
          },
        });
        expect(criarComentario).toHaveBeenCalledTimes(1);
      });

      it('perdeu a corrida para outro atendente: 409 e nada é gravado', async () => {
        findChamado
          .mockResolvedValueOnce(aberto)
          .mockResolvedValueOnce({
            ...emAtendimento,
            historico: [{ usuario: { id: 8, nome: 'Atendente Dois' } }],
          });
        updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.criar(10, { texto: 'Oi' }, atendente),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(criarComentario).not.toHaveBeenCalled();
        expect(criarHistorico).not.toHaveBeenCalled();
      });

      it('duplo envio do mesmo atendente: quem já assumiu continua e comenta', async () => {
        findChamado
          .mockResolvedValueOnce(aberto)
          .mockResolvedValueOnce(emAtendimento);
        updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.criar(10, { texto: 'Oi' }, atendente),
        ).resolves.toBeDefined();
        expect(criarComentario).toHaveBeenCalledTimes(1);
      });
    });

    describe('atendente em chamado EM_ATENDIMENTO', () => {
      it('o responsável comenta', async () => {
        findChamado.mockResolvedValue(emAtendimento);

        await expect(
          service.criar(10, { texto: 'Atualização' }, atendente),
        ).resolves.toBeDefined();
        expect(updateMany).not.toHaveBeenCalled();
      });

      it('outro atendente não comenta (403 com o nome do responsável)', async () => {
        findChamado.mockResolvedValue(emAtendimento);

        const erro = await service
          .criar(10, { texto: 'Oi' }, outroAtendente)
          .catch((e: unknown) => e);

        expect(erro).toBeInstanceOf(ForbiddenException);
        expect((erro as Error).message).toContain('Atendente Um');
        expect(criarComentario).not.toHaveBeenCalled();
      });
    });
  });

  describe('editar', () => {
    const meu = { usuarioId: 9, texto: 'Texto original' };

    it('autor edita, a data de edição é preenchida e o texto anterior vira revisão', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      buscarComentario.mockResolvedValue(meu);
      atualizarComentario.mockResolvedValue(gravado);

      await service.editar(10, 1, { texto: 'Corrigido' }, atendente);

      // Excluídos não são editáveis: a busca ignora quem tem excluidoEm.
      expect(buscarComentario).toHaveBeenCalledWith({
        where: { id: 1, solicitacaoCodigo: 10, excluidoEm: null },
        select: { usuarioId: true, texto: true },
      });
      expect(criarRevisao).toHaveBeenCalledWith({
        data: { comentarioId: 1, textoAnterior: 'Texto original', editadoPorId: 9 },
      });
      expect(atualizarComentario).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { texto: 'Corrigido', dataEdicao: expect.any(Date) },
        }),
      );
    });

    it('comentário que não é do chamado informado: 404', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      buscarComentario.mockResolvedValue(null);

      await expect(
        service.editar(10, 1, { texto: 'x' }, atendente),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('só o autor edita (403)', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      buscarComentario.mockResolvedValue({ usuarioId: 5, texto: 'do solicitante' });

      await expect(
        service.editar(10, 1, { texto: 'x' }, atendente),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(atualizarComentario).not.toHaveBeenCalled();
      expect(criarRevisao).not.toHaveBeenCalled();
    });

    it('chamado concluído: 409', async () => {
      findChamado.mockResolvedValue(concluido);
      buscarComentario.mockResolvedValue(meu);

      await expect(
        service.editar(10, 1, { texto: 'x' }, atendente),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(atualizarComentario).not.toHaveBeenCalled();
      expect(criarRevisao).not.toHaveBeenCalled();
    });
  });

  describe('excluir', () => {
    it('autor exclui o próprio comentário: exclusão lógica com quem e quando', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      buscarComentario.mockResolvedValue({ usuarioId: 5, texto: 'x' });

      await service.excluir(10, 1, solicitante);

      expect(atualizarComentario).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { excluidoEm: expect.any(Date), excluidoPorId: 5 },
      });
    });

    it('comentário já excluído é tratado como inexistente (404)', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      buscarComentario.mockResolvedValue(null);

      await expect(service.excluir(10, 1, solicitante)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(atualizarComentario).not.toHaveBeenCalled();
    });

    it('só o autor exclui (403)', async () => {
      findChamado.mockResolvedValue(emAtendimento);
      buscarComentario.mockResolvedValue({ usuarioId: 9, texto: 'x' });

      await expect(service.excluir(10, 1, solicitante)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(atualizarComentario).not.toHaveBeenCalled();
    });

    it('chamado concluído: 409', async () => {
      findChamado.mockResolvedValue(concluido);
      buscarComentario.mockResolvedValue({ usuarioId: 5, texto: 'x' });

      await expect(service.excluir(10, 1, solicitante)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(atualizarComentario).not.toHaveBeenCalled();
    });

    it('solicitante de chamado alheio nem chega ao comentário (403)', async () => {
      findChamado.mockResolvedValue(aberto);

      await expect(
        service.excluir(10, 1, outroSolicitante),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(buscarComentario).not.toHaveBeenCalled();
    });
  });
});
