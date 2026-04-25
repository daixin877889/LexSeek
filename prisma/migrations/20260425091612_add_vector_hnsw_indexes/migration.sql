-- ==================== M3/M4 HNSW 向量索引 ====================
-- 背景：case_memories（M3）与 case_analysis_embeddings（M4）的 embedding
-- 列在初始迁移中以 `vector`（无维度）创建，pgvector 不支持在无维度向量列上
-- 建立 HNSW / ivfflat 索引。本迁移先将列固化为 vector(1536)（项目默认 embedding
-- 维度，见 server/services/model/modelConfig.service.ts），再建立 HNSW 索引。
--
-- 安全性：
--   * 已存在数据维度均为 1536（迁移前已校验 ls_new / ls_eval / ls_new_testing）
--   * ALTER 子句使用 USING ... 显式转换，避免类型不兼容报错
--   * 索引使用 IF NOT EXISTS 幂等，重复执行不会报错
--   * HNSW 在小数据量（<10 万行）上构建很快；当前各库行数远低于该量级

-- 1) 固化向量维度为 1536（pgvector 要求建立 HNSW 索引前列必须有显式维度）
ALTER TABLE "case_memories"
  ALTER COLUMN "embedding" TYPE vector(1536) USING "embedding"::vector(1536);

ALTER TABLE "case_analysis_embeddings"
  ALTER COLUMN "embedding" TYPE vector(1536) USING "embedding"::vector(1536);

-- 2) 建立 HNSW 索引（cosine 距离，与 hybridSearch.service.ts 中的查询语义匹配）
CREATE INDEX IF NOT EXISTS "idx_case_memories_embedding_hnsw"
  ON "case_memories" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "idx_case_analysis_embeddings_hnsw"
  ON "case_analysis_embeddings" USING hnsw ("embedding" vector_cosine_ops);
