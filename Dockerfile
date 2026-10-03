# API do portal de solicitações (NestJS + Prisma). Imagem pensada para execução local/avaliação.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# O prisma.config.ts exige DATABASE_URL até para gerar o client; o valor aqui não é usado.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
  && npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# node_modules completo de propósito: a CLI do prisma (migrate deploy) e a tsx (seed) são
# devDependencies usadas na subida do container.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/generated ./src/generated
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
