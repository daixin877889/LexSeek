/*
  Warnings:

  - You are about to drop the column `node_id` on the `prompts` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_node_id_fkey";

-- DropIndex
DROP INDEX "idx_prompts_node_id";

-- AlterTable
ALTER TABLE "prompts" DROP COLUMN "node_id";
