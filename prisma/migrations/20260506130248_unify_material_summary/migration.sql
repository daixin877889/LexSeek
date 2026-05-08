/*
  Warnings:

  - You are about to drop the column `summary` on the `case_materials` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "case_materials" DROP COLUMN "summary";

-- AlterTable
ALTER TABLE "text_content_records" ADD COLUMN     "summary" TEXT;
