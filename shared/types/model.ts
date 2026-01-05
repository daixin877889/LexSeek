/**
 * 模型管理系统类型定义
 */

import type {
    modelProviders,
    modelApiKeys,
    models,
} from '~~/generated/prisma/client'

/** 模型类型枚举 */
export type ModelType = 'chat' | 'embedding' | 'asr'

/** 模型类型标签映射 */
export const ModelTypeLabels: Record<ModelType, string> = {
    chat: '对话模型',
    embedding: '嵌入模型',
    asr: '音频识别',
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
export type UpdateModelInput = Partial<Omit<CreateModelInput, 'providerId'>>

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
