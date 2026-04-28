-- DropIndex
DROP INDEX "idx_case_analysis_embeddings_hnsw";

-- DropIndex
DROP INDEX "idx_case_memories_embedding_hnsw";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "admin_remark" TEXT,
ADD COLUMN     "admin_remark_updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "admin_remark_updated_by" INTEGER;

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "admin_remark" TEXT,
ADD COLUMN     "admin_remark_updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "admin_remark_updated_by" INTEGER;
