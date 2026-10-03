import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  StatusSolicitacao,
} from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

// Primeira assunção do chamado (→ EM_ATENDIMENTO): quem a fez é o atendente responsável.
export const ASSUNCAO = {
  where: { statusNovo: StatusSolicitacao.EM_ATENDIMENTO },
  orderBy: [{ dataAlteracao: 'asc' }, { id: 'asc' }],
  take: 1,
  select: { usuario: { select: { id: true, nome: true } } },
} satisfies Prisma.Solicitacao$historicoArgs;

/**
 * Grava a mudança de status e o registro no histórico, dentro da transação `tx`.
 * A condição vai na própria escrita: se outro atendente assumiu ou mudou o status entre a
 * checagem e o update, nada é gravado e a chamada falha com 409. Com `exigeDono`, só passa
 * se o próprio atendente é quem assumiu o chamado.
 */
export async function gravarTransicao(
  tx: Prisma.TransactionClient,
  codigo: number,
  atual: StatusSolicitacao,
  novo: StatusSolicitacao,
  atendente: UsuarioAutenticado,
  exigeDono: boolean,
) {
  const { count } = await tx.solicitacao.updateMany({
    where: {
      codigo,
      status: atual,
      ...(exigeDono && {
        historico: {
          some: {
            statusNovo: StatusSolicitacao.EM_ATENDIMENTO,
            usuarioId: atendente.id,
          },
        },
      }),
    },
    data: { status: novo },
  });
  if (count === 0) {
    throw new ConflictException(
      atual === StatusSolicitacao.ABERTO
        ? 'Este chamado já foi assumido por outro atendente; atualize a tela'
        : 'O status da solicitação foi alterado; atualize a tela',
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
}
