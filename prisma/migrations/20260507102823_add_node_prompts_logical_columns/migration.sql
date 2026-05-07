-- AlterTable
ALTER TABLE "node_prompts" ADD COLUMN     "prompt_name" VARCHAR(100),
ADD COLUMN     "prompt_type" VARCHAR(100),
ALTER COLUMN "prompt_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "idx_node_prompts_prompt_name_type" ON "node_prompts"("prompt_name", "prompt_type");
