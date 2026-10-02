import { SetMetadata } from '@nestjs/common';
import type { PerfilUsuario } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';
export const Roles = (...perfis: PerfilUsuario[]) =>
  SetMetadata(ROLES_KEY, perfis);
