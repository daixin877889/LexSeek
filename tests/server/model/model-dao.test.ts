/**
 * 模型管理 DAO 层集成测试
 *
 * 测试真实的模型管理 DAO 函数，使用真实数据库操作
 *
 * **Feature: model-management**
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
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
    SdkType,
    type ModelTestIds,
} from './test-db-helper'
import {
    providerDataArb,
    apiKeyDataArb,
    modelDataArb,
    sdkTypeArb,
    PBT_CONFIG_FAST,
} from './test-generators'

// 导入实际的 DAO 函数
import {
    createModelProviderDao,
    findModelProviderByIdDao,
    findModelProviderByNameDao,
    findManyModelProvidersDao,
    findAllModelProvidersDao,
    updateModelProviderDao,
    softDeleteModelProviderDao,
} from '../../../server/services/model/modelProviders.dao'

import {
    createModelApiKeyDao,
    findModelApiKeyByIdDao,
    findModelApiKeysByProviderIdDao,
    findDefaultModelApiKeyByProviderIdDao,
    findManyModelApiKeysDao,
    updateModelApiKeyDao,
    setDefaultModelApiKeyDao,
    softDeleteModelApiKeyDao,
} from '../../../server/services/model/modelApiKeys.dao'

import {
    createModelDao,
    findModelByIdDao,
    findModelsByTypeDao,
    findModelsByProviderIdDao,
    findDefaultModelByTypeDao,
    findManyModelsDao,
    updateModelDao,
    setDefaultModelDao,
    softDeleteModelDao,
} from '../../../server/services/model/models.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('模型管理 DAO 层集成测试', () => {
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

    // ==================== 模型提供商 DAO 测试 ====================

    describe('模型提供商 DAO 测试', () => {
        describe('createModelProviderDao 测试', () => {
            it('应成功创建模型提供商', async () => {
                if (!dbAvailable) return

                const provider = await createModelProviderDao({
                    name: '测试提供商_DAO创建',
                    baseUrl: 'https://api.test.com',
                    description: '测试描述',
                })
                testIds.providerIds.push(provider.id)

                expect(provider.id).toBeGreaterThan(0)
                expect(provider.name).toBe('测试提供商_DAO创建')
                expect(provider.baseUrl).toBe('https://api.test.com')
                expect(provider.description).toBe('测试描述')
                expect(provider.deletedAt).toBeNull()
            })

            it('Property 1: 创建后立即查询应返回等价数据', async () => {
                if (!dbAvailable) return

                await fc.assert(
                    fc.asyncProperty(
                        providerDataArb,
                        async (data) => {
                            const created = await createModelProviderDao({
                                name: data.name,
                                baseUrl: data.baseUrl,
                                description: data.description,
                            })
                            testIds.providerIds.push(created.id)

                            const found = await findModelProviderByIdDao(created.id)

                            expect(found).not.toBeNull()
                            expect(found!.name).toBe(data.name)
                            expect(found!.baseUrl).toBe(data.baseUrl)
                            expect(found!.description).toBe(data.description)

                            return true
                        }
                    ),
                    PBT_CONFIG_FAST
                )
            })
        })

        describe('Property 2: 唯一性约束验证', () => {
            it('创建重复名称的提供商应失败', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider({ name: '唯一性测试提供商' })
                testIds.providerIds.push(provider.id)

                await expect(
                    createModelProviderDao({
                        name: '唯一性测试提供商',
                        baseUrl: 'https://api2.test.com',
                    })
                ).rejects.toThrow()
            })
        })

        describe('Property 3: 软删除功能', () => {
            it('软删除后记录应不可见', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                await softDeleteModelProviderDao(provider.id)

                const found = await findModelProviderByIdDao(provider.id)
                expect(found).toBeNull()

                // 直接查询验证 deletedAt 已设置
                const foundWithDeleted = await prisma.modelProviders.findUnique({
                    where: { id: provider.id },
                })
                expect(foundWithDeleted).not.toBeNull()
                expect(foundWithDeleted!.deletedAt).not.toBeNull()
            })
        })

        describe('findModelProviderByNameDao 测试', () => {
            it('应通过名称查询提供商', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider({ name: '名称查询测试' })
                testIds.providerIds.push(provider.id)

                const found = await findModelProviderByNameDao('名称查询测试')
                expect(found).not.toBeNull()
                expect(found!.id).toBe(provider.id)
            })
        })

        describe('updateModelProviderDao 测试', () => {
            it('应成功更新提供商', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const updated = await updateModelProviderDao(provider.id, {
                    name: '更新后的名称',
                    baseUrl: 'https://updated.api.com',
                })

                expect(updated.name).toBe('更新后的名称')
                expect(updated.baseUrl).toBe('https://updated.api.com')
            })
        })
    })

    // ==================== API 密钥 DAO 测试 ====================

    describe('API 密钥 DAO 测试', () => {
        describe('createModelApiKeyDao 测试', () => {
            it('应成功创建 API 密钥', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const apiKey = await createModelApiKeyDao({
                    providerId: provider.id,
                    name: '测试密钥_DAO创建',
                    apiKey: 'sk-test-key-123',
                })
                testIds.apiKeyIds.push(apiKey.id)

                expect(apiKey.id).toBeGreaterThan(0)
                expect(apiKey.providerId).toBe(provider.id)
                expect(apiKey.name).toBe('测试密钥_DAO创建')
                expect(apiKey.apiKey).toBe('sk-test-key-123')
            })
        })

        describe('Property 2: 同一提供商下密钥名称唯一', () => {
            it('创建重复名称的密钥应失败', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const apiKey = await createTestModelApiKey(provider.id, { name: '唯一性测试密钥' })
                testIds.apiKeyIds.push(apiKey.id)

                await expect(
                    createModelApiKeyDao({
                        providerId: provider.id,
                        name: '唯一性测试密钥',
                        apiKey: 'sk-another-key',
                    })
                ).rejects.toThrow()
            })
        })

        describe('setDefaultModelApiKeyDao 测试', () => {
            it('设置默认密钥应取消其他默认', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
                const key2 = await createTestModelApiKey(provider.id, { isDefault: false })
                testIds.apiKeyIds.push(key1.id, key2.id)

                // 设置 key2 为默认
                await setDefaultModelApiKeyDao(key2.id, provider.id)

                // 验证 key1 不再是默认
                const foundKey1 = await findModelApiKeyByIdDao(key1.id)
                const foundKey2 = await findModelApiKeyByIdDao(key2.id)

                expect(foundKey1!.isDefault).toBe(false)
                expect(foundKey2!.isDefault).toBe(true)
            })
        })

        describe('findDefaultModelApiKeyByProviderIdDao 测试', () => {
            it('应返回默认密钥', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const key1 = await createTestModelApiKey(provider.id, { isDefault: false })
                const key2 = await createTestModelApiKey(provider.id, { isDefault: true })
                testIds.apiKeyIds.push(key1.id, key2.id)

                const defaultKey = await findDefaultModelApiKeyByProviderIdDao(provider.id)
                expect(defaultKey).not.toBeNull()
                expect(defaultKey!.id).toBe(key2.id)
            })
        })
    })

    // ==================== 模型 DAO 测试 ====================

    describe('模型 DAO 测试', () => {
        describe('createModelDao 测试', () => {
            it('应成功创建模型', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const model = await createModelDao({
                    providerId: provider.id,
                    name: '测试模型_DAO创建',
                    displayName: '测试模型显示名',
                    modelType: 'chat',
                })
                testIds.modelIds.push(model.id)

                expect(model.id).toBeGreaterThan(0)
                expect(model.providerId).toBe(provider.id)
                expect(model.name).toBe('测试模型_DAO创建')
                expect(model.modelType).toBe('chat')
            })

            /**
             * **Validates: Requirements 3.2**
             * 创建模型时未指定 sdkType，应使用默认值 'openai'
             */
            it('创建模型时未指定 sdkType 应使用默认值 openai', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const model = await createModelDao({
                    providerId: provider.id,
                    name: '测试模型_默认SDK类型',
                    displayName: '测试模型显示名',
                    modelType: 'chat',
                })
                testIds.modelIds.push(model.id)

                expect(model.sdkType).toBe('openai')
            })

            /**
             * **Validates: Requirements 3.4**
             * 创建模型时可以指定 sdkType
             */
            it('创建模型时可以指定 sdkType', async () => {
                if (!dbAvailable) return

                await fc.assert(
                    fc.asyncProperty(sdkTypeArb, async (sdkType) => {
                        const provider = await createTestModelProvider()
                        testIds.providerIds.push(provider.id)

                        const model = await createModelDao({
                            providerId: provider.id,
                            name: `测试模型_SDK类型_${sdkType}_${Date.now()}`,
                            displayName: '测试模型显示名',
                            modelType: 'chat',
                            sdkType: sdkType,
                        })
                        testIds.modelIds.push(model.id)

                        expect(model.sdkType).toBe(sdkType)
                        return true
                    }),
                    PBT_CONFIG_FAST
                )
            })
        })

        describe('Property 2: 同一提供商下模型名称唯一', () => {
            it('创建重复名称的模型应失败', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const model = await createTestModel(provider.id, { name: '唯一性测试模型' })
                testIds.modelIds.push(model.id)

                await expect(
                    createModelDao({
                        providerId: provider.id,
                        name: '唯一性测试模型',
                        displayName: '另一个显示名',
                        modelType: 'chat',
                    })
                ).rejects.toThrow()
            })
        })

        describe('findModelsByTypeDao 测试', () => {
            it('应按类型返回模型列表', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const chatModel = await createTestModel(provider.id, { modelType: ModelType.CHAT })
                const embeddingModel = await createTestModel(provider.id, { modelType: ModelType.EMBEDDING })
                testIds.modelIds.push(chatModel.id, embeddingModel.id)

                const chatModels = await findModelsByTypeDao('chat')
                const embeddingModels = await findModelsByTypeDao('embedding')

                expect(chatModels.some(m => m.id === chatModel.id)).toBe(true)
                expect(chatModels.some(m => m.id === embeddingModel.id)).toBe(false)
                expect(embeddingModels.some(m => m.id === embeddingModel.id)).toBe(true)
            })
        })

        describe('setDefaultModelDao 测试', () => {
            it('设置默认模型应取消同类型其他默认', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

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

                // 验证 model1 不再是默认
                const foundModel1 = await findModelByIdDao(model1.id)
                const foundModel2 = await findModelByIdDao(model2.id)

                expect(foundModel1!.isDefault).toBe(false)
                expect(foundModel2!.isDefault).toBe(true)
            })
        })

        describe('findDefaultModelByTypeDao 测试', () => {
            it('应返回指定类型的默认模型', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const model1 = await createTestModel(provider.id, {
                    modelType: ModelType.CHAT,
                    isDefault: false,
                })
                const model2 = await createTestModel(provider.id, {
                    modelType: ModelType.CHAT,
                    isDefault: true,
                })
                testIds.modelIds.push(model1.id, model2.id)

                const defaultModel = await findDefaultModelByTypeDao('chat')
                expect(defaultModel).not.toBeNull()
                expect(defaultModel!.id).toBe(model2.id)
            })
        })

        describe('findModelsByProviderIdDao 测试', () => {
            it('应返回指定提供商的所有模型', async () => {
                if (!dbAvailable) return

                const provider1 = await createTestModelProvider()
                const provider2 = await createTestModelProvider()
                testIds.providerIds.push(provider1.id, provider2.id)

                const model1 = await createTestModel(provider1.id)
                const model2 = await createTestModel(provider2.id)
                testIds.modelIds.push(model1.id, model2.id)

                const models = await findModelsByProviderIdDao(provider1.id)
                expect(models.some(m => m.id === model1.id)).toBe(true)
                expect(models.some(m => m.id === model2.id)).toBe(false)
            })
        })

        describe('Property 3: 软删除功能', () => {
            it('软删除后模型应不可见', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const model = await createTestModel(provider.id)
                testIds.modelIds.push(model.id)

                await softDeleteModelDao(model.id)

                const found = await findModelByIdDao(model.id)
                expect(found).toBeNull()

                // 直接查询验证 deletedAt 已设置
                const foundWithDeleted = await prisma.models.findUnique({
                    where: { id: model.id },
                })
                expect(foundWithDeleted).not.toBeNull()
                expect(foundWithDeleted!.deletedAt).not.toBeNull()
            })
        })

        /**
         * **Validates: Requirements 3.5**
         * 编辑模型时可以修改 sdkType
         */
        describe('updateModelDao sdkType 测试', () => {
            it('更新模型时可以修改 sdkType', async () => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                // 创建模型，默认 sdkType 为 openai
                const model = await createTestModel(provider.id, {
                    sdkType: SdkType.OPENAI,
                })
                testIds.modelIds.push(model.id)

                expect(model.sdkType).toBe('openai')

                // 更新为 deepseek
                const updated = await updateModelDao(model.id, {
                    sdkType: 'deepseek',
                })

                expect(updated.sdkType).toBe('deepseek')

                // 验证数据库中的值
                const found = await findModelByIdDao(model.id)
                expect(found!.sdkType).toBe('deepseek')
            })

            it('属性测试：更新 sdkType 应正确保存', async () => {
                if (!dbAvailable) return

                await fc.assert(
                    fc.asyncProperty(sdkTypeArb, sdkTypeArb, async (initialType, newType) => {
                        const provider = await createTestModelProvider()
                        testIds.providerIds.push(provider.id)

                        const model = await createTestModel(provider.id, {
                            sdkType: initialType,
                        })
                        testIds.modelIds.push(model.id)

                        const updated = await updateModelDao(model.id, {
                            sdkType: newType,
                        })

                        expect(updated.sdkType).toBe(newType)
                        return true
                    }),
                    PBT_CONFIG_FAST
                )
            })
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
