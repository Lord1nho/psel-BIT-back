import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';

function contexto(request: object): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const verifyAsync = vi.fn();
  const getAllAndOverride = vi.fn();
  let guard: AuthGuard;

  beforeEach(() => {
    verifyAsync.mockReset();
    getAllAndOverride.mockReset();
    guard = new AuthGuard(
      { verifyAsync } as unknown as JwtService,
      { getAllAndOverride } as unknown as Reflector,
    );
  });

  it('libera rota pública sem token', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contexto({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('rejeita requisição sem token', async () => {
    getAllAndOverride.mockReturnValue(false);

    await expect(
      guard.canActivate(contexto({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita esquema diferente de Bearer', async () => {
    getAllAndOverride.mockReturnValue(false);

    await expect(
      guard.canActivate(
        contexto({ headers: { authorization: 'Basic abc' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita token inválido ou expirado', async () => {
    getAllAndOverride.mockReturnValue(false);
    verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(
      guard.canActivate(
        contexto({ headers: { authorization: 'Bearer ruim' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aceita token válido e anexa o usuário à requisição', async () => {
    getAllAndOverride.mockReturnValue(false);
    verifyAsync.mockResolvedValue({
      sub: 7,
      usuario: 'atendente.um',
      perfil: 'ATENDENTE',
    });
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer bom' },
    };

    await expect(guard.canActivate(contexto(request))).resolves.toBe(true);
    expect(request.usuario).toEqual({
      id: 7,
      usuario: 'atendente.um',
      perfil: 'ATENDENTE',
    });
  });
});
