-- DropIndex
DROP INDEX "idx_case_analysis_embeddings_hnsw";

-- DropIndex
DROP INDEX "idx_case_memories_embedding_hnsw";

-- AlterTable
ALTER TABLE "contract_reviews" ADD COLUMN     "cot_messages" JSONB;
