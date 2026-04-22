-- AlterTable
ALTER TABLE "contract_annotations" ADD COLUMN     "removed_by_client" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suppress_in_export" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "word_comment_ref" VARCHAR(60);

-- AlterTable
ALTER TABLE "contract_review_versions" ADD COLUMN     "docx_file_id" INTEGER;

-- AlterTable
ALTER TABLE "contract_risks" ADD COLUMN     "original_anchor_quote" TEXT,
ADD COLUMN     "orphaned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "contract_annotations_word_comment_ref_idx" ON "contract_annotations"("word_comment_ref");
