#!/bin/sh
# Prepara o banco (migrations + seed) e sobe a API.
set -e
export PATH="/app/node_modules/.bin:$PATH"

echo "Aplicando migrations..."
prisma migrate deploy

echo "Populando categorias e usuários de teste..."
prisma db seed

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "Chamados de demonstração (só com a tabela vazia)..."
  tsx prisma/seed-demo.ts --se-vazio
fi

exec node dist/main
