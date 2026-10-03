import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator.js';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { ComentariosService } from './comentarios.service.js';
import { CriarComentarioDto } from './dto/criar-comentario.dto.js';
import { EditarComentarioDto } from './dto/editar-comentario.dto.js';
import { FiltrarComentariosDto } from './dto/filtrar-comentarios.dto.js';

// As regras dependem do dono e do responsável do chamado, então ficam no service (sem @Roles).
@Controller('solicitacoes/:codigo/comentarios')
export class ComentariosController {
  constructor(private readonly comentariosService: ComentariosService) {}

  // "no-cache" + ETag: o polling recebe 304 sem corpo quando não há novidade.
  @Get()
  @Header('Cache-Control', 'private, no-cache')
  listar(
    @Param('codigo', ParseIdPipe) codigo: number,
    @Query() filtros: FiltrarComentariosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.comentariosService.listar(codigo, filtros, usuario);
  }

  @Post()
  criar(
    @Param('codigo', ParseIdPipe) codigo: number,
    @Body() dto: CriarComentarioDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.comentariosService.criar(codigo, dto, usuario);
  }

  @Patch(':comentarioId')
  editar(
    @Param('codigo', ParseIdPipe) codigo: number,
    @Param('comentarioId', ParseIdPipe) comentarioId: number,
    @Body() dto: EditarComentarioDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.comentariosService.editar(codigo, comentarioId, dto, usuario);
  }

  @Delete(':comentarioId')
  @HttpCode(204)
  excluir(
    @Param('codigo', ParseIdPipe) codigo: number,
    @Param('comentarioId', ParseIdPipe) comentarioId: number,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.comentariosService.excluir(codigo, comentarioId, usuario);
  }
}
