import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PerfilUsuario } from '../generated/prisma/client.js';
import { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';
import { EditarSolicitacaoDto } from './dto/editar-solicitacao.dto.js';
import { SolicitacoesService } from './solicitacoes.service.js';

@Controller('solicitacoes')
export class SolicitacoesController {
  constructor(private readonly solicitacoesService: SolicitacoesService) {}

  @Post()
  @Roles(PerfilUsuario.SOLICITANTE)
  criar(
    @Body() dto: CriarSolicitacaoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.criar(dto, usuario);
  }

  @Patch(':codigo')
  @Roles(PerfilUsuario.SOLICITANTE)
  editar(
    @Param('codigo', ParseIntPipe) codigo: number,
    @Body() dto: EditarSolicitacaoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.editar(codigo, dto, usuario);
  }

  @Delete(':codigo')
  @Roles(PerfilUsuario.SOLICITANTE)
  @HttpCode(204)
  excluir(
    @Param('codigo', ParseIntPipe) codigo: number,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.excluir(codigo, usuario);
  }
}
