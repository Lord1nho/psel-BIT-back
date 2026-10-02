import { IsEnum } from 'class-validator';
import { StatusSolicitacao } from '../../generated/prisma/client.js';

export class AlterarStatusDto {
  @IsEnum(StatusSolicitacao)
  status!: StatusSolicitacao;
}
