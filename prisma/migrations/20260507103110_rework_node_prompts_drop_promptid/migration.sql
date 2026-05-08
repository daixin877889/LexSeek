/*
  Warnings:

  - You are about to drop the column `prompt_id` on the `node_prompts` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[node_id,prompt_name,prompt_type]` on the table `node_prompts` will be added. If there are existing duplicate values, this will fail.
  - Made the column `prompt_name` on table `node_prompts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `prompt_type` on table `node_prompts` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "node_prompts" DROP CONSTRAINT "node_prompts_prompt_id_fkey";

-- DropIndex
DROP INDEX "node_prompts_node_id_prompt_id_key";

-- AlterTable
ALTER TABLE "node_prompts" DROP COLUMN "prompt_id",
ALTER COLUMN "prompt_name" SET NOT NULL,
ALTER COLUMN "prompt_type" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "node_prompts_node_id_prompt_name_prompt_type_key" ON "node_prompts"("node_id", "prompt_name", "prompt_type");
