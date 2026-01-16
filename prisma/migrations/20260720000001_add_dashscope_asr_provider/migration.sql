-- 添加阿里云百炼 DashScope ASR 专用模型提供商
-- 用于音频识别服务，使用 DashScope 原生 API 端点
-- 与现有的 bailian 提供商（compatible-mode）区分，该提供商用于 OpenAI 兼容模式的 LLM 调用

INSERT INTO "public"."model_providers" ("name", "base_url", "description", "created_at", "updated_at", "deleted_at")
SELECT 'dashscope', 'https://dashscope.aliyuncs.com/api/v1', '阿里云百炼（DashScope ASR）', NOW(), NOW(), NULL
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."model_providers" WHERE "name" = 'dashscope' AND "deleted_at" IS NULL
);
