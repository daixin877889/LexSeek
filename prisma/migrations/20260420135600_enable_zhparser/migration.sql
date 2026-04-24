-- 安装 zhparser 扩展（中文全文搜索）
-- 锁定版本 1.0：生产使用阿里云 RDS 的 zhparser 1.0，表名为 pg_ts_custom_word；
-- 2.x 版本的表名改为 zhprs_custom_word 且位于 zhparser schema。固定版本确保对齐。
CREATE EXTENSION IF NOT EXISTS zhparser VERSION '1.0';

-- 补建 dict_type + pg_ts_custom_word
--   阿里云 RDS 的 zhparser 1.0（定制版）会自动创建这两个对象为扩展成员；
--   开源原版 zhparser 1.0 不会创建。
--   用 DO 块幂等建出，两种环境最终产出相同结构：
--     - 阿里云：IF NOT EXISTS 命中，跳过，保留扩展成员身份
--     - 本地：补建为普通 Prisma 对象，结构与阿里云扩展成员完全一致
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dict_type') THEN
        CREATE TYPE "dict_type" AS ENUM ('extra', 'it', 'edu', 'gov', 'medical', 'other');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'pg_ts_custom_word' AND n.nspname = 'public'
    ) THEN
        CREATE TABLE "pg_ts_custom_word" (
            "word" name NOT NULL,
            "tf" double precision NOT NULL DEFAULT 10.0,
            "idf" double precision NOT NULL DEFAULT 2.0,
            "attr" character(3) NOT NULL DEFAULT 'n',
            "ts_type" "dict_type" NOT NULL DEFAULT 'extra',
            CONSTRAINT "pg_ts_custom_word_pkey" PRIMARY KEY ("word"),
            CONSTRAINT "pg_ts_custom_word_word_check" CHECK ((bit_length("word"::text) / 8) <= 128)
        );
    END IF;
END $$;
