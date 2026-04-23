-- 手工修订（数据保全）：存量行用 created_at 值填充 updated_at，随后 DROP DEFAULT
-- 让后续 Prisma @updatedAt 机制（应用层）接管更新，不依赖数据库 DEFAULT。
-- 修订理由：Prisma 自动生成的 SQL 对已存量行无 DEFAULT，会导致 NOT NULL 约束违反。
-- 经用户同意手工修订，见 fix(contract): contractAnnotations 加 updatedAt 字段 commit。

-- AlterTable：分步操作保证存量数据安全
-- 1. 先加允许 NULL 的列，避免对存量行立即触发 NOT NULL 约束
ALTER TABLE "contract_annotations" ADD COLUMN "updated_at" TIMESTAMP(3);
-- 2. 用 created_at 回填存量行（保留历史时序）
UPDATE "contract_annotations" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
-- 3. 设置 NOT NULL 约束（此时所有行已有值）
ALTER TABLE "contract_annotations" ALTER COLUMN "updated_at" SET NOT NULL;
