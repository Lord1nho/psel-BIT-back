import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StatusSolicitacao } from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';
import type { EditarSolicitacaoDto } from './dto/editar-solicitacao.dto.js';

const MSG_SOMENTE_ABERTO =
  'Só é possível alterar solicitações com status ABERTO';

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

  private async validarCategoriaAtiva(categoriaId: number) {
    const categoria = await this.prisma.categoria.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria || !categoria.ativa) {
      throw new BadRequestException('Categoria inexistente ou inativa');
    }
  }

  private async validarAutoriaEStatus(
    codigo: number,
    autor: UsuarioAutenticado,
  ) {
    const solicitacao = await this.prisma.solicitacao.findUnique({
      where: { codigo },
    });
    if (!solicitacao) throw new NotFoundException('Solicitação não encontrada');
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
