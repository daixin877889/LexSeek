-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "court_name" VARCHAR(200),
ADD COLUMN     "first_instance_case_no" VARCHAR(100),
ADD COLUMN     "first_instance_judge" VARCHAR(100),
ADD COLUMN     "second_instance_case_no" VARCHAR(100),
ADD COLUMN     "second_instance_judge" VARCHAR(100);
