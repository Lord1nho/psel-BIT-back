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
import { escaparCuringasLike } from '../common/validacao/like.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ASSUNCAO, gravarTransicao } from './assuncao.js';
import type { AlterarStatusDto } from './dto/alterar-status.dto.js';
import type { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';
import type { EditarSolicitacaoDto } from './dto/editar-solicitacao.dto.js';
import {
  TAMANHO_PADRAO,
  type FiltrarSolicitacoesDto,
} from './dto/filtrar-solicitacoes.dto.js';

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
    if (filtros.status?.length) where.status = { in: filtros.status };
    if (filtros.categoriaId) where.categoriaId = filtros.categoriaId;
    const filtroAtendente = this.filtrarPorAtendente(filtros, usuario);
    if (filtroAtendente) where.historico = filtroAtendente;
    if (filtros.q) where.OR = this.montarBuscaLivre(filtros.q);

    const periodo = this.montarPeriodo(filtros.dataInicio, filtros.dataFim);
    if (periodo) where.dataCriacao = periodo;

    const pagina = filtros.pagina ?? 1;
    const tamanho = filtros.tamanho ?? TAMANHO_PADRAO;

    // Cada página lê só as próprias linhas (take/skip); o count devolve apenas o total
    // com os mesmos filtros e escopo, para montar a paginação. As duas consultas rodam
    // em paralelo (conexões distintas do pool): uma transação em lista não daria um
    // instantâneo único em read committed e faz o driver pg avisar de consultas concorrentes.
    const [total, solicitacoes] = await Promise.all([
      this.prisma.solicitacao.count({ where }),
      this.prisma.solicitacao.findMany({
        where,
        // O código desempata datas iguais: a ordem entre páginas fica estável.
        orderBy: [{ dataCriacao: 'desc' }, { codigo: 'desc' }],
        skip: (pagina - 1) * tamanho,
        take: tamanho,
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
      }),
    ]);

    const itens = solicitacoes.map(
      ({ usuario: solicitante, historico, ...resto }) => ({
        ...resto,
        solicitante,
        // Quem assumiu o chamado (ABERTO → EM_ATENDIMENTO); null se ainda não assumido.
        atendente:
          historico.find(
            (h) => h.statusNovo === StatusSolicitacao.EM_ATENDIMENTO,
          )?.usuario ?? null,
        // Última mudança de status (edição de título/descrição não conta).
        ultimaAtualizacao: historico.at(-1)?.dataAlteracao ?? resto.dataCriacao,
        dataConclusao:
          historico.find((h) => h.statusNovo === StatusSolicitacao.CONCLUIDO)
            ?.dataAlteracao ?? null,
      }),
    );

    return {
      itens,
      total,
      pagina,
      tamanho,
      totalPaginas: Math.ceil(total / tamanho),
    };
  }

  async consultar(codigo: number, usuario: UsuarioAutenticado) {
    const solicitacao = await this.prisma.solicitacao.findUnique({
      where: { codigo },
      include: {
        categoria: true,
        usuario: { select: { id: true, nome: true, usuario: true } },
        _count: {
          select: { comentarios: { where: { excluidoEm: null } } },
        },
        historico: {
          orderBy: [{ dataAlteracao: 'asc' }, { id: 'asc' }],
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

    const { usuario: solicitante, _count, ...resto } = solicitacao;
    return {
      ...resto,
      totalComentarios: _count.comentarios,
      solicitante,
      // Atendente responsável (quem assumiu); null se ninguém assumiu ainda.
      atendente:
        solicitacao.historico.find(
          (h) => h.statusNovo === StatusSolicitacao.EM_ATENDIMENTO,
        )?.usuario ?? null,
    };
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
    const solicitacao = await this.prisma.solicitacao.findUnique({
      where: { codigo },
      include: { historico: ASSUNCAO },
    });
    if (!solicitacao) throw new NotFoundException('Solicitação não encontrada');
    const { status: atual } = solicitacao;
    const dono = solicitacao.historico[0]?.usuario ?? null;

    const permitido = PROXIMO_STATUS[atual];
    if (!permitido) {
      throw new ConflictException('A solicitação já está concluída');
    }
    if (novo !== permitido) {
      throw new ConflictException(
        `De ${atual} só é possível ir para ${permitido}`,
      );
    }

    // Quem assumiu é o dono do chamado: só ele altera o status dali em diante.
    // (Sem registro de assunção, caso de dado legado, qualquer atendente pode concluir.)
    const exigeDono =
      atual === StatusSolicitacao.EM_ATENDIMENTO && dono !== null;
    if (exigeDono && dono.id !== atendente.id) {
      throw new ForbiddenException(
        `Somente o atendente responsável (${dono.nome}) pode alterar o status deste chamado`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await gravarTransicao(tx, codigo, atual, novo, atendente, exigeDono);

      const { historico, ...atualizada } =
        await tx.solicitacao.findUniqueOrThrow({
          where: { codigo },
          include: { categoria: true, historico: ASSUNCAO },
        });
      return { ...atualizada, atendente: historico[0]?.usuario ?? null };
    });
  }

  // Atendente do chamado = quem o moveu para EM_ATENDIMENTO. A transição é sequencial,
  // então há no máximo uma linha dessas por chamado: "sem" = nenhuma, "meus" = a do
  // atendente logado, atendenteId = a de um atendente específico.
  private filtrarPorAtendente(
    { atendente, atendenteId }: FiltrarSolicitacoesDto,
    usuario: UsuarioAutenticado,
  ): Prisma.HistoricoSolicitacaoListRelationFilter | undefined {
    if (atendente && atendenteId) {
      throw new BadRequestException(
        'Use "atendente" ou "atendenteId", não os dois juntos',
      );
    }
    if (atendente === 'meus' && usuario.perfil !== PerfilUsuario.ATENDENTE) {
      throw new BadRequestException(
        'O filtro "atendente=meus" é exclusivo do atendente',
      );
    }

    const assumiu = (usuarioId?: number) => ({
      statusNovo: StatusSolicitacao.EM_ATENDIMENTO,
      ...(usuarioId && { usuarioId }),
    });
    if (atendente === 'sem') return { none: assumiu() };
    if (atendente === 'meus') return { some: assumiu(usuario.id) };
    if (atendenteId) return { some: assumiu(atendenteId) };
    return undefined;
  }

  private montarBuscaLivre(q: string): Prisma.SolicitacaoWhereInput[] {
    // Curingas do LIKE escapados: "%" e "_" são texto, não coringa.
    const contem = {
      contains: escaparCuringasLike(q),
      mode: 'insensitive' as const,
    };
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

    const inicio = dataInicio
      ? new Date(`${dataInicio}T00:00:00.000Z`)
      : undefined;
    const fim = dataFim ? new Date(`${dataFim}T00:00:00.000Z`) : undefined;
    if (
      (inicio && Number.isNaN(inicio.getTime())) ||
      (fim && Number.isNaN(fim.getTime()))
    ) {
      throw new BadRequestException('Data inválida no filtro de período');
    }
    if (inicio && fim && inicio > fim) {
      throw new BadRequestException(
        'dataInicio não pode ser maior que dataFim',
      );
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
