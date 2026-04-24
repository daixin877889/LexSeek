-- ============================================================================
-- 把本地开发库 ls_new 同步到和生产（阿里云 RDS ls_new_test）一致的状态。
--
-- 变更三件事：
--   1. LangGraph 6 张表：public → langgraph schema（实数据搬迁）
--   2. 删除 Prisma 老版遗留 pg_ts_custom_word（CHAR(255)）+ dict_type 枚举
--   3. 降级 zhparser 2.3 → 1.0（让扩展自己重建 pg_ts_custom_word / dict_type
--      作为扩展成员，与生产 RDS 的 zhparser 1.0 完全一致）
--
-- 执行前：
--   - 停掉所有跑在 ls_new 上的服务（Nuxt dev / agentWorker）
--
-- 执行方式：
--   DBURL="postgresql://daixin:daixin88@127.0.0.1:5432/ls_new" && \
--   docker exec -i postgres-postgres-1 psql "$DBURL" < scripts/sync-dev-db.sql
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 1: 搬迁 LangGraph 6 张表到 langgraph schema
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS langgraph;

CREATE TABLE langgraph.checkpoint_migrations (LIKE public.checkpoint_migrations INCLUDING ALL);
CREATE TABLE langgraph.checkpoints           (LIKE public.checkpoints           INCLUDING ALL);
CREATE TABLE langgraph.checkpoint_blobs      (LIKE public.checkpoint_blobs      INCLUDING ALL);
CREATE TABLE langgraph.checkpoint_writes     (LIKE public.checkpoint_writes     INCLUDING ALL);
CREATE TABLE langgraph.store_migrations      (LIKE public.store_migrations      INCLUDING ALL);
CREATE TABLE langgraph.store                 (LIKE public.store                 INCLUDING ALL);

INSERT INTO langgraph.checkpoint_migrations SELECT * FROM public.checkpoint_migrations;
INSERT INTO langgraph.checkpoints           SELECT * FROM public.checkpoints;
INSERT INTO langgraph.checkpoint_blobs      SELECT * FROM public.checkpoint_blobs;
INSERT INTO langgraph.checkpoint_writes     SELECT * FROM public.checkpoint_writes;
INSERT INTO langgraph.store_migrations      SELECT * FROM public.store_migrations;
INSERT INTO langgraph.store                 SELECT * FROM public.store;

-- update_store_updated_at 触发器（LIKE INCLUDING ALL 不含触发器）
CREATE TRIGGER update_store_updated_at
    BEFORE UPDATE ON langgraph.store
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 行数校验
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
            RAISE EXCEPTION 'LangGraph 行数不一致: public.% = %, langgraph.% = %',
                t, old_cnt, t, new_cnt;
        END IF;
        RAISE NOTICE '✓ 搬迁 % : % 行', t, new_cnt;
    END LOOP;
END $$;

-- 删 public 下的 LangGraph 旧表
DROP TABLE public.checkpoint_writes;
DROP TABLE public.checkpoint_blobs;
DROP TABLE public.checkpoints;
DROP TABLE public.checkpoint_migrations;
DROP TABLE public.store;
DROP TABLE public.store_migrations;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 2: 删除 Prisma 老版遗留的 pg_ts_custom_word + dict_type
--   （本地 dev DB 上它们不是扩展成员，可直接 DROP）
-- ─────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.pg_ts_custom_word;
DROP TYPE IF EXISTS public.dict_type;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 3: 降级 zhparser 2.3 → 1.0
--   zhparser 2.3 在 zhparser schema 下建 zhprs_custom_word；
--   zhparser 1.0 在 public schema 下建 pg_ts_custom_word + dict_type；
--   降级后与生产一致。
--   CASCADE 会同时删 'chinese' text search config，下面立即重建。
-- ─────────────────────────────────────────────────────────────────────────

DROP EXTENSION zhparser CASCADE;
CREATE EXTENSION zhparser VERSION '1.0';

-- 重建 'chinese' 中文全文搜索配置（与 seedData.sql / add_case_memories 等迁移一致）
CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- 事务外验证（只读）
-- ─────────────────────────────────────────────────────────────────────────

SELECT 'langgraph.' || t AS location, (SELECT count(*) FROM langgraph.checkpoint_migrations) AS cnt FROM (VALUES ('checkpoint_migrations')) AS x(t)
UNION ALL SELECT 'langgraph.checkpoints',        count(*) FROM langgraph.checkpoints
UNION ALL SELECT 'langgraph.checkpoint_blobs',   count(*) FROM langgraph.checkpoint_blobs
UNION ALL SELECT 'langgraph.checkpoint_writes',  count(*) FROM langgraph.checkpoint_writes
UNION ALL SELECT 'langgraph.store_migrations',   count(*) FROM langgraph.store_migrations
UNION ALL SELECT 'langgraph.store',              count(*) FROM langgraph.store;

SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','zhparser','pg_trgm');

SELECT cfgname FROM pg_ts_config WHERE cfgname = 'chinese';

-- pg_ts_custom_word 应由 zhparser 1.0 重建为扩展成员
SELECT e.extname, c.relname FROM pg_depend d
  JOIN pg_extension e ON e.oid = d.refobjid
  JOIN pg_class c ON c.oid = d.objid
  WHERE e.extname = 'zhparser' AND c.relname = 'pg_ts_custom_word';
