-- CreateTable
CREATE TABLE "case_memories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,
    "tsv" tsvector,

    CONSTRAINT "case_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_case_memories_tsv" ON "case_memories" USING GIN ("tsv");

-- ==================== M3 case_memories 手工补充 ====================

-- （幂等）确保 zhparser 中文分词配置存在
-- seedData.sql 建过，但 `prisma migrate deploy` 不跑 seed；CI/生产必须在 migration 里幂等建
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

-- HNSW 向量索引需在确认 embedding 维度后单独 migration 中建立
-- （无维度 vector 列不支持 HNSW/ivfflat operator class）

-- metadata 热查询 expression index
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_case"
  ON "case_memories" ((metadata->>'caseId'));
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_subject"
  ON "case_memories" ((metadata->>'caseId'), (metadata->>'subjectKey'))
  WHERE metadata->>'invalidatedAt' IS NULL;
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_kind"
  ON "case_memories" ((metadata->>'caseId'), (metadata->>'kind'));
