import { Body, Controller, Post } from '@nestjs/common';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';
import { SolicitacoesService } from './solicitacoes.service.js';

@Controller('solicitacoes')
export class SolicitacoesController {
  constructor(private readonly solicitacoesService: SolicitacoesService) {}

  @Post()
  criar(
    @Body() dto: CriarSolicitacaoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.criar(dto, usuario);
  }
}
