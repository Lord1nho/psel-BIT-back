-- DropIndex
DROP INDEX "solicitacoes_usuario_id_idx";

-- CreateIndex
CREATE INDEX "historico_solicitacoes_status_novo_solicitacao_codigo_idx" ON "historico_solicitacoes"("status_novo", "solicitacao_codigo");

-- CreateIndex
CREATE INDEX "solicitacoes_usuario_id_data_criacao_idx" ON "solicitacoes"("usuario_id", "data_criacao");
