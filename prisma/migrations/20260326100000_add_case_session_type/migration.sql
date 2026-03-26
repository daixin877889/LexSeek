-- AlterTable
ALTER TABLE "case_sessions" ADD COLUMN "type" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "idx_case_sessions_type" ON "case_sessions"("type");
