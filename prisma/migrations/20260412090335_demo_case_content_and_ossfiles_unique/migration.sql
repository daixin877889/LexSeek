-- AlterTable: demo_cases 添加 content 列（示范案例的文本案情描述）
ALTER TABLE "demo_cases" ADD COLUMN "content" TEXT;

-- CreateIndex: oss_files 添加 (user_id, bucket_name, file_path) 联合唯一约束
-- 示范案例克隆场景的去重联合键：同一用户下同一 OSS 对象（bucket+path）只能有一行
CREATE UNIQUE INDEX "idx_oss_files_user_bucket_path" ON "oss_files"("user_id", "bucket_name", "file_path");

-- 把存量文本材料搬到 content 列
UPDATE demo_cases
SET content = materials->0->>'content'
WHERE jsonb_array_length(materials) >= 1
  AND materials->0->>'type' = '1'
  AND content IS NULL;

-- materials 仅保留非文本项（当前生产库无文件类材料，执行后应为空数组）
UPDATE demo_cases
SET materials = COALESCE(
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(materials) elem
    WHERE elem->>'type' != '1'
  ),
  '[]'::jsonb
);
