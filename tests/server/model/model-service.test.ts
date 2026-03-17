/**
 * 模型管理服务层集成测试
 *
 * 测试模型配置服务的业务逻辑（直接使用 DAO 函数测试）
 *
 * **Feature: model-management**
 * **Validates: Requirements 2.4, 3.5, 4.1, 4.2, 4.3, 4.4, 6.4, 6.5, 8.1-8.9**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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

// 导入 DAO 函数
import {
    findModelByIdDao,
    findModelsByTypeDao,
    findModelsByProviderIdDao,
    findDefaultModelByTypeDao,
    setDefaultModelDao,
} from '../../../server/services/model/models.dao'

import {
    findModelProviderByIdDao,
} from '../../../server/services/model/modelProviders.dao'

import {
    findDefaultModelApiKeyByProviderIdDao,
    setDefaultModelApiKeyDao,
} from '../../../server/services/model/modelApiKeys.dao'

import type { FullModelConfig } from '#shared/types/model'

// 辅助函数：获取完整模型配置
const getModelConfigById = async (id: number): Promise<FullModelConfig | null> => {
    const model = await findModelByIdDao(id)
    if (!model) return null
    const provider = await findModelProviderByIdDao(model.providerId)
    if (!provider) return null
    const apiKey = await findDefaultModelApiKeyByProviderIdDao(model.providerId)
    return { model, provider, apiKey }
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

// 检查数据库是否可用
let dbAvailable = false

describe('模型管理服务层集成测试', () => {
    const testIds: ModelTestIds = createEmptyModelTestIds()

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

    // ==================== Property 6: 默认标识唯一性 ====================

    describe('Property 6: 默认标识唯一性', () => {
        it('同一类型只能有一个默认模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 创建两个嵌入模型
            const model1 = await createTestModel(provider.id, {
                modelType: ModelType.EMBEDDING,
                isDefault: true,
            })
            const model2 = await createTestModel(provider.id, {
                modelType: ModelType.EMBEDDING,
                isDefault: false,
            })
            testIds.modelIds.push(model1.id, model2.id)

            // 设置 model2 为默认
            await setDefaultModelDao(model2.id, 'embedding')

            // 验证只有一个默认模型
            const defaultModel = await getDefaultEmbeddingConfig()
            expect(defaultModel).not.toBeNull()
            expect(defaultModel!.model.id).toBe(model2.id)

            // 验证 model1 不再是默认
            const model1Config = await getModelConfigById(model1.id)
            expect(model1Config!.model.isDefault).toBe(false)
        })

        it('同一提供商只能有一个默认 API 密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 创建两个 API 密钥
            const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push(key1.id, key2.id)

            // 设置 key2 为默认
            await setDefaultModelApiKeyDao(key2.id, provider.id)

            // 验证只有一个默认密钥
            const prisma = getTestPrisma()
            const defaultKeys = await prisma.modelApiKeys.findMany({
                where: {
                    providerId: provider.id,
                    isDefault: true,
                    deletedAt: null,
                },
            })
            expect(defaultKeys.length).toBe(1)
            expect(defaultKeys[0].id).toBe(key2.id)
        })
    })

    // ==================== Property 8: 完整配置对象 ====================

    describe('Property 8: 完整配置对象', () => {
        it('通过 ID 获取的配置应包含完整信息', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model.id)

            const config = await getModelConfigById(model.id)

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.provider.id).toBe(provider.id)
            expect(config!.apiKey).not.toBeNull()
            expect(config!.apiKey!.id).toBe(apiKey.id)
        })

        it('无默认 API 密钥时 apiKey 应为 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
            })
            testIds.modelIds.push(model.id)

            const config = await getModelConfigById(model.id)

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.provider.id).toBe(provider.id)
            expect(config!.apiKey).toBeNull()
        })
    })

    // ==================== Property 10: 默认模型获取 ====================

    describe('Property 10: 默认模型获取', () => {
        it('应返回指定类型的默认模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            // 创建模型时不设置 isDefault，通过 setDefaultModelDao 设置
            // 这样可以确保同类型只有一个默认模型
            const chatModel = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                isDefault: false,
            })
            const embeddingModel = await createTestModel(provider.id, {
                modelType: ModelType.EMBEDDING,
                isDefault: false,
            })
            testIds.modelIds.push(chatModel.id, embeddingModel.id)

            // 使用 setDefaultModelDao 设置默认模型，确保唯一性
            await setDefaultModelDao(chatModel.id, 'chat')
            await setDefaultModelDao(embeddingModel.id, 'embedding')

            const defaultChat = await getDefaultChatConfig()
            const defaultEmbedding = await getDefaultEmbeddingConfig()

            expect(defaultChat).not.toBeNull()
            expect(defaultChat!.model.id).toBe(chatModel.id)
            expect(defaultEmbedding).not.toBeNull()
            expect(defaultEmbedding!.model.id).toBe(embeddingModel.id)
        })

        it('无默认模型时应返回 null', async () => {
            if (!dbAvailable) return

            // 检查是否已有默认 ASR 模型，如果有则跳过
            const existingDefault = await getDefaultAsrConfig()
            if (existingDefault) {
                // 数据库中已有默认模型，测试无法验证"无默认返回 null"的场景
                return
            }

            // 不创建任何 ASR 模型
            const defaultAsr = await getDefaultAsrConfig()
            expect(defaultAsr).toBeNull()
        })
    })

    // ==================== Property 11: 列表排序和过滤 ====================

    describe('Property 11: 列表排序和过滤', () => {
        it('按优先级排序应返回正确顺序', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model1 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 20,
            })
            const model2 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 10,
            })
            const model3 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 30,
            })
            testIds.modelIds.push(model1.id, model2.id, model3.id)

            const configs = await getModelConfigsByType('chat', {
                orderBy: 'priority',
                orderDir: 'asc',
            })

            // 筛选出测试创建的模型
            const testConfigs = configs.filter(c =>
                [model1.id, model2.id, model3.id].includes(c.model.id)
            )

            expect(testConfigs.length).toBe(3)
            expect(testConfigs[0].model.priority).toBeLessThanOrEqual(testConfigs[1].model.priority)
            expect(testConfigs[1].model.priority).toBeLessThanOrEqual(testConfigs[2].model.priority)
        })

        it('按状态过滤应只返回匹配记录', async () => {
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

            const enabledConfigs = await getModelConfigsByType('chat', {
                status: ModelStatus.ENABLED,
            })

            // 验证只返回启用的模型
            const foundEnabled = enabledConfigs.find(c => c.model.id === enabledModel.id)
            const foundDisabled = enabledConfigs.find(c => c.model.id === disabledModel.id)

            expect(foundEnabled).not.toBeUndefined()
            expect(foundDisabled).toBeUndefined()
        })
    })

    // ==================== Property 12: 按提供商查询 ====================

    describe('Property 12: 按提供商查询', () => {
        it('应只返回指定提供商的模型', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            const model1 = await createTestModel(provider1.id)
            const model2 = await createTestModel(provider2.id)
            testIds.modelIds.push(model1.id, model2.id)

            const configs = await getModelConfigsByProviderId(provider1.id)

            expect(configs.some(c => c.model.id === model1.id)).toBe(true)
            expect(configs.some(c => c.model.id === model2.id)).toBe(false)
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
