import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PerfilUsuario,
  Prisma,
  StatusSolicitacao,
} from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AlterarStatusDto } from './dto/alterar-status.dto.js';
import type { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';
import type { EditarSolicitacaoDto } from './dto/editar-solicitacao.dto.js';
import type { FiltrarSolicitacoesDto } from './dto/filtrar-solicitacoes.dto.js';

const MSG_SOMENTE_ABERTO =
  'Só é possível alterar solicitações com status ABERTO';

// Fluxo estritamente sequencial: ABERTO → EM_ATENDIMENTO → CONCLUIDO.
const PROXIMO_STATUS: Partial<Record<StatusSolicitacao, StatusSolicitacao>> = {
  [StatusSolicitacao.ABERTO]: StatusSolicitacao.EM_ATENDIMENTO,
  [StatusSolicitacao.EM_ATENDIMENTO]: StatusSolicitacao.CONCLUIDO,
};

const UM_DIA_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SolicitacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarSolicitacaoDto, autor: UsuarioAutenticado) {
    await this.validarCategoriaAtiva(dto.categoriaId);

    // Escrita aninhada: o Prisma grava solicitação e histórico numa única transação.
    return this.prisma.solicitacao.create({
      data: {
        titulo: dto.titulo,
        descricao: dto.descricao,
        categoriaId: dto.categoriaId,
        usuarioId: autor.id,
        status: StatusSolicitacao.ABERTO,
        historico: {
          create: {
            usuarioId: autor.id,
            statusAnterior: null,
            statusNovo: StatusSolicitacao.ABERTO,
          },
        },
      },
      include: { categoria: true },
    });
  }

  async listar(filtros: FiltrarSolicitacoesDto, usuario: UsuarioAutenticado) {
    const where: Prisma.SolicitacaoWhereInput = {};

    // O escopo vem do token: solicitante nunca enxerga solicitações alheias.
    if (usuario.perfil === PerfilUsuario.SOLICITANTE) {
      where.usuarioId = usuario.id;
    }
    if (filtros.status) where.status = filtros.status;
    if (filtros.categoriaId) where.categoriaId = filtros.categoriaId;
    if (filtros.q) where.OR = this.montarBuscaLivre(filtros.q);

    const periodo = this.montarPeriodo(filtros.dataInicio, filtros.dataFim);
    if (periodo) where.dataCriacao = periodo;

    const solicitacoes = await this.prisma.solicitacao.findMany({
      where,
      orderBy: { dataCriacao: 'desc' },
      select: {
        codigo: true,
        titulo: true,
        status: true,
        dataCriacao: true,
        categoria: { select: { id: true, nome: true } },
        usuario: { select: { id: true, nome: true } },
        // No máximo 3 linhas por solicitação; só serve para derivar as colunas abaixo.
        historico: {
          orderBy: [{ dataAlteracao: 'asc' }, { id: 'asc' }],
          select: {
            statusNovo: true,
            dataAlteracao: true,
            usuario: { select: { id: true, nome: true } },
          },
        },
      },
    });

    return solicitacoes.map(
      ({ usuario: solicitante, historico, ...resto }) => ({
        ...resto,
        solicitante,
        // Quem assumiu o chamado (ABERTO → EM_ATENDIMENTO); null se ainda não assumido.
        atendente:
          historico.find((h) => h.statusNovo === StatusSolicitacao.EM_ATENDIMENTO)
            ?.usuario ?? null,
        // Última mudança de status (edição de título/descrição não conta).
        ultimaAtualizacao:
          historico.at(-1)?.dataAlteracao ?? resto.dataCriacao,
        dataConclusao:
          historico.find((h) => h.statusNovo === StatusSolicitacao.CONCLUIDO)
            ?.dataAlteracao ?? null,
      }),
    );
  }

  async consultar(codigo: number, usuario: UsuarioAutenticado) {
    const solicitacao = await this.prisma.solicitacao.findUnique({
      where: { codigo },
      include: {
        categoria: true,
        usuario: { select: { id: true, nome: true, usuario: true } },
        historico: {
          orderBy: { dataAlteracao: 'asc' },
          select: {
            statusAnterior: true,
            statusNovo: true,
            dataAlteracao: true,
            usuario: { select: { id: true, nome: true } },
          },
        },
      },
    });
    if (!solicitacao) throw new NotFoundException('Solicitação não encontrada');
    if (
      usuario.perfil === PerfilUsuario.SOLICITANTE &&
      solicitacao.usuarioId !== usuario.id
    ) {
      throw new ForbiddenException(
        'Você só pode consultar as suas próprias solicitações',
      );
    }

    const { usuario: solicitante, ...resto } = solicitacao;
    return { ...resto, solicitante };
  }

  async editar(
    codigo: number,
    dto: EditarSolicitacaoDto,
    autor: UsuarioAutenticado,
  ) {
    const { titulo, descricao, categoriaId } = dto;
    if (
      titulo === undefined &&
      descricao === undefined &&
      categoriaId === undefined
    ) {
      throw new BadRequestException('Informe ao menos um campo para editar');
    }

    await this.validarAutoriaEStatus(codigo, autor);
    if (categoriaId !== undefined) {
      await this.validarCategoriaAtiva(categoriaId);
    }

    // O filtro por status na escrita garante que um chamado que mudou de status
    // entre a checagem e o update nunca seja editado.
    const { count } = await this.prisma.solicitacao.updateMany({
      where: { codigo, usuarioId: autor.id, status: StatusSolicitacao.ABERTO },
      data: { titulo, descricao, categoriaId },
    });
    if (count === 0) throw new ConflictException(MSG_SOMENTE_ABERTO);

    return this.prisma.solicitacao.findUniqueOrThrow({
      where: { codigo },
      include: { categoria: true },
    });
  }

  async excluir(codigo: number, autor: UsuarioAutenticado): Promise<void> {
    await this.validarAutoriaEStatus(codigo, autor);

    // O histórico é removido em cascata (ON DELETE CASCADE).
    const { count } = await this.prisma.solicitacao.deleteMany({
      where: { codigo, usuarioId: autor.id, status: StatusSolicitacao.ABERTO },
    });
    if (count === 0) throw new ConflictException(MSG_SOMENTE_ABERTO);
  }

  async alterarStatus(
    codigo: number,
    { status: novo }: AlterarStatusDto,
    atendente: UsuarioAutenticado,
  ) {
    const { status: atual } = await this.buscarOuFalhar(codigo);

    const permitido = PROXIMO_STATUS[atual];
    if (!permitido) {
      throw new ConflictException('A solicitação já está concluída');
    }
    if (novo !== permitido) {
      throw new ConflictException(
        `De ${atual} só é possível ir para ${permitido}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Se outro atendente mudou o status antes, nada é gravado.
      const { count } = await tx.solicitacao.updateMany({
        where: { codigo, status: atual },
        data: { status: novo },
      });
      if (count === 0) {
        throw new ConflictException(
          'O status da solicitação foi alterado por outro atendente',
        );
      }

      await tx.historicoSolicitacao.create({
        data: {
          solicitacaoCodigo: codigo,
          usuarioId: atendente.id,
          statusAnterior: atual,
          statusNovo: novo,
        },
      });

      return tx.solicitacao.findUniqueOrThrow({
        where: { codigo },
        include: { categoria: true },
      });
    });
  }

  private montarBuscaLivre(q: string): Prisma.SolicitacaoWhereInput[] {
    const contem = { contains: q, mode: 'insensitive' as const };
    const condicoes: Prisma.SolicitacaoWhereInput[] = [
      { titulo: contem },
      { usuario: { nome: contem } },
      { usuario: { usuario: contem } },
    ];
    // `codigo` é Int (32 bits): só busca por código quando cabe no tipo.
    if (/^\d{1,9}$/.test(q)) condicoes.push({ codigo: Number(q) });
    return condicoes;
  }

  private montarPeriodo(dataInicio?: string, dataFim?: string) {
    if (!dataInicio && !dataFim) return undefined;

    const inicio = dataInicio ? new Date(`${dataInicio}T00:00:00.000Z`) : undefined;
    const fim = dataFim ? new Date(`${dataFim}T00:00:00.000Z`) : undefined;
    if (
      (inicio && Number.isNaN(inicio.getTime())) ||
      (fim && Number.isNaN(fim.getTime()))
    ) {
      throw new BadRequestException('Data inválida no filtro de período');
    }
    if (inicio && fim && inicio > fim) {
      throw new BadRequestException('dataInicio não pode ser maior que dataFim');
    }

    // dataFim é inclusiva: vale até o fim daquele dia (UTC).
    return {
      ...(inicio && { gte: inicio }),
      ...(fim && { lt: new Date(fim.getTime() + UM_DIA_MS) }),
    };
  }

  private async validarCategoriaAtiva(categoriaId: number) {
    const categoria = await this.prisma.categoria.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria || !categoria.ativa) {
      throw new BadRequestException('Categoria inexistente ou inativa');
    }
  }

  private async buscarOuFalhar(codigo: number) {
    const solicitacao = await this.prisma.solicitacao.findUnique({
      where: { codigo },
    });
    if (!solicitacao) throw new NotFoundException('Solicitação não encontrada');
    return solicitacao;
  }

  private async validarAutoriaEStatus(
    codigo: number,
    autor: UsuarioAutenticado,
  ) {
    const solicitacao = await this.buscarOuFalhar(codigo);
    if (solicitacao.usuarioId !== autor.id) {
      throw new ForbiddenException(
        'Somente o autor pode alterar a solicitação',
      );
    }
    if (solicitacao.status !== StatusSolicitacao.ABERTO) {
      throw new ConflictException(MSG_SOMENTE_ABERTO);
    }
  }
}
