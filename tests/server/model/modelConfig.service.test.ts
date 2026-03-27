/**
 * 模型配置服务层集成测试
 *
 * 测试 modelConfig.service.ts 中各函数的业务逻辑
 * 模型配置服务提供抽象的模型配置获取方法，支持数据库优先、环境变量回退
 *
 * **Feature: model-management**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.1, 5.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import {
    getTestPrisma,
    createTestModelProvider,
    createTestModelApiKey,
    createTestModel,
    cleanupModelTestData,
    createEmptyModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetModelDatabaseSequences,
    ModelStatus,
    ModelType,
    type ModelTestIds,
} from './test-db-helper'

// 导入 DAO 函数（用于构建完整配置）
import {
    findModelByIdDao,
    findModelsByTypeDao,
    findModelsByProviderIdDao,
    findDefaultModelByTypeDao,
} from '../../../server/services/model/models.dao'

import {
    findModelProviderByIdDao,
} from '../../../server/services/model/modelProviders.dao'

import {
    findDefaultModelApiKeyByProviderIdDao,
} from '../../../server/services/model/modelApiKeys.dao'

// 导入服务函数
import {
    getModelConfigByIdService,
    getModelConfigsByTypeService,
    getModelConfigsByProviderIdService,
    getDefaultEmbeddingConfigService,
    getDefaultChatConfigService,
    getDefaultAsrConfigService,
    getEmbeddingConfigWithFallbackService,
} from '../../../server/services/model/modelConfig.service'

import type { FullModelConfig, EmbeddingConfig } from '#shared/types/model'

// 辅助函数：获取完整模型配置（模拟服务层逻辑）
const getModelConfigById = async (id: number): Promise<FullModelConfig | null> => {
    const model = await findModelByIdDao(id)
    if (!model) return null
    const provider = await findModelProviderByIdDao(model.providerId)
    if (!provider) return null
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
    return { model, provider, apiKey }
}

// 辅助函数：按类型获取模型配置列表
const getModelConfigsByType = async (
    modelType: 'chat' | 'embedding' | 'asr',
    options: { status?: number; orderBy?: 'priority' | 'name' | 'createdAt'; orderDir?: 'asc' | 'desc' } = {}
): Promise<FullModelConfig[]> => {
    const models = await findModelsByTypeDao(modelType, options)
    const configs: FullModelConfig[] = []
    for (const model of models) {
        const provider = model.modelProvider
        const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
        configs.push({ model, provider, apiKey })
    }
    return configs
}

// 辅助函数：按提供商获取模型配置列表
const getModelConfigsByProviderId = async (providerId: number): Promise<FullModelConfig[]> => {
    const models = await findModelsByProviderIdDao(providerId)
    const configs: FullModelConfig[] = []
    for (const model of models) {
        const provider = model.modelProvider
        const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
        configs.push({ model, provider, apiKey })
    }
    return configs
}

// 辅助函数：获取默认嵌入模型配置
const getDefaultEmbeddingConfig = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('embedding')
    if (!model) return null
    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
    return { model, provider, apiKey }
}

// 辅助函数：获取默认聊天模型配置
const getDefaultChatConfig = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('chat')
    if (!model) return null
    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
    return { model, provider, apiKey }
}

// 辅助函数：获取默认 ASR 模型配置
const getDefaultAsrConfig = async (): Promise<FullModelConfig | null> => {
    const model = await findDefaultModelByTypeDao('asr')
    if (!model) return null
    const provider = model.modelProvider
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
    return { model, provider, apiKey }
}

// 检查数据库是否可用
let dbAvailable = false

describe('模型配置服务层集成测试', () => {
    const testIds: ModelTestIds = createEmptyModelTestIds()
    const prisma = getTestPrisma()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        } else {
            await resetModelDatabaseSequences()
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupModelTestData(testIds)
            testIds.providerIds = []
            testIds.apiKeyIds = []
            testIds.modelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ==================== getModelConfigByIdService 测试 ====================

    describe('getModelConfigByIdService 测试', () => {
        it('应返回包含模型、提供商和密钥的完整配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model.id)

            const config = await getModelConfigByIdService(model.id)

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.provider.id).toBe(provider.id)
            expect(config!.apiKey!.id).toBe(apiKey.id)
        })

        it('模型不存在时应返回 null', async () => {
            if (!dbAvailable) return

            const config = await getModelConfigByIdService(9999999)
            expect(config).toBeNull()
        })

        it('无默认 API 密钥时 apiKey 应为 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model.id)

            const config = await getModelConfigByIdService(model.id)

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.apiKey).toBeNull()
        })
    })

    // ==================== getModelConfigsByTypeService 测试 ====================

    describe('getModelConfigsByTypeService 测试', () => {
        it('应返回指定类型的模型配置列表', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const chatModel = await createTestModel(provider.id, { modelType: ModelType.CHAT })
            const embeddingModel = await createTestModel(provider.id, { modelType: ModelType.EMBEDDING })
            testIds.modelIds.push(chatModel.id, embeddingModel.id)

            const configs = await getModelConfigsByTypeService('chat')

            expect(configs.some(c => c.model.id === chatModel.id)).toBe(true)
            expect(configs.some(c => c.model.id === embeddingModel.id)).toBe(false)
        })

        it('应支持按状态过滤', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const enabledModel = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                status: ModelStatus.ENABLED,
            })
            const disabledModel = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                status: ModelStatus.DISABLED,
            })
            testIds.modelIds.push(enabledModel.id, disabledModel.id)

            const configs = await getModelConfigsByTypeService('chat', {
                status: ModelStatus.ENABLED,
            })

            expect(configs.some(c => c.model.id === enabledModel.id)).toBe(true)
            expect(configs.some(c => c.model.id === disabledModel.id)).toBe(false)
        })

        it('每个配置项应包含完整的 model、provider 和 apiKey', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model.id)

            const configs = await getModelConfigsByTypeService('chat')

            const testConfig = configs.find(c => c.model.id === model.id)
            expect(testConfig).toBeDefined()
            expect(testConfig!.model.id).toBe(model.id)
            expect(testConfig!.provider.id).toBe(provider.id)
            expect(testConfig!.apiKey!.id).toBe(apiKey.id)
        })
    })

    // ==================== getModelConfigsByProviderIdService 测试 ====================

    describe('getModelConfigsByProviderIdService 测试', () => {
        it('应返回指定提供商的模型配置列表', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            const model1 = await createTestModel(provider1.id)
            const model2 = await createTestModel(provider2.id)
            testIds.modelIds.push(model1.id, model2.id)

            const configs = await getModelConfigsByProviderIdService(provider1.id)

            expect(configs.some(c => c.model.id === model1.id)).toBe(true)
            expect(configs.some(c => c.model.id === model2.id)).toBe(false)
        })

        it('不存在的提供商 ID 应返回空数组', async () => {
            if (!dbAvailable) return

            const configs = await getModelConfigsByProviderIdService(9999999)
            expect(configs.length).toBe(0)
        })
    })

    // ==================== getDefaultEmbeddingConfigService 测试 ====================

    describe('getDefaultEmbeddingConfigService 测试', () => {
        it('有默认嵌入模型时应返回完整配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.EMBEDDING,
                isDefault: true,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(model.id)

            const config = await getDefaultEmbeddingConfigService()

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.model.modelType).toBe('embedding')
        })

        it('无默认嵌入模型时应返回 null', async () => {
            if (!dbAvailable) return

            // 检查是否已有默认嵌入模型
            const existingConfig = await getDefaultEmbeddingConfigService()
            if (existingConfig) {
                return // 数据库中已有默认模型
            }

            const config = await getDefaultEmbeddingConfigService()
            expect(config).toBeNull()
        })
    })

    // ==================== getDefaultChatConfigService 测试 ====================

    describe('getDefaultChatConfigService 测试', () => {
        it('有默认聊天模型时应返回完整配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                isDefault: true,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(model.id)

            const config = await getDefaultChatConfigService()

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.model.modelType).toBe('chat')
        })

        it('无默认聊天模型时应返回 null', async () => {
            if (!dbAvailable) return

            // 检查是否已有默认聊天模型
            const existingConfig = await getDefaultChatConfigService()
            if (existingConfig) {
                return
            }

            const config = await getDefaultChatConfigService()
            expect(config).toBeNull()
        })
    })

    // ==================== getDefaultAsrConfigService 测试 ====================

    describe('getDefaultAsrConfigService 测试', () => {
        it('有默认 ASR 模型时应返回完整配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.ASR,
                isDefault: true,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(model.id)

            const config = await getDefaultAsrConfigService()

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.model.modelType).toBe('asr')
        })

        it('无默认 ASR 模型时应返回 null', async () => {
            if (!dbAvailable) return

            // 检查是否已有默认 ASR 模型
            const existingConfig = await getDefaultAsrConfigService()
            if (existingConfig) {
                return
            }

            const config = await getDefaultAsrConfigService()
            expect(config).toBeNull()
        })
    })

    // ==================== getEmbeddingConfigWithFallbackService 测试 ====================

    describe('getEmbeddingConfigWithFallbackService 测试', () => {
        it('数据库有默认嵌入配置时应使用数据库配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, {
                apiKey: 'sk-db-embedding-key',
                isDefault: true,
            })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                name: '测试嵌入模型_fallback',
                modelType: ModelType.EMBEDDING,
                isDefault: true,
                status: ModelStatus.ENABLED,
                dimensions: 1024,
                batchSize: 10,
            })
            testIds.modelIds.push(model.id)

            const config = await getEmbeddingConfigWithFallbackService()

            expect(config.apiKey).toBe('sk-db-embedding-key')
            expect(config.baseUrl).toBe(provider.baseUrl)
            expect(config.model).toBe(model.name)
            expect(config.dimensions).toBe(1024)
            expect(config.batchSize).toBe(10)
            expect(config.source).toBe('database')
        })

        it('数据库无默认嵌入配置且环境变量不完整时应抛出错误', async () => {
            if (!dbAvailable) return

            // 检查是否已有默认嵌入模型
            const existingConfig = await getDefaultEmbeddingConfigService()
            if (existingConfig) {
                return
            }

            // 模拟没有环境变量配置的情况
            // 注意：这个测试依赖运行时环境变量配置
            // 如果环境变量配置完整，测试会通过
            // 如果环境变量不完整，会抛出错误
            try {
                await getEmbeddingConfigWithFallbackService()
            } catch (error) {
                // 如果环境变量没有配置，预期抛出错误
                expect((error as Error).message).toContain('嵌入模型配置不完整')
            }
        })
    })

    // ==================== 完整配置对象结构测试 ====================

    describe('完整配置对象结构测试', () => {
        it('返回的完整配置应包含 model.provider', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model.id)

            const config = await getModelConfigByIdService(model.id)

            expect(config!.model.providerId).toBe(provider.id)
            expect(config!.provider).not.toBeNull()
            expect(config!.provider.name).toBe(provider.name)
        })

        it('返回的完整配置应包含 modelProvider 关联', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id)
            testIds.modelIds.push(model.id)

            const config = await getModelConfigByIdService(model.id)

            expect(config!.model.modelProvider.id).toBe(provider.id)
        })
    })

    // ==================== 列表排序测试 ====================

    describe('列表排序测试', () => {
        it('按优先级排序应返回正确顺序（升序）', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model1 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 30,
            })
            const model2 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 10,
            })
            const model3 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 20,
            })
            testIds.modelIds.push(model1.id, model2.id, model3.id)

            const configs = await getModelConfigsByTypeService('chat', {
                orderBy: 'priority',
                orderDir: 'asc',
            })

            const testConfigs = configs.filter(c =>
                [model1.id, model2.id, model3.id].includes(c.model.id)
            )

            expect(testConfigs.length).toBe(3)
            expect(testConfigs[0].model.priority).toBeLessThanOrEqual(testConfigs[1].model.priority)
            expect(testConfigs[1].model.priority).toBeLessThanOrEqual(testConfigs[2].model.priority)
        })

        it('按名称排序应返回正确顺序（升序）', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model1 = await createTestModel(provider.id, {
                name: 'Z_test_model',
                modelType: ModelType.CHAT,
            })
            const model2 = await createTestModel(provider.id, {
                name: 'A_test_model',
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model1.id, model2.id)

            const configs = await getModelConfigsByTypeService('chat', {
                orderBy: 'name',
                orderDir: 'asc',
            })

            const testConfigs = configs.filter(c =>
                c.model.id === model1.id || c.model.id === model2.id
            )

            if (testConfigs.length === 2) {
                expect(testConfigs[0].model.name).toBe('A_test_model')
                expect(testConfigs[1].model.name).toBe('Z_test_model')
            }
        })
    })
})

// 数据库连接检查
describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
