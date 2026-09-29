import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const findUnique = vi.fn();
  const signAsync = vi.fn().mockResolvedValue('token-jwt');
  let service: AuthService;
  let senhaHash: string;

  beforeAll(async () => {
    senhaHash = await bcrypt.hash('123456', 4);
  });

  beforeEach(() => {
    findUnique.mockReset();
    service = new AuthService(
      { usuario: { findUnique } } as never,
      { signAsync } as unknown as JwtService,
    );
  });

  it('retorna token e dados públicos com credenciais válidas', async () => {
    findUnique.mockResolvedValue({
      id: 1,
      nome: 'Solicitante Um',
      usuario: 'solicitante.um',
      senha: senhaHash,
      perfil: 'SOLICITANTE',
    });

    const resultado = await service.login({
      usuario: 'solicitante.um',
      senha: '123456',
    });

    expect(resultado.accessToken).toBe('token-jwt');
    expect(resultado.usuario).toEqual({
      id: 1,
      nome: 'Solicitante Um',
      usuario: 'solicitante.um',
      perfil: 'SOLICITANTE',
    });
    expect(signAsync).toHaveBeenCalledWith({
      sub: 1,
      usuario: 'solicitante.um',
      perfil: 'SOLICITANTE',
    });
  });

  it('rejeita usuário inexistente', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.login({ usuario: 'nao.existe', senha: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita senha incorreta', async () => {
    findUnique.mockResolvedValue({
      id: 1,
      nome: 'Solicitante Um',
      usuario: 'solicitante.um',
      senha: senhaHash,
      perfil: 'SOLICITANTE',
    });

    await expect(
      service.login({ usuario: 'solicitante.um', senha: 'errada' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
