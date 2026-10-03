import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { PerfilUsuario } from '../generated/prisma/client.js';
import { AlterarStatusDto } from './dto/alterar-status.dto.js';
import { CriarSolicitacaoDto } from './dto/criar-solicitacao.dto.js';
import { EditarSolicitacaoDto } from './dto/editar-solicitacao.dto.js';
import { FiltrarSolicitacoesDto } from './dto/filtrar-solicitacoes.dto.js';
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

  // "no-cache" obriga o navegador a revalidar (ETag) e receber 304 sem corpo se nada
  // mudou; "private" porque o conteúdo depende do perfil de quem pede.
  @Get()
  @Header('Cache-Control', 'private, no-cache')
  listar(
    @Query() filtros: FiltrarSolicitacoesDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.listar(filtros, usuario);
  }

  @Get(':codigo')
  consultar(
    @Param('codigo', ParseIntPipe) codigo: number,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.consultar(codigo, usuario);
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

  @Patch(':codigo/status')
  @Roles(PerfilUsuario.ATENDENTE)
  alterarStatus(
    @Param('codigo', ParseIntPipe) codigo: number,
    @Body() dto: AlterarStatusDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.solicitacoesService.alterarStatus(codigo, dto, usuario);
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
