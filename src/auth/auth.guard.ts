import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import type { JwtPayload } from './auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publica) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extrairToken(request);
    if (!token) throw new UnauthorizedException('Token não informado');

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const usuario: UsuarioAutenticado = {
        id: payload.sub,
        usuario: payload.usuario,
        perfil: payload.perfil,
      };
      (request as Request & { usuario: UsuarioAutenticado }).usuario = usuario;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    return true;
  }

  private extrairToken(request: Request): string | undefined {
    const [tipo, token] = request.headers.authorization?.split(' ') ?? [];
    return tipo === 'Bearer' ? token : undefined;
  }
}
