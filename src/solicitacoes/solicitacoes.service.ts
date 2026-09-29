import { BadRequestException, Injectable } from '@nestjs/common';
import { StatusSolicitacao } from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';

@Injectable()
export class SolicitacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarSolicitacaoDto, autor: UsuarioAutenticado) {
    const categoria = await this.prisma.categoria.findUnique({
      where: { id: dto.categoriaId },
    });
    if (!categoria || !categoria.ativa) {
      throw new BadRequestException('Categoria inexistente ou inativa');
    }

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
}
