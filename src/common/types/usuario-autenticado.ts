import type { PerfilUsuario } from '../../generated/prisma/client.js';

export interface UsuarioAutenticado {
  id: number;
  usuario: string;
  perfil: PerfilUsuario;
}
