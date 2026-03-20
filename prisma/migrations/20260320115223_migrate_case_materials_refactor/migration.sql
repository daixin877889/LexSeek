-- CreateTable: 创建 text_content_records 表
CREATE TABLE "text_content_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "material_id" INTEGER,
    "content" TEXT,
    "html_content" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "vector_ids" JSONB DEFAULT '[]',
    "last_embedding_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "text_content_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_text_content_records_user_id" ON "text_content_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_text_content_records_case_id" ON "text_content_records"("case_id");

-- CreateIndex
CREATE INDEX "idx_text_content_records_material_id" ON "text_content_records"("material_id");

-- DataMigration: 迁移 CASE_CONTENT 类型材料的 content → text_content_records
INSERT INTO text_content_records (user_id, case_id, material_id, content, html_content, status, vector_ids, last_embedding_at, created_at, updated_at)
SELECT
    c2.user_id,
    cm.case_id,
    cm.id AS material_id,
    cm.content,
    cm.original_content,
    CASE cm.embedding_status
        WHEN 'pending' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'failed' THEN 3
        ELSE 0
    END AS status,
    '[]'::jsonb AS vector_ids,
    CASE WHEN cm.embedding_status = 'completed' THEN NOW() ELSE NULL END AS last_embedding_at,
    cm.created_at,
    NOW() AS updated_at
FROM case_materials cm
JOIN cases c2 ON cm.case_id = c2.id
WHERE cm.type = 1
AND cm.deleted_at IS NULL
AND cm.content IS NOT NULL;

-- DataMigration: 从 case_material_embeddings 反查 vector_ids（对已完成嵌入的材料）
UPDATE text_content_records t
SET vector_ids = COALESCE(
    (SELECT jsonb_agg(e.id::text)
     FROM case_material_embeddings e
     WHERE e.metadata->>'materialId' = t.material_id::text),
    '[]'::jsonb
)
WHERE t.status = 2
AND t.material_id IS NOT NULL;

-- AlterTable: 删除 case_materials 表中的废弃字段
ALTER TABLE "case_materials" DROP COLUMN IF EXISTS "content";
ALTER TABLE "case_materials" DROP COLUMN IF EXISTS "original_content";
ALTER TABLE "case_materials" DROP COLUMN IF EXISTS "embedding_status";
