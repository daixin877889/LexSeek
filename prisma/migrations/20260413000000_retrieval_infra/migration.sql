-- 检索基础设施迁移
-- 包含：扩展、tsv 列、embedding 维度、全文搜索配置、trigger、索引
--
-- 注意：Prisma schema 中 embedding 定义为 Unsupported("vector")（不带维度），
-- 维度声明必须通过 ALTER COLUMN 在迁移中完成。

-- ============================================================
-- 1. 扩展（vector 扩展在 init 迁移中已创建，此处确保幂等）
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS zhparser;

-- ============================================================
-- 2. tsv 列（tsvector）
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'law_embeddings' AND column_name = 'tsv') THEN
    ALTER TABLE "law_embeddings" ADD COLUMN "tsv" tsvector;
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'case_material_embeddings' AND column_name = 'tsv') THEN
    ALTER TABLE "case_material_embeddings" ADD COLUMN "tsv" tsvector;
  END IF;
END$$;

-- ============================================================
-- 3. embedding 列维度声明（vector → vector(1536)）
--    Prisma schema 用 Unsupported("vector") 不支持带维度参数，
--    因此维度必须在迁移中通过 ALTER COLUMN 设置。
-- ============================================================
DO $$ BEGIN
  IF (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'law_embeddings'::regclass AND attname = 'embedding') = -1 THEN
    ALTER TABLE "law_embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
  END IF;
END$$;

DO $$ BEGIN
  IF (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'case_material_embeddings'::regclass AND attname = 'embedding') = -1 THEN
    ALTER TABLE "case_material_embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
  END IF;
END$$;

-- ============================================================
-- 4. 中文全文搜索配置（zhparser）
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR
      n,v,a,i,e,l,j,d,f,r,p,q,m,k,u,s,y,z,x,w,h WITH simple;
  END IF;
END$$;

-- ============================================================
-- 5. trigger 函数和触发器
-- ============================================================
CREATE OR REPLACE FUNCTION update_tsv_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv := to_tsvector('chinese', COALESCE(NEW.text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_law_embeddings_tsv') THEN
    CREATE TRIGGER trg_law_embeddings_tsv
      BEFORE INSERT OR UPDATE OF text ON law_embeddings
      FOR EACH ROW EXECUTE FUNCTION update_tsv_column();
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_case_material_embeddings_tsv') THEN
    CREATE TRIGGER trg_case_material_embeddings_tsv
      BEFORE INSERT OR UPDATE OF text ON case_material_embeddings
      FOR EACH ROW EXECUTE FUNCTION update_tsv_column();
  END IF;
END$$;

-- ============================================================
-- 6. 索引
-- ============================================================

-- GIN(tsv) 全文搜索索引（在 schema 中通过 @@index 声明）
CREATE INDEX IF NOT EXISTS idx_law_embeddings_tsv ON law_embeddings USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_case_material_tsv ON case_material_embeddings USING GIN(tsv);

-- GIN(trgm) 模糊搜索索引（在 schema 中通过 @@index 声明）
CREATE INDEX IF NOT EXISTS idx_law_embeddings_text_trgm ON law_embeddings USING GIN(text gin_trgm_ops);

-- JSONB 字段索引（表达式索引，Prisma 不管理）
CREATE INDEX IF NOT EXISTS idx_law_emb_legal_id ON law_embeddings ((metadata->>'legal_id'));
CREATE INDEX IF NOT EXISTS idx_law_emb_legal_name ON law_embeddings ((metadata->>'legal_name'));
CREATE INDEX IF NOT EXISTS idx_case_material_emb_userid ON case_material_embeddings ((metadata->>'userId'));
CREATE INDEX IF NOT EXISTS idx_case_material_emb_sourceid ON case_material_embeddings ((metadata->>'sourceId'));

-- HNSW 向量索引（在 Unsupported 列上，Prisma 不管理）
CREATE INDEX IF NOT EXISTS idx_law_embeddings_hnsw
  ON law_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
CREATE INDEX IF NOT EXISTS idx_case_material_hnsw
  ON case_material_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
