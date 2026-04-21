-- M6.1 子期 1：合同审查 summary 字段从 TEXT 升级为 JSONB
-- 历史 string 原地包装为 ContractOverview 形态：{ highlights: null, overall: <old_string> }
-- USING 子句确保数据不丢失（默认 DROP+ADD 会清空历史 summary）
ALTER TABLE "contract_reviews"
    ALTER COLUMN "summary" TYPE JSONB
    USING CASE
        WHEN "summary" IS NULL THEN NULL
        ELSE jsonb_build_object('highlights', NULL, 'overall', "summary")
    END;
