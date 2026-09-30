import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CategoriasService {
  constructor(private readonly prisma: PrismaService) {}

  // Só as ativas: categoria inativa não pode ser usada em novas solicitações.
  listarAtivas() {
    return this.prisma.categoria.findMany({
      where: { ativa: true },
      orderBy: { id: 'asc' },
      select: { id: true, nome: true },
    });
  }
}
