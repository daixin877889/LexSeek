-- 添加 sdk_type 字段到 models 表
-- 用于标识模型使用的 LangChain SDK 类型：openai、deepseek、gemini、anthropic
-- 默认值为 'openai' 以保持向后兼容

ALTER TABLE "models" ADD COLUMN "sdk_type" VARCHAR(20) NOT NULL DEFAULT 'openai';
