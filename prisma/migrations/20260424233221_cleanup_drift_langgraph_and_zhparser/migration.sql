-- ============================================================================
-- 清理 Prisma drift：
--   把 public.checkpoint_* / public.store* 6 张 LangGraph 表从 Prisma 迁移历史中移除。
--   实际数据已通过 scripts/migrate-langgraph-to-schema.sql 搬到 langgraph schema，
--   LangGraph SDK 现在直连 langgraph.*，public 下不再保留这些表。
--
-- 本迁移在活 DB 执行时：
--   6 张 checkpoint_* / store* IF EXISTS 判空（已在搬迁脚本里 DROP）→ no-op
-- 在 shadow 库重放时：
--   6 张表由 20260422132440_langchain 建出来 → 被这里 DROP
--
-- 注意：pg_ts_custom_word + dict_type 是阿里云 RDS zhparser 1.0 的扩展成员，
-- 无法 DROP。init migration 已调整为按真实结构建表，使 shadow 重放结果与活 DB 对齐。
-- ============================================================================

-- DropTable (LangGraph checkpointer 表已搬到 langgraph schema)
DROP TABLE IF EXISTS "checkpoint_blobs";
DROP TABLE IF EXISTS "checkpoint_migrations";
DROP TABLE IF EXISTS "checkpoint_writes";
DROP TABLE IF EXISTS "checkpoints";

-- DropTable (LangGraph store 表已搬到 langgraph schema)
DROP TABLE IF EXISTS "store";
DROP TABLE IF EXISTS "store_migrations";
