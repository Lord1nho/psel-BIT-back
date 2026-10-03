import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfilUsuario, StatusSolicitacao } from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ASSUNCAO, gravarTransicao } from '../solicitacoes/assuncao.js';
import type { CriarComentarioDto } from './dto/criar-comentario.dto.js';
import type { EditarComentarioDto } from './dto/editar-comentario.dto.js';
import {
  LIMITE_PADRAO,
  type FiltrarComentariosDto,
} from './dto/filtrar-comentarios.dto.js';

const MSG_CONCLUIDO =
  'A solicitação está concluída: os comentários ficam somente para leitura';

const SELECAO_COMENTARIO = {
  id: true,
  texto: true,
  dataCriacao: true,
  dataEdicao: true,
  usuario: { select: { id: true, nome: true, perfil: true } },
} as const;

// A API expõe quem escreveu como "autor".
function formatar<T extends { usuario: unknown }>({ usuario, ...resto }: T) {
  return { ...resto, autor: usuario };
}

@Injectable()
export class ComentariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    codigo: number,
    { proxComentario, limite }: FiltrarComentariosDto,
    usuario: UsuarioAutenticado,
  ) {
    await this.carregarChamado(codigo, usuario);

    const [itens, total] = await Promise.all([
      this.prisma.comentario.findMany({
        where: {
          solicitacaoCodigo: codigo,
          excluidoEm: null,
          ...(proxComentario && { id: { gt: proxComentario } }),
        },
        orderBy: { id: 'asc' },
        take: limite ?? LIMITE_PADRAO,
        select: SELECAO_COMENTARIO,
      }),
      this.prisma.comentario.count({
        where: { solicitacaoCodigo: codigo, excluidoEm: null },
      }),
    ]);

    return {
      itens: itens.map(formatar),
      total,
      // Cursor para a próxima chamada; sem itens novos, repete o que o front mandou.
      proxComentario: itens.at(-1)?.id ?? proxComentario ?? null,
    };
  }

  async criar(
    codigo: number,
    { texto }: CriarComentarioDto,
    usuario: UsuarioAutenticado,
  ) {
    const chamado = await this.carregarChamado(codigo, usuario);
    if (chamado.status === StatusSolicitacao.CONCLUIDO) {
      throw new ConflictException(MSG_CONCLUIDO);
    }

    const inserir = (cliente: Pick<PrismaService, 'comentario'>) =>
      cliente.comentario
        .create({
          data: { solicitacaoCodigo: codigo, usuarioId: usuario.id, texto },
          select: SELECAO_COMENTARIO,
        })
        .then(formatar);

    // Só o solicitante dono e o atendente responsável escrevem (o dono já foi conferido).
    if (usuario.perfil === PerfilUsuario.SOLICITANTE) {
      return inserir(this.prisma);
    }

    if (chamado.status === StatusSolicitacao.ABERTO) {
      // Comentar num chamado aberto assume o chamado (o primeiro atendente vence).
      try {
        return await this.prisma.$transaction(async (tx) => {
          await gravarTransicao(
            tx,
            codigo,
            StatusSolicitacao.ABERTO,
            StatusSolicitacao.EM_ATENDIMENTO,
            usuario,
            false,
          );
          return inserir(tx);
        });
      } catch (erro) {
        if (!(erro instanceof ConflictException)) throw erro;
        // Perdeu a corrida: se quem assumiu foi o próprio atendente (duplo envio), segue.
        const atual = await this.carregarChamado(codigo, usuario);
        if (
          atual.status === StatusSolicitacao.EM_ATENDIMENTO &&
          atual.dono?.id === usuario.id
        ) {
          return inserir(this.prisma);
        }
        throw erro;
      }
    }

    if (chamado.dono && chamado.dono.id !== usuario.id) {
      throw new ForbiddenException(
        `Somente o atendente responsável (${chamado.dono.nome}) pode comentar neste chamado`,
      );
    }
    return inserir(this.prisma);
  }

  async editar(
    codigo: number,
    comentarioId: number,
    { texto }: EditarComentarioDto,
    usuario: UsuarioAutenticado,
  ) {
    const chamado = await this.carregarChamado(codigo, usuario);
    const atual = await this.exigirAutor(codigo, comentarioId, usuario);
    if (chamado.status === StatusSolicitacao.CONCLUIDO) {
      throw new ConflictException(MSG_CONCLUIDO);
    }

    // Auditoria: o texto que valia antes fica numa revisão, gravada junto com a edição.
    return this.prisma.$transaction(async (tx) => {
      await tx.comentarioRevisao.create({
        data: {
          comentarioId,
          textoAnterior: atual.texto,
          editadoPorId: usuario.id,
        },
      });
      return tx.comentario
        .update({
          where: { id: comentarioId },
          data: { texto, dataEdicao: new Date() },
          select: SELECAO_COMENTARIO,
        })
        .then(formatar);
    });
  }

  async excluir(
    codigo: number,
    comentarioId: number,
    usuario: UsuarioAutenticado,
  ) {
    const chamado = await this.carregarChamado(codigo, usuario);
    await this.exigirAutor(codigo, comentarioId, usuario);
    if (chamado.status === StatusSolicitacao.CONCLUIDO) {
      throw new ConflictException(MSG_CONCLUIDO);
    }

    // Exclusão lógica: some da API, mas texto, autor, data e quem excluiu ficam no banco.
    await this.prisma.comentario.update({
      where: { id: comentarioId },
      data: { excluidoEm: new Date(), excluidoPorId: usuario.id },
    });
  }

  // 404 se o chamado não existe; 403 se um solicitante tenta acessar chamado alheio.
  private async carregarChamado(codigo: number, usuario: UsuarioAutenticado) {
    const chamado = await this.prisma.solicitacao.findUnique({
      where: { codigo },
      select: { status: true, usuarioId: true, historico: ASSUNCAO },
    });
    if (!chamado) throw new NotFoundException('Solicitação não encontrada');
    if (
      usuario.perfil === PerfilUsuario.SOLICITANTE &&
      chamado.usuarioId !== usuario.id
    ) {
      throw new ForbiddenException(
        'Você só pode acessar os comentários das suas próprias solicitações',
      );
    }
    return {
      status: chamado.status,
      dono: chamado.historico[0]?.usuario ?? null,
    };
  }

  private async exigirAutor(
    codigo: number,
    comentarioId: number,
    usuario: UsuarioAutenticado,
  ) {
    const comentario = await this.prisma.comentario.findFirst({
      where: { id: comentarioId, solicitacaoCodigo: codigo, excluidoEm: null },
      select: { usuarioId: true, texto: true },
    });
    if (!comentario) throw new NotFoundException('Comentário não encontrado');
    if (comentario.usuarioId !== usuario.id) {
      throw new ForbiddenException(
        'Você só pode alterar os seus próprios comentários',
      );
    }
    return comentario;
  }
}
