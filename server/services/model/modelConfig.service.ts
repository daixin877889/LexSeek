/**
 * 模型配置获取服务
 *
 * 提供抽象的模型配置获取方法，支持数据库优先、环境变量回退
 */

import type { FullModelConfig, EmbeddingConfig, ModelType } from '#shared/types/model'

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

    const configs: FullModelConfig[] = []
    for (const model of models) {
        const provider = model.modelProvider
        const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
        configs.push({
            model,
            provider,
            apiKey,
        })
    }

    return configs
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

    const configs: FullModelConfig[] = []
    for (const model of models) {
        const provider = model.modelProvider
        const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
        configs.push({
            model,
            provider,
            apiKey,
        })
    }

    return configs
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
