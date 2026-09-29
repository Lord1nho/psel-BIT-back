import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import type { PerfilUsuario } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';

export interface JwtPayload {
  sub: number;
  usuario: string;
  perfil: PerfilUsuario;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login({ usuario, senha }: LoginDto) {
    const encontrado = await this.prisma.usuario.findUnique({
      where: { usuario },
    });
    const senhaValida =
      !!encontrado && (await bcrypt.compare(senha, encontrado.senha));
    if (!encontrado || !senhaValida) {
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }

    const payload: JwtPayload = {
      sub: encontrado.id,
      usuario: encontrado.usuario,
      perfil: encontrado.perfil,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      usuario: {
        id: encontrado.id,
        nome: encontrado.nome,
        usuario: encontrado.usuario,
        perfil: encontrado.perfil,
      },
    };
  }
}
