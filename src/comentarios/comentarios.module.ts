import { Module } from '@nestjs/common';
import { ComentariosController } from './comentarios.controller.js';
import { ComentariosService } from './comentarios.service.js';

@Module({
  controllers: [ComentariosController],
  providers: [ComentariosService],
})
export class ComentariosModule {}
