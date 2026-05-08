-- AlterTable
ALTER TABLE "prompts" ALTER COLUMN "node_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "node_prompts" (
    "id" SERIAL NOT NULL,
    "node_id" INTEGER NOT NULL,
    "prompt_id" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_node_prompts_node_id_display_order" ON "node_prompts"("node_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "node_prompts_node_id_prompt_id_key" ON "node_prompts"("node_id", "prompt_id");

-- AddForeignKey
ALTER TABLE "node_prompts" ADD CONSTRAINT "node_prompts_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "node_prompts" ADD CONSTRAINT "node_prompts_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
