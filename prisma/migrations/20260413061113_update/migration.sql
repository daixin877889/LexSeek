/*
  Warnings:

  - The primary key for the `pg_ts_custom_word` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `word` on the `pg_ts_custom_word` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("name")` to `Char(255)`.
  - You are about to alter the column `attr` on the `pg_ts_custom_word` table. The data in that column could be lost. The data in that column will be cast from `Char(3)` to `Char(1)`.

*/
-- DropIndex
DROP INDEX "idx_case_material_hnsw";

-- DropIndex
DROP INDEX "idx_law_embeddings_hnsw";

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "pg_ts_custom_word" DROP CONSTRAINT "pg_ts_custom_word_pkey",
ALTER COLUMN "word" SET DATA TYPE CHAR(255),
ALTER COLUMN "attr" SET DATA TYPE CHAR(1),
ADD CONSTRAINT "pg_ts_custom_word_pkey" PRIMARY KEY ("word");
