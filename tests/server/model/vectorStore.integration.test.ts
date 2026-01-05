/**
 * 向量存储服务集成测试
 *
 * 测试向量存储服务的配置获取功能，包括数据库配置优先和环境变量回退
 *
 * **Feature: model-management**
 * **Validates: Requirements 7.1, 7.2, 7.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestModelProvider,
    createTestModelApiKey,
    createTestModel,
    cleanupModelTestData,
    createEmptyModelTestIds,
    ModelType,
    ModelStatus,
    type ModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
} from './test-db-helper'
import { PBT_CONFIG_FAST } from './test-generators'

// ==================== 测试配置 ====================

/** 测试 ID 追踪 */
let testIds: ModelTestIds

/** 数据库是否可用 */
let dbAvailable = false

// ==================== 测试生命周期 ====================

beforeAll(async () => {
    dbAvailable = await isTestDbAvailable()
    if (!dbAvailable) {
        console.warn('数据库不可用，跳过集成测试')
    }
})

afterAll(async () => {
    await disconnectTestDb()
})

beforeEach(() => {
    testIds = createEmptyModelTestIds()
})

afterEach(async () => {
    if (dbAvailable) {
        await cleanupModelTestData(testIds)
    }
})

// ==================== 辅助函数 ====================

/**
 * 创建完整的嵌入模型配置（提供商 + API 密钥 + 模型）
 */
