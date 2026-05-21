-- AlterTable
ALTER TABLE "case_materials" ADD COLUMN     "session_id" VARCHAR(100);

-- CreateIndex
CREATE INDEX "idx_case_materials_session_id" ON "case_materials"("session_id");
