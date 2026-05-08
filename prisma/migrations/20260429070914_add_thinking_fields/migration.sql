-- DropIndex
DROP INDEX "idx_case_analysis_embeddings_hnsw";

-- DropIndex
DROP INDEX "idx_case_memories_embedding_hnsw";

-- AlterTable
ALTER TABLE "models" ADD COLUMN     "supports_thinking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "thinking_enabled" BOOLEAN NOT NULL DEFAULT false;
