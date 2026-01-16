-- 添加 paraformer-v2 语音识别模型
-- 用于阿里云百炼 DashScope ASR 服务
-- 模型类型：asr（音频识别模型）
-- 关联到 dashscope 提供商

-- 首先获取 dashscope 提供商的 ID，然后插入模型
INSERT INTO "public"."models" (
    "provider_id",
    "name",
    "display_name",
    "model_type",
    "sdk_type",
    "model_version",
    "context_window",
    "dimensions",
    "batch_size",
    "is_default",
    "status",
    "priority",
    "input_cost_per_million_tokens",
    "output_cost_per_million_tokens",
    "created_at",
    "updated_at",
    "deleted_at"
)
SELECT 
    mp.id,                                    -- provider_id：关联 dashscope 提供商
    'paraformer-v2',                          -- name：模型名称
    'Paraformer V2 语音识别',                  -- display_name：显示名称
    'asr',                                    -- model_type：音频识别模型
    'openai',                                 -- sdk_type：SDK 类型（ASR 不使用 LangChain SDK，但需要填写）
    NULL,                                     -- model_version：模型版本
    NULL,                                     -- context_window：上下文窗口（ASR 不适用）
    NULL,                                     -- dimensions：嵌入维度（ASR 不适用）
    100,                                      -- batch_size：批处理大小（最多 100 个音频文件）
    true,                                     -- is_default：设为 ASR 类型的默认模型
    1,                                        -- status：启用状态
    10,                                       -- priority：优先级
    NULL,                                     -- input_cost_per_million_tokens：输入成本（ASR 按分钟计费，不按 token）
    NULL,                                     -- output_cost_per_million_tokens：输出成本
    NOW(),                                    -- created_at
    NOW(),                                    -- updated_at
    NULL                                      -- deleted_at
FROM "public"."model_providers" mp
WHERE mp.name = 'dashscope' AND mp.deleted_at IS NULL
AND NOT EXISTS (
    -- 避免重复插入：检查是否已存在同名模型
    SELECT 1 FROM "public"."models" m 
    WHERE m.name = 'paraformer-v2' 
    AND m.provider_id = mp.id 
    AND m.deleted_at IS NULL
);
