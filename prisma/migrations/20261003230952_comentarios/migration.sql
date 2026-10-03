-- CreateTable
CREATE TABLE "comentarios" (
    "id" SERIAL NOT NULL,
    "solicitacao_codigo" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "data_criacao" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_edicao" TIMESTAMPTZ(6),

    CONSTRAINT "comentarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comentarios_solicitacao_codigo_id_idx" ON "comentarios"("solicitacao_codigo", "id");

-- CreateIndex
CREATE INDEX "comentarios_usuario_id_idx" ON "comentarios"("usuario_id");

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_solicitacao_codigo_fkey" FOREIGN KEY ("solicitacao_codigo") REFERENCES "solicitacoes"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