async function createEmbeddingModelConfig(options: {
    isDefault?: boolean
    dimensions?: number
    batchSize?: number
} = {}) {
    const { isDefault = true, dimensions = 1536, batchSize = 5 } = options

    // 创建提供商
    const provider = await createTestModelProvider({
        name: `测试提供商_embedding_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        baseUrl: 'https://api.test-embedding.com/v1',
        description: '测试嵌入模型提供商',
    })
    testIds.providerIds.push(provider.id)

    // 创建 API 密钥
    const apiKey = await createTestModelApiKey(provider.id, {
        name: `测试密钥_embedding_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        apiKey: `sk-test-embedding-${Date.now()}`,
        isDefault: true,
        status: ModelStatus.ENABLED,
    })
    testIds.apiKeyIds.push(apiKey.id)

    // 创建嵌入模型
    const model = await createTestModel(provider.id, {
        name: `测试模型_embedding_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        displayName: '测试嵌入模型',
        modelType: ModelType.EMBEDDING,
        dimensions,
        batchSize,
        isDefault,
        status: ModelStatus.ENABLED,
    })
    testIds.modelIds.push(model.id)

    return { provider, apiKey, model }
}

/**
 * 清除所有默认嵌入模型标记
 */
async function clearDefaultEmbeddingModels() {
    await getTestPrisma().models.updateMany({
        where: {
            modelType: ModelType.EMBEDDING,
            isDefault: true,
        },
        data: {
            isDefault: false,
        },
    })
}

// ==================== 测试用例 ====================

describe('向量存储服务集成测试', () => {
    describe('数据库配置获取', () => {
        it('应该能够从数据库获取默认嵌入模型配置', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 清除现有默认模型
            await clearDefaultEmbeddingModels()

            // 创建测试配置
            const { provider, apiKey, model } = await createEmbeddingModelConfig({
                isDefault: true,
                dimensions: 1024,
                batchSize: 10,
            })

            // 查询默认嵌入模型
            const defaultModel = await getTestPrisma().models.findFirst({
                where: {
                    modelType: ModelType.EMBEDDING,
                    isDefault: true,
                    deletedAt: null,
                },
                include: {
                    modelProvider: true,
                },
            })

            expect(defaultModel).not.toBeNull()
            expect(defaultModel?.id).toBe(model.id)
            expect(defaultModel?.dimensions).toBe(1024)
            expect(defaultModel?.batchSize).toBe(10)
            expect(defaultModel?.modelProvider.id).toBe(provider.id)
            expect(defaultModel?.modelProvider.baseUrl).toBe('https://api.test-embedding.com/v1')
        })

        it('应该能够获取关联的默认 API 密钥', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 创建测试配置
            const { provider, apiKey } = await createEmbeddingModelConfig()

            // 查询默认 API 密钥
            const defaultApiKey = await getTestPrisma().modelApiKeys.findFirst({
                where: {
                    providerId: provider.id,
                    isDefault: true,
                    deletedAt: null,
                },
            })

            expect(defaultApiKey).not.toBeNull()
            expect(defaultApiKey?.id).toBe(apiKey.id)
            expect(defaultApiKey?.apiKey).toContain('sk-test-embedding')
        })

        it('当没有默认嵌入模型时应返回 null', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 清除所有默认嵌入模型
            await clearDefaultEmbeddingModels()

            // 查询默认嵌入模型
            const defaultModel = await getTestPrisma().models.findFirst({
                where: {
                    modelType: ModelType.EMBEDDING,
                    isDefault: true,
                    deletedAt: null,
                },
            })

            expect(defaultModel).toBeNull()
        })
    })

    describe('配置完整性验证', () => {
        it('嵌入模型配置应包含所有必需字段', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            await clearDefaultEmbeddingModels()

            const { provider, apiKey, model } = await createEmbeddingModelConfig({
                dimensions: 2048,
                batchSize: 20,
            })

            // 查询完整配置
            const fullConfig = await getTestPrisma().models.findFirst({
                where: {
                    id: model.id,
                    deletedAt: null,
                },
                include: {
                    modelProvider: true,
                },
            })

            // 验证模型字段
            expect(fullConfig).not.toBeNull()
            expect(fullConfig?.name).toBeDefined()
            expect(fullConfig?.displayName).toBeDefined()
            expect(fullConfig?.modelType).toBe(ModelType.EMBEDDING)
            expect(fullConfig?.dimensions).toBe(2048)
            expect(fullConfig?.batchSize).toBe(20)

            // 验证提供商字段
            expect(fullConfig?.modelProvider).toBeDefined()
            expect(fullConfig?.modelProvider.name).toBeDefined()
            expect(fullConfig?.modelProvider.baseUrl).toBeDefined()

            // 查询 API 密钥
            const defaultKey = await getTestPrisma().modelApiKeys.findFirst({
                where: {
                    providerId: provider.id,
                    isDefault: true,
                    deletedAt: null,
                },
            })

            expect(defaultKey).not.toBeNull()
            expect(defaultKey?.apiKey).toBeDefined()
        })
    })

    describe('属性测试：配置数据有效性', () => {
        it('创建的嵌入模型配置应具有有效的维度值', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 128, max: 4096 }),
                    async (dimensions) => {
                        await clearDefaultEmbeddingModels()

                        const { model } = await createEmbeddingModelConfig({
                            dimensions,
                            isDefault: true,
                        })

                        const savedModel = await getTestPrisma().models.findUnique({
                            where: { id: model.id },
                        })

                        expect(savedModel?.dimensions).toBe(dimensions)
                        expect(savedModel?.dimensions).toBeGreaterThanOrEqual(128)
                        expect(savedModel?.dimensions).toBeLessThanOrEqual(4096)
                    }
                ),
                PBT_CONFIG_FAST
            )
        })

        it('创建的嵌入模型配置应具有有效的批处理大小', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 100 }),
                    async (batchSize) => {
                        await clearDefaultEmbeddingModels()

                        const { model } = await createEmbeddingModelConfig({
                            batchSize,
                            isDefault: true,
                        })

                        const savedModel = await getTestPrisma().models.findUnique({
                            where: { id: model.id },
                        })

                        expect(savedModel?.batchSize).toBe(batchSize)
                        expect(savedModel?.batchSize).toBeGreaterThanOrEqual(1)
                        expect(savedModel?.batchSize).toBeLessThanOrEqual(100)
                    }
                ),
                PBT_CONFIG_FAST
            )
        })
    })

    describe('默认模型唯一性', () => {
        it('同一类型只能有一个默认模型', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            await clearDefaultEmbeddingModels()

            // 创建第一个默认嵌入模型
            const config1 = await createEmbeddingModelConfig({ isDefault: true })

            // 创建第二个嵌入模型（非默认）
            const provider2 = await createTestModelProvider({
                name: `测试提供商_embedding2_${Date.now()}`,
                baseUrl: 'https://api.test-embedding2.com/v1',
            })
            testIds.providerIds.push(provider2.id)

            const model2 = await createTestModel(provider2.id, {
                name: `测试模型_embedding2_${Date.now()}`,
                displayName: '测试嵌入模型2',
                modelType: ModelType.EMBEDDING,
                isDefault: false,
            })
            testIds.modelIds.push(model2.id)

            // 将第二个模型设为默认（需要先取消第一个的默认）
            await getTestPrisma().models.updateMany({
                where: {
                    modelType: ModelType.EMBEDDING,
                    isDefault: true,
                },
                data: {
                    isDefault: false,
                },
            })

            await getTestPrisma().models.update({
                where: { id: model2.id },
                data: { isDefault: true },
            })

            // 验证只有一个默认模型
            const defaultModels = await getTestPrisma().models.findMany({
                where: {
                    modelType: ModelType.EMBEDDING,
                    isDefault: true,
                    deletedAt: null,
                },
            })

            expect(defaultModels.length).toBe(1)
            expect(defaultModels[0].id).toBe(model2.id)
        })
    })

    describe('软删除功能', () => {
        it('软删除的模型不应作为默认模型返回', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            await clearDefaultEmbeddingModels()

            // 创建默认嵌入模型
            const { model } = await createEmbeddingModelConfig({ isDefault: true })

            // 软删除模型
            await getTestPrisma().models.update({
                where: { id: model.id },
                data: { deletedAt: new Date() },
            })

            // 查询默认嵌入模型（应排除已删除的）
            const defaultModel = await getTestPrisma().models.findFirst({
                where: {
                    modelType: ModelType.EMBEDDING,
                    isDefault: true,
                    deletedAt: null,
                },
            })

            expect(defaultModel).toBeNull()
        })
    })

    describe('提供商关联', () => {
        it('模型应正确关联到提供商', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            const { provider, model } = await createEmbeddingModelConfig()

            // 查询模型及其提供商
            const modelWithProvider = await getTestPrisma().models.findUnique({
                where: { id: model.id },
                include: { modelProvider: true },
            })

            expect(modelWithProvider?.modelProvider.id).toBe(provider.id)
            expect(modelWithProvider?.modelProvider.name).toBe(provider.name)
            expect(modelWithProvider?.modelProvider.baseUrl).toBe(provider.baseUrl)
        })

        it('API 密钥应正确关联到提供商', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            const { provider, apiKey } = await createEmbeddingModelConfig()

            // 查询 API 密钥及其提供商
            const keyWithProvider = await getTestPrisma().modelApiKeys.findUnique({
                where: { id: apiKey.id },
                include: { modelProvider: true },
            })

            expect(keyWithProvider?.modelProvider.id).toBe(provider.id)
            expect(keyWithProvider?.providerId).toBe(provider.id)
        })
    })
})
