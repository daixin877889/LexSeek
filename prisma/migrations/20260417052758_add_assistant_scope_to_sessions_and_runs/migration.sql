-- AlterTable
ALTER TABLE "case_sessions" ADD COLUMN     "scope" VARCHAR(20) NOT NULL DEFAULT 'case',
ADD COLUMN     "title" VARCHAR(200),
ADD COLUMN     "user_id" INTEGER,
ALTER COLUMN "case_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "agent_runs" ALTER COLUMN "case_id" DROP NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "idx_case_sessions_status";

-- CreateIndex
CREATE INDEX "idx_case_sessions_user_scope" ON "case_sessions"("user_id", "scope", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_case_sessions_scope_status" ON "case_sessions"("scope", "status");

-- AddForeignKey
ALTER TABLE "case_sessions" ADD CONSTRAINT "case_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
