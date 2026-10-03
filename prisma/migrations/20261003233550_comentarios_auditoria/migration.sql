-- AlterTable
ALTER TABLE "comentarios" ADD COLUMN     "excluido_em" TIMESTAMPTZ(6),
ADD COLUMN     "excluido_por_id" INTEGER;

-- CreateTable
CREATE TABLE "comentarios_revisoes" (
    "id" SERIAL NOT NULL,
    "comentario_id" INTEGER NOT NULL,
    "texto_anterior" TEXT NOT NULL,
    "editado_por_id" INTEGER NOT NULL,
    "data_revisao" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comentarios_revisoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comentarios_revisoes_comentario_id_idx" ON "comentarios_revisoes"("comentario_id");

-- AddForeignKey
ALTER TABLE "comentarios" ADD CONSTRAINT "comentarios_excluido_por_id_fkey" FOREIGN KEY ("excluido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios_revisoes" ADD CONSTRAINT "comentarios_revisoes_comentario_id_fkey" FOREIGN KEY ("comentario_id") REFERENCES "comentarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios_revisoes" ADD CONSTRAINT "comentarios_revisoes_editado_por_id_fkey" FOREIGN KEY ("editado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
