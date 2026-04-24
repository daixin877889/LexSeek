-- ============================================================================
-- 将 LangGraph checkpointer/store 的 6 张表从 public 搬迁到独立 langgraph schema
-- ============================================================================
--
-- 背景：
--   LangGraph 的 PostgresSaver / PostgresStore 在运行时自动建表，历史上落在 public schema，
--   导致 Prisma migrate 检测到大量 drift（未登记到迁移历史）。
--   现在把这 6 张表迁到专用的 langgraph schema，使 Prisma 只管 public，两边不再冲突。
--
-- 前置条件（⚠️ 必须严格确认后再执行）：
--   1. 已经修改 server/services/workflow/checkpointer.ts
--      PostgresSaver/PostgresStore.fromConnString 都加上 { schema: 'langgraph' }
--   2. 已经**停掉 agentWorker / Nuxt 服务**，本次搬迁期间无任何写入这 6 张表的流量
--   3. 已经备份主库（或确认可承担数据丢失风险）
--
-- 执行方式：
--   psql "$DATABASE_URL" -f scripts/migrate-langgraph-to-schema.sql
--   或通过 docker exec：
--   docker exec -i postgres-postgres-1 psql "$DATABASE_URL" < scripts/migrate-langgraph-to-schema.sql
--
-- 验证：脚本末尾会输出新旧表行数对比，两列必须完全一致。
-- ============================================================================

BEGIN;

-- 1. 建 schema
CREATE SCHEMA IF NOT EXISTS langgraph;

-- 2. 复制表结构（含 PK / 索引 / 默认值 / 约束；触发器需要另外建）
CREATE TABLE langgraph.checkpoint_migrations (LIKE public.checkpoint_migrations INCLUDING ALL);
CREATE TABLE langgraph.checkpoints           (LIKE public.checkpoints           INCLUDING ALL);
CREATE TABLE langgraph.checkpoint_blobs      (LIKE public.checkpoint_blobs      INCLUDING ALL);
CREATE TABLE langgraph.checkpoint_writes     (LIKE public.checkpoint_writes     INCLUDING ALL);
CREATE TABLE langgraph.store_migrations      (LIKE public.store_migrations      INCLUDING ALL);
CREATE TABLE langgraph.store                 (LIKE public.store                 INCLUDING ALL);

-- 3. 复制数据
INSERT INTO langgraph.checkpoint_migrations SELECT * FROM public.checkpoint_migrations;
INSERT INTO langgraph.checkpoints           SELECT * FROM public.checkpoints;
INSERT INTO langgraph.checkpoint_blobs      SELECT * FROM public.checkpoint_blobs;
INSERT INTO langgraph.checkpoint_writes     SELECT * FROM public.checkpoint_writes;
INSERT INTO langgraph.store_migrations      SELECT * FROM public.store_migrations;
INSERT INTO langgraph.store                 SELECT * FROM public.store;

-- 4. 重建 public.store 上的触发器（LIKE INCLUDING ALL 不含触发器）
-- update_updated_at_column() 是 public schema 下的全局函数，可复用
CREATE TRIGGER update_store_updated_at
    BEFORE UPDATE ON langgraph.store
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. 行数校验（在事务里先 assert，任一张对不上立即 ROLLBACK）
DO $$
DECLARE
    t TEXT;
    old_cnt BIGINT;
    new_cnt BIGINT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'checkpoint_migrations', 'checkpoints', 'checkpoint_blobs',
        'checkpoint_writes', 'store_migrations', 'store'
    ]) LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',    t) INTO old_cnt;
        EXECUTE format('SELECT count(*) FROM langgraph.%I', t) INTO new_cnt;
        IF old_cnt <> new_cnt THEN
            RAISE EXCEPTION '行数不一致: public.% = %, langgraph.% = %', t, old_cnt, t, new_cnt;
        END IF;
        RAISE NOTICE '✓ % : % 行', t, new_cnt;
    END LOOP;
END $$;

-- 6. 删除 public 下的旧表
DROP TABLE public.checkpoint_writes;
DROP TABLE public.checkpoint_blobs;
DROP TABLE public.checkpoints;
DROP TABLE public.checkpoint_migrations;
DROP TABLE public.store;
DROP TABLE public.store_migrations;

COMMIT;

-- 最终核对（事务外，只读，方便肉眼扫一眼）
SELECT 'langgraph.checkpoint_migrations' AS t, count(*) FROM langgraph.checkpoint_migrations
UNION ALL SELECT 'langgraph.checkpoints',          count(*) FROM langgraph.checkpoints
UNION ALL SELECT 'langgraph.checkpoint_blobs',     count(*) FROM langgraph.checkpoint_blobs
UNION ALL SELECT 'langgraph.checkpoint_writes',    count(*) FROM langgraph.checkpoint_writes
UNION ALL SELECT 'langgraph.store_migrations',     count(*) FROM langgraph.store_migrations
UNION ALL SELECT 'langgraph.store',                count(*) FROM langgraph.store;
