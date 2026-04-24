-- AlterTable
ALTER TABLE "case_analyses" ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "case_analysis_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,
    "tsv" tsvector,

    CONSTRAINT "case_analysis_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_case_analysis_tsv" ON "case_analysis_embeddings" USING GIN ("tsv");

-- ==================== M4 case_analysis_embeddings 手工补充 ====================

-- （幂等）确保 zhparser 中文分词配置存在（同 case_memories migration）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

-- HNSW 向量索引需在确认 embedding 维度后单独 migration 中建立
-- （无维度 vector 列不支持 HNSW/ivfflat operator class，同 case_memories 约束）

-- metadata 热查询 expression index
CREATE INDEX IF NOT EXISTS "idx_case_analysis_meta_active"
  ON "case_analysis_embeddings" ((metadata->>'caseId'), (metadata->>'analysisType'))
  WHERE metadata->>'isActive' = 'true';
CREATE INDEX IF NOT EXISTS "idx_case_analysis_meta_analysis"
  ON "case_analysis_embeddings" ((metadata->>'analysisId'));
