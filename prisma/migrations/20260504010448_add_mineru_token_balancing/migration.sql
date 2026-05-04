-- AlterTable
ALTER TABLE "mineru_tasks" ADD COLUMN     "mineru_token_id" INTEGER;

-- AlterTable
ALTER TABLE "mineru_tokens" ADD COLUMN     "expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_used_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "idx_mineru_tasks_mineru_token_id" ON "mineru_tasks"("mineru_token_id");

-- CreateIndex
CREATE INDEX "idx_mineru_tokens_expires_at" ON "mineru_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "idx_mineru_tokens_last_used_at" ON "mineru_tokens"("last_used_at");

-- AddForeignKey
ALTER TABLE "mineru_tasks" ADD CONSTRAINT "mineru_tasks_mineru_token_id_fkey" FOREIGN KEY ("mineru_token_id") REFERENCES "mineru_tokens"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
