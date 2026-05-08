-- ==================== 重建 M3/M4 HNSW 向量索引 ====================
-- 背景：上一个迁移 20260429070914_add_thinking_fields
-- 因 Prisma schema 与数据库存在 schema drift（HNSW 索引由独立 SQL 创建，
-- 未在 prisma/models/*.prisma 中声明），prisma migrate dev 自动生成了
-- DROP INDEX 语句把两个 HNSW 索引清掉，导致 case_memories /
-- case_analysis_embeddings 的向量检索性能退化。本迁移立即重建。
--
-- 注意：HNSW 索引无法用 Prisma schema 表达（pgvector 扩展类型），所以本项目
-- 通过 raw SQL migration 维护它们；每次 prisma migrate dev 都会再次检测为 drift
-- 并生成 DROP——这是已知的项目级权衡（参考 20260428101500 / 20260426064409 的同类 restore）。
-- 后续根因方案是把含 HNSW 的表移到 langgraph schema（独立立项）。
--
-- 安全性：
--   * IF NOT EXISTS 幂等
--   * 当前数据量小，秒级完成

CREATE INDEX IF NOT EXISTS "idx_case_memories_embedding_hnsw"
  ON "case_memories" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "idx_case_analysis_embeddings_hnsw"
  ON "case_analysis_embeddings" USING hnsw ("embedding" vector_cosine_ops);
