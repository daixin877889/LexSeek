-- CreateTable
-- 合同审查存量 risks JSON 一次性备份表（Phase A 数据迁移回滚兜底）
-- 手工修订理由：Prisma 自动生成的 migration SQL 只建表；
-- 手工追加 INSERT...SELECT 一次性拷贝存量 JSON 数据为数据保全
-- 用户同意人：戴鑫（2026-04-22）
CREATE TABLE "contract_review_legacy_risks_backup" (
    "review_id" INTEGER NOT NULL,
    "risks" JSONB NOT NULL,
    "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_review_legacy_risks_backup_pkey" PRIMARY KEY ("review_id")
);

-- 手工追加：一次性拷贝存量数据（幂等：ON CONFLICT DO NOTHING）
INSERT INTO contract_review_legacy_risks_backup (review_id, risks)
SELECT id, risks FROM contract_reviews
WHERE risks IS NOT NULL AND jsonb_typeof(risks) = 'array' AND jsonb_array_length(risks) > 0
ON CONFLICT (review_id) DO NOTHING;
