import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PerfilUsuario, PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const CATEGORIAS = ['TI', 'RH', 'Compras', 'Financeiro', 'Infraestrutura'];

async function main() {
  const senha = await bcrypt.hash(process.env.SEED_PASSWORD ?? '123456', 10);

  for (const nome of CATEGORIAS) {
    await prisma.categoria.upsert({
      where: { nome },
      update: {},
      create: { nome },
    });
  }

  const usuarios = [
    { nome: 'Atendente Um', usuario: 'atendente.um', perfil: PerfilUsuario.ATENDENTE },
    { nome: 'Solicitante Um', usuario: 'solicitante.um', perfil: PerfilUsuario.SOLICITANTE },
    { nome: 'Atendente Dois', usuario: 'atendente.dois', perfil: PerfilUsuario.ATENDENTE },
    { nome: 'Solicitante Dois', usuario: 'solicitante.dois', perfil: PerfilUsuario.SOLICITANTE },
  ];

  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { usuario: u.usuario },
      update: {},
      create: { ...u, senha },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
