-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "court_name" VARCHAR(200),
ADD COLUMN     "first_instance_case_no" VARCHAR(100),
ADD COLUMN     "first_instance_judge" VARCHAR(100),
ADD COLUMN     "second_instance_case_no" VARCHAR(100),
ADD COLUMN     "second_instance_judge" VARCHAR(100);

-- ========== 存量 status 迁移 ==========
UPDATE "cases" SET "status" = 99 WHERE "status" IN (2, 3) AND "deleted_at" IS NULL;
