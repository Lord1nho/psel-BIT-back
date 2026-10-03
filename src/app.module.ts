import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CategoriasModule } from './categorias/categorias.module.js';
import { ComentariosModule } from './comentarios/comentarios.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SolicitacoesModule } from './solicitacoes/solicitacoes.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    CategoriasModule,
    ComentariosModule,
    DashboardModule,
    SolicitacoesModule,
  ],
})
export class AppModule {}
