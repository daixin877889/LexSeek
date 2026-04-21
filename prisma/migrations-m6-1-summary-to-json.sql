-- M6.1：合同审查 summary 字段从 TEXT 升级为 JSONB
-- 历史 string 原地包装为 { highlights: null, overall: <old_string> }
-- 此 SQL 只在生产/测试库执行一次；完成后删除本文件
ALTER TABLE "contract_reviews"
    ALTER COLUMN "summary" TYPE JSONB
    USING CASE
        WHEN "summary" IS NULL THEN NULL
        ELSE jsonb_build_object('highlights', NULL, 'overall', "summary")
    END;
