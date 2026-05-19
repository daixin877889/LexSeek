-- AlterTable
ALTER TABLE "document_draft_snapshots" ADD COLUMN     "content" TEXT;

-- AlterTable
ALTER TABLE "document_draft_versions" ADD COLUMN     "content" TEXT;

-- AlterTable
ALTER TABLE "document_drafts" ADD COLUMN     "content" TEXT,
ADD COLUMN     "mode" VARCHAR(20) NOT NULL DEFAULT 'template',
ALTER COLUMN "template_id" DROP NOT NULL;
