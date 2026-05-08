/**
 * 模型配置获取服务
 *
 * 提供抽象的模型配置获取方法，支持数据库优先、环境变量回退
 */

import type { FullModelConfig, EmbeddingConfig, RerankConfig, ModelType } from '#shared/types/model'
import {
    findModelByIdDao,
    findModelsByTypeDao,
    findModelsByProviderIdDao,
    findDefaultModelByTypeDao,
} from './models.dao'
import { findModelProviderByIdDao } from './modelProviders.dao'
import { findDefaultModelApiKeyByProviderIdDao, findDefaultModelApiKeysByProviderIdsDao } from './modelApiKeys.dao'
import type { models } from '~~/generated/prisma/client'

/**
 * 通过 ID 获取完整模型配置
 * @param id 模型 ID
 * @returns 完整模型配置或 null
 */
export const getModelConfigByIdService = async (id: number): Promise<FullModelConfig | null> => {
    const model = await findModelByIdDao(id)
    if (!model) {
        return null
    }

    const provider = await findModelProviderByIdDao(model.providerId)
    if (!provider) {
        return null
    }

    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)

    return {
        model,
        provider,
        apiKey,
    }
}

/**
 * 通过类型获取模型配置列表
 * @param modelType 模型类型
 * @param options 查询选项
 * @returns 完整模型配置列表
 */
export const getModelConfigsByTypeService = async (
    modelType: ModelType,
    options: {
        status?: number
        orderBy?: 'priority' | 'name' | 'createdAt'
        orderDir?: 'asc' | 'desc'
    } = {}
): Promise<FullModelConfig[]> => {
    const models = await findModelsByTypeDao(modelType, options)
    const apiKeyMap = await findDefaultModelApiKeysByProviderIdsDao(models.map(m => m.providerId))

    return models.map(model => ({
        model,
        provider: model.modelProvider,
        apiKey: apiKeyMap.get(model.providerId) ?? null,
    }))
}

/**
 * 通过提供商 ID 获取模型配置列表
 * @param providerId 提供商 ID
 * @returns 完整模型配置列表
 */
export const getModelConfigsByProviderIdService = async (
    providerId: number
): Promise<FullModelConfig[]> => {
    const models = await findModelsByProviderIdDao(providerId)
    // 同一 providerId 下所有 model 共用一个 apiKey，只查一次
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(providerId)

    return models.map(model => ({
        model,
        provider: model.modelProvider,
        apiKey,
    }))
}

/**
 * 获取默认嵌入模型配置
 * @returns 完整模型配置或 null
 */
export const getDefaultEmbeddingConfigService = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('embedding')
    if (!model) {
        return null
    }

    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)

    return {
        model,
        provider,
        apiKey,
    }
}

/**
 * 获取默认聊天模型配置
 * @returns 完整模型配置或 null
 */
export const getDefaultChatConfigService = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('chat')
    if (!model) {
        return null
    }

    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)

    return {
        model,
        provider,
        apiKey,
    }
}

/**
 * 获取默认 ASR 模型配置
 * @returns 完整模型配置或 null
 */
export const getDefaultAsrConfigService = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('asr')
    if (!model) {
        return null
    }

    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)

    return {
        model,
        provider,
        apiKey,
    }
}

/**
 * 获取嵌入模型配置（优先数据库，回退环境变量）
 * @returns 嵌入模型配置
 */
export const getEmbeddingConfigWithFallbackService = async (): Promise<EmbeddingConfig> => {
    // 尝试从数据库获取默认嵌入模型配置
    const dbConfig = await getDefaultEmbeddingConfigService()

    if (dbConfig && dbConfig.apiKey) {
        logger.info('使用数据库配置的嵌入模型')
        return {
            apiKey: dbConfig.apiKey.apiKey,
            baseUrl: dbConfig.provider.baseUrl,
            model: dbConfig.model.name,
            dimensions: dbConfig.model.dimensions || 1536,
            batchSize: dbConfig.model.batchSize || 5,
            source: 'database',
        }
    }

    // 回退到环境变量配置
    logger.info('数据库无默认嵌入模型配置，使用环境变量配置')
    const config = useRuntimeConfig()

    const apiKey = config.embedding?.apiKey
    const baseUrl = config.embedding?.baseUrl
    const model = config.embedding?.model || 'text-embedding-v3'
    const dimensions = config.embedding?.dimensions || 1536
    const batchSize = config.embedding?.batchSize || 5

    if (!apiKey || !baseUrl) {
        throw new Error('嵌入模型配置不完整：缺少 API 密钥或基础 URL')
    }

    return {
        apiKey,
        baseUrl,
        model,
        dimensions,
        batchSize,
        source: 'environment',
    }
}

/**
 * 获取默认 Rerank 模型配置
 * @returns 完整模型配置或 null
 */
export const getDefaultRerankConfigService = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('rerank')
    if (!model) return null

    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)

    return { model, provider, apiKey }
}

/**
 * 获取 Rerank 模型配置（优先数据库，回退环境变量）
 * @returns Rerank 模型配置
 */
export const getRerankConfigWithFallbackService = async (): Promise<RerankConfig> => {
    // 尝试从数据库获取默认 rerank 模型配置
    const dbConfig = await getDefaultRerankConfigService()

    if (dbConfig && dbConfig.apiKey) {
        logger.info('使用数据库配置的 Rerank 模型')
        return {
            apiKey: dbConfig.apiKey.apiKey,
            baseUrl: dbConfig.provider.baseUrl,
            model: dbConfig.model.name,
            source: 'database',
        }
    }

    // 回退到环境变量配置
    logger.info('数据库无默认 Rerank 模型配置，使用环境变量配置')
    const config = useRuntimeConfig()
    // rerank 字段未在 nuxt.config.ts 的 runtimeConfig 中显式声明，这里用类型断言兜底
    const rerankConfig = (config as unknown as { rerank?: { apiKey?: string; baseUrl?: string; model?: string } }).rerank

    const apiKey = rerankConfig?.apiKey || process.env.NUXT_RERANK_API_KEY
    const baseUrl = rerankConfig?.baseUrl || process.env.NUXT_RERANK_BASE_URL
    const model = rerankConfig?.model || process.env.NUXT_RERANK_MODEL || 'gte-rerank-v2'

    if (!apiKey || !baseUrl) {
        throw new Error('Rerank 模型配置不完整：缺少 API 密钥或基础 URL')
    }

    return { apiKey, baseUrl, model, source: 'environment' }
}
