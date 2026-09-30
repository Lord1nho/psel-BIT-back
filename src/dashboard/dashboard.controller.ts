import { Controller, Get, Header, Query } from '@nestjs/common';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { DashboardService } from './dashboard.service.js';
import { FiltrarDashboardDto } from './dto/filtrar-dashboard.dto.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // "no-cache" não impede o cache: obriga o navegador a revalidar (ETag) e receber
  // 304 sem corpo quando nada mudou. "private" porque o conteúdo depende do usuário.
  @Get()
  @Header('Cache-Control', 'private, no-cache')
  obter(
    @Query() filtros: FiltrarDashboardDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.dashboardService.obter(filtros, usuario);
  }
}
