-- DropIndex
DROP INDEX "idx_case_analysis_embeddings_hnsw";

-- DropIndex
DROP INDEX "idx_case_memories_embedding_hnsw";

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "use_skills_as_logic" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "skills" (
    "name" VARCHAR(100) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'filesystem',
    "title" VARCHAR(200),
    "description" TEXT,
    "version" VARCHAR(50),
    "status" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "node_skills" (
    "node_id" INTEGER NOT NULL,
    "skill_name" VARCHAR(100) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_skills_pkey" PRIMARY KEY ("node_id","skill_name")
);

-- CreateIndex
CREATE INDEX "idx_skills_status" ON "skills"("status");

-- CreateIndex
CREATE INDEX "idx_skills_source" ON "skills"("source");

-- CreateIndex
CREATE INDEX "idx_node_skills_node_id" ON "node_skills"("node_id");

-- CreateIndex
CREATE INDEX "idx_node_skills_skill_name" ON "node_skills"("skill_name");

-- AddForeignKey
ALTER TABLE "node_skills" ADD CONSTRAINT "node_skills_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "node_skills" ADD CONSTRAINT "node_skills_skill_name_fkey" FOREIGN KEY ("skill_name") REFERENCES "skills"("name") ON DELETE CASCADE ON UPDATE NO ACTION;
