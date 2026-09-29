import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PerfilUsuario } from '../../generated/prisma/client.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const perfis = this.reflector.getAllAndOverride<PerfilUsuario[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!perfis?.length) return true;

    const { usuario } = context.switchToHttp().getRequest();
    if (!usuario || !perfis.includes(usuario.perfil)) {
      throw new ForbiddenException('Perfil sem permissão para esta operação');
    }
    return true;
  }
}
