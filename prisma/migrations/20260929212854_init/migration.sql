-- CreateEnum
CREATE TYPE "perfil_usuario" AS ENUM ('SOLICITANTE', 'ATENDENTE');

-- CreateEnum
CREATE TYPE "status_solicitacao" AS ENUM ('ABERTO', 'EM_ATENDIMENTO', 'CONCLUIDO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "usuario" VARCHAR(255) NOT NULL,
    "senha" VARCHAR(255) NOT NULL,
    "perfil" "perfil_usuario" NOT NULL DEFAULT 'SOLICITANTE',

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes" (
    "codigo" SERIAL NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria_id" INTEGER NOT NULL,
    "status" "status_solicitacao" NOT NULL DEFAULT 'ABERTO',
    "data_criacao" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" INTEGER NOT NULL,

    CONSTRAINT "solicitacoes_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "historico_solicitacoes" (
    "id" SERIAL NOT NULL,
    "solicitacao_codigo" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "status_anterior" "status_solicitacao",
    "status_novo" "status_solicitacao" NOT NULL,
    "data_alteracao" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_solicitacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nome_key" ON "categorias"("nome");

-- CreateIndex
CREATE INDEX "solicitacoes_usuario_id_idx" ON "solicitacoes"("usuario_id");

-- CreateIndex
CREATE INDEX "solicitacoes_categoria_id_idx" ON "solicitacoes"("categoria_id");

-- CreateIndex
CREATE INDEX "solicitacoes_status_idx" ON "solicitacoes"("status");

-- CreateIndex
CREATE INDEX "solicitacoes_data_criacao_idx" ON "solicitacoes"("data_criacao");

-- CreateIndex
CREATE INDEX "historico_solicitacoes_solicitacao_codigo_idx" ON "historico_solicitacoes"("solicitacao_codigo");

-- CreateIndex
CREATE INDEX "historico_solicitacoes_usuario_id_idx" ON "historico_solicitacoes"("usuario_id");

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_solicitacoes" ADD CONSTRAINT "historico_solicitacoes_solicitacao_codigo_fkey" FOREIGN KEY ("solicitacao_codigo") REFERENCES "solicitacoes"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_solicitacoes" ADD CONSTRAINT "historico_solicitacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
