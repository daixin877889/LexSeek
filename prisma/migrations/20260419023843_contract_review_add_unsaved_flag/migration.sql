-- AlterTable
ALTER TABLE "contract_reviews" ADD COLUMN "has_unsaved_docx_changes" BOOLEAN NOT NULL DEFAULT false;
