-- 创建 pgvector 扩展（如果不存在）
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "legal_main" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT NOT NULL,
    "issuing_authority" TEXT,
    "document_number" TEXT,
    "publish_date" DATE,
    "effective_date" DATE,
    "invalid_date" DATE,
    "last_edited_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "last_embedding_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "legal_main_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_articles" (
    "id" TEXT NOT NULL,
    "legal_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "l1" TEXT,
    "l1_i" INTEGER,
    "l2" TEXT,
    "l2_i" INTEGER,
    "l3" TEXT,
    "l3_i" INTEGER,
    "l4" TEXT,
    "l4_i" INTEGER,
    "l5" TEXT,
    "l5_i" INTEGER,
    "order" INTEGER,
    "content" TEXT,
    "publish_date" DATE,
    "effective_date" DATE,
    "invalid_date" DATE,
    "last_edited_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "last_embedding_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "legal_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,

    CONSTRAINT "law_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_legal_main_type" ON "legal_main"("type");

-- CreateIndex
CREATE INDEX "idx_legal_main_code" ON "legal_main"("code");

-- CreateIndex
CREATE INDEX "idx_legal_main_issuing_authority" ON "legal_main"("issuing_authority");

-- CreateIndex
CREATE INDEX "idx_legal_main_deleted_at" ON "legal_main"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_legal_articles_legal_id" ON "legal_articles"("legal_id");

-- CreateIndex
CREATE INDEX "idx_legal_articles_deleted_at" ON "legal_articles"("deleted_at");

-- AddForeignKey
ALTER TABLE "legal_articles" ADD CONSTRAINT "legal_articles_legal_id_fkey" FOREIGN KEY ("legal_id") REFERENCES "legal_main"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
