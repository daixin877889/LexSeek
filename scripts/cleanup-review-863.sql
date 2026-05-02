-- =========================================================================
-- 已废弃（2026-05-02）：合同审查双锚点重构（PR 2，migration
-- refactor_contract_risks_dual_anchor）已要求各开发者在 dev 库 truncate
-- contract_risks / contract_annotations / contract_review_legacy_risks_backup /
-- contract_review_versions 全表；review 863 的脏数据随之清空，本脚本不再
-- 有数据可清。脚本保留作为历史现场参考，不要再执行。
-- =========================================================================

-- 一次性清理 review 863 在 Phase C 改造前被误判的脏数据
--
-- 前置条件：
--   1. 代码已升级到 Phase C+（customXml + author 三重防线）
--   2. Dev server 已重启，导出的新 docx 会写 customXml
--   3. 本脚本仅针对 review 863；如要推广到其他 review，改 :review_id 即可
--
-- 脏数据来源：
--   - 之前上传的那份"劳动合同甲方批注.docx"触发了 uploadClientVersion，
--     因 w:initials 被 Word 截断 + 按 people.xml 统一 → 全部识别失败
--   - 原 AI annotations 被标 removedByClient=true / suppressInExport=true
--   - 新建了 N 条 source='external_new' 的 risk + 对应 annotation
--
-- 清理策略：**回滚 AI annotation 的误删标记** + **硬删由本次上传创建的 external_new 记录**
-- 不回滚版本快照（保留"错误中间态"便于审计）

BEGIN;

\set review_id 863

-- 1. 核对影响范围（先看不删）
SELECT '误删的 AI annotation 数量' AS label, COUNT(*) AS cnt
FROM contract_annotations
WHERE review_id = :review_id
  AND author_type = 'ai'
  AND removed_by_client = true;

SELECT '由误上传新建的 external_new risk 数量' AS label, COUNT(*) AS cnt
FROM contract_risks
WHERE review_id = :review_id
  AND source = 'external_new';

-- 2. 恢复被误标的系统 annotation（AI / lawyer）
UPDATE contract_annotations
SET removed_by_client = false,
    suppress_in_export = false,
    updated_at = NOW()
WHERE review_id = :review_id
  AND author_type IN ('ai', 'lawyer')
  AND removed_by_client = true;

-- 3. 硬删由本次上传新建的 external_new annotation（连带硬删对应 risk）
--    注：external_new 是 uploadClientVersion 当场创建的，不在历史版本快照里，可安全硬删
DELETE FROM contract_annotations
WHERE review_id = :review_id
  AND risk_id IN (
    SELECT id FROM contract_risks
    WHERE review_id = :review_id AND source = 'external_new'
  );

DELETE FROM contract_risks
WHERE review_id = :review_id
  AND source = 'external_new';

-- 4. 把 review.risks JSONB 与 contract_risks 表重新对齐
--    （代码里有 syncReviewRisksJsonb 逻辑，但脏数据场景可能未跑完整，这里补一刀）
UPDATE contract_reviews
SET risks = (
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id::text,
            'clauseIndex', r.anchor_paragraph_index,
            'clauseText', r.anchor_quote,
            'level', r.level,
            'category', r.category,
            'problem', r.problem,
            'legalBasis', r.legal_basis,
            'analysis', r.analysis,
            'risk', r.problem,
            'suggestion', r.suggestion,
            'matchedPointCode', r.code
        )
    ), '[]'::jsonb)
    FROM contract_risks r
    WHERE r.review_id = :review_id
),
updated_at = NOW()
WHERE id = :review_id;

-- 5. 重置 status 和 hasUnsavedDocxChanges 到干净态
UPDATE contract_reviews
SET status = 'completed',
    has_unsaved_docx_changes = true,  -- 需要用户重新生成批注 docx
    updated_at = NOW()
WHERE id = :review_id;

-- 6. 验证（跑完再 commit）
SELECT '清理后 AI annotation 数量（应 > 0）' AS label, COUNT(*) AS cnt
FROM contract_annotations
WHERE review_id = :review_id
  AND author_type = 'ai'
  AND removed_by_client = false;

SELECT '清理后 external_new risk 数量（应为 0）' AS label, COUNT(*) AS cnt
FROM contract_risks
WHERE review_id = :review_id
  AND source = 'external_new';

-- 确认数据正常后再提交
-- COMMIT;
-- 如果出错，执行：
-- ROLLBACK;
