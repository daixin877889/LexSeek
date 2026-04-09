/**
 * 模型管理系统类型定义
 */

import type {
    modelProviders,
    modelApiKeys,
    models,
} from '~~/generated/prisma/client'

// ============================================================================
// SDK 类型相关定义
// ============================================================================

/**
 * LangChain SDK 类型枚举
 * 用于标识模型应使用的 LangChain 包
 */
export type SdkType = 'openai' | 'deepseek' | 'gemini' | 'anthropic'

/**
 * 所有支持的 SDK 类型数组
 * 方便遍历和验证
 */
export const SDK_TYPES: readonly SdkType[] = ['openai', 'deepseek', 'gemini', 'anthropic'] as const

/**
 * SDK 类型标签映射
 * 用于前端显示用户友好的标签
 */
export const SdkTypeLabels: Record<SdkType, string> = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    anthropic: 'Anthropic',
}

/**
 * SDK 类型对应的 LangChain 包映射
 * 用于后端确定使用的 LangChain 包
 */
export const SdkTypePackages: Record<SdkType, string> = {
    openai: '@langchain/openai',
    deepseek: '@langchain/deepseek',
    gemini: '@langchain/google-genai',
    anthropic: '@langchain/anthropic',
}

/**
 * 默认 SDK 类型
 * 用于向后兼容，未设置 sdkType 时使用此默认值
 */
export const DEFAULT_SDK_TYPE: SdkType = 'openai'

// ============================================================================
// 模型类型相关定义
// ============================================================================

/** 模型类型枚举 */
export type ModelType = 'chat' | 'embedding' | 'asr' | 'rerank'

/** 模型类型标签映射 */
export const ModelTypeLabels: Record<ModelType, string> = {
    chat: '对话模型',
    embedding: '嵌入模型',
    asr: '音频识别',
    rerank: '重排序模型',
}

/** 模型状态枚举 */
export enum ModelStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 模型状态标签映射 */
export const ModelStatusLabels: Record<ModelStatus, string> = {
    [ModelStatus.DISABLED]: '禁用',
    [ModelStatus.ENABLED]: '启用',
}

// 重导出 Prisma 类型（便于使用）
export type ModelProvider = modelProviders
export type ModelApiKey = modelApiKeys
export type Model = models

/** 完整模型配置（包含关联数据） */
export interface FullModelConfig {
    model: Model
    provider: ModelProvider
    apiKey: ModelApiKey | null
}

/** 嵌入模型配置 */
export interface EmbeddingConfig {
    apiKey: string
    baseUrl: string
    model: string
    dimensions: number
    batchSize: number
    source: 'database' | 'environment'
}

/** Rerank 模型配置 */
export interface RerankConfig {
    apiKey: string
    baseUrl: string
    model: string
    source: 'database' | 'environment'
}

/** 创建模型提供商输入类型 */
export interface CreateModelProviderInput {
    name: string
    baseUrl: string
    description?: string | null
}

/** 更新模型提供商输入类型 */
export type UpdateModelProviderInput = Partial<CreateModelProviderInput>

/** 创建 API 密钥输入类型 */
export interface CreateModelApiKeyInput {
    providerId: number
    name: string
    apiKey: string
    isDefault?: boolean
    status?: number
    dailyLimit?: number | null
    monthlyLimit?: number | null
}

/** 更新 API 密钥输入类型 */
export type UpdateModelApiKeyInput = Partial<Omit<CreateModelApiKeyInput, 'providerId'>>

/** 创建模型输入类型 */
export interface CreateModelInput {
    providerId: number
    name: string
    displayName: string
    modelType: ModelType
    /** LangChain SDK 类型，用于指定模型使用的 LangChain 包，默认为 'openai' */
    sdkType?: SdkType
    modelVersion?: string | null
    contextWindow?: number | null
    dimensions?: number | null
    batchSize?: number | null
    isDefault?: boolean
    status?: number
    priority?: number
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
}

/** 更新模型输入类型 */
export interface UpdateModelInput {
    name?: string
    displayName?: string
    modelType?: ModelType
    /** LangChain SDK 类型，用于指定模型使用的 LangChain 包 */
    sdkType?: SdkType
    modelVersion?: string | null
    contextWindow?: number | null
    dimensions?: number | null
    batchSize?: number | null
    isDefault?: boolean
    status?: number
    priority?: number
    inputCostPerMillionTokens?: number | null
    outputCostPerMillionTokens?: number | null
}

/** 模型列表查询参数 */
export interface ModelListParams {
    /** 模型类型筛选 */
    modelType?: ModelType
    /** 提供商ID筛选 */
    providerId?: number
    /** 状态筛选 */
    status?: number
    /** 排序字段 */
    orderBy?: 'priority' | 'name' | 'createdAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** API 密钥列表查询参数 */
export interface ApiKeyListParams {
    /** 提供商ID筛选 */
    providerId?: number
    /** 状态筛选 */
    status?: number
}

/** 模型提供商列表查询参数 */
export interface ProviderListParams {
    /** 状态筛选（是否已删除） */
    includeDeleted?: boolean
}
