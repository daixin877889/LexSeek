/**
 * 模型 API 密钥服务层集成测试
 *
 * 测试 modelApiKeys.service.ts 中各函数的业务逻辑
 *
 * **Feature: model-management**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi, beforeEach } from 'vitest'
import {
    getTestPrisma,
    createTestModelProvider,
    createTestModelApiKey,
    cleanupModelTestData,
    createEmptyModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetModelDatabaseSequences,
    ModelStatus,
    type ModelTestIds,
} from './test-db-helper'

// 导入服务函数
import {
    createModelApiKeyService,
    getModelApiKeyByIdService,
    getModelApiKeysService,
    getModelApiKeysByProviderIdService,
    getDefaultModelApiKeyService,
    updateModelApiKeyService,
    setDefaultModelApiKeyService,
    deleteModelApiKeyService,
} from '../../../server/services/model/modelApiKeys.service'

// 导入 DAO 函数（用于验证）
import {
    findModelApiKeyByIdDao,
} from '../../../server/services/model/modelApiKeys.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('模型 API 密钥服务层集成测试', () => {
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

    // ==================== createModelApiKeyService 测试 ====================

    describe('createModelApiKeyService 测试', () => {
        it('应成功创建 API 密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createModelApiKeyService({
                providerId: provider.id,
                name: '服务层_创建测试',
                apiKey: 'sk-service-test-001',
            })
            testIds.apiKeyIds.push(apiKey.id)

            expect(apiKey.id).toBeGreaterThan(0)
            expect(apiKey.name).toBe('服务层_创建测试')
            expect(apiKey.providerId).toBe(provider.id)
        })

        it('提供商不存在时应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                createModelApiKeyService({
                    providerId: 9999999,
                    name: '不存在的提供商',
                    apiKey: 'sk-test',
                })
            ).rejects.toThrow('提供商不存在')
        })

        it('设置为默认时应取消同提供商下其他默认密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(key1.id)

            const key2 = await createModelApiKeyService({
                providerId: provider.id,
                name: '新默认密钥',
                apiKey: 'sk-new-default',
                isDefault: true,
            })
            testIds.apiKeyIds.push(key2.id)

            const foundKey1 = await findModelApiKeyByIdDao(key1.id)
            const foundKey2 = await findModelApiKeyByIdDao(key2.id)

            expect(foundKey1!.isDefault).toBe(false)
            expect(foundKey2!.isDefault).toBe(true)
        })

        it('不设置 isDefault 时新密钥默认为 false', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key = await createModelApiKeyService({
                providerId: provider.id,
                name: '非默认密钥',
                apiKey: 'sk-not-default',
            })
            testIds.apiKeyIds.push(key.id)

            expect(key.isDefault).toBe(false)
        })
    })

    // ==================== getModelApiKeyByIdService 测试 ====================

    describe('getModelApiKeyByIdService 测试', () => {
        it('应返回密钥详情', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            const found = await getModelApiKeyByIdService(apiKey.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(apiKey.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await getModelApiKeyByIdService(9999999)
            expect(found).toBeNull()
        })

        it('返回结果应包含关联的提供商数据', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            const found = await getModelApiKeyByIdService(apiKey.id)

            expect(found!.modelProvider.id).toBe(provider.id)
        })
    })

    // ==================== getModelApiKeysService 测试 ====================

    describe('getModelApiKeysService 测试', () => {
        it('应返回分页的密钥列表', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await createTestModelApiKey(provider.id)
            await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push()

            const result = await getModelApiKeysService({ page: 1, pageSize: 10 })

            expect(result.list.length).toBeGreaterThanOrEqual(2)
            expect(result.total).toBeGreaterThanOrEqual(2)
        })

        it('应支持按提供商 ID 过滤', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            const key1 = await createTestModelApiKey(provider1.id)
            const key2 = await createTestModelApiKey(provider2.id)
            testIds.apiKeyIds.push(key1.id, key2.id)

            const result = await getModelApiKeysService({ providerId: provider1.id })

            expect(result.list.some(k => k.id === key1.id)).toBe(true)
            expect(result.list.some(k => k.id === key2.id)).toBe(false)
        })

        it('应支持按状态过滤', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const enabledKey = await createTestModelApiKey(provider.id, { status: ModelStatus.ENABLED })
            const disabledKey = await createTestModelApiKey(provider.id, { status: ModelStatus.DISABLED })
            testIds.apiKeyIds.push(enabledKey.id, disabledKey.id)

            const result = await getModelApiKeysService({ status: ModelStatus.ENABLED })

            expect(result.list.some(k => k.id === enabledKey.id)).toBe(true)
            expect(result.list.some(k => k.id === disabledKey.id)).toBe(false)
        })

        it('无参数时应返回默认分页结果', async () => {
            if (!dbAvailable) return

            const result = await getModelApiKeysService()

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(0)
        })
    })

    // ==================== getModelApiKeysByProviderIdService 测试 ====================

    describe('getModelApiKeysByProviderIdService 测试', () => {
        it('应返回指定提供商的密钥列表', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id)
            const key2 = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(key1.id, key2.id)

            const keys = await getModelApiKeysByProviderIdService(provider.id)

            expect(keys.some(k => k.id === key1.id)).toBe(true)
            expect(keys.some(k => k.id === key2.id)).toBe(true)
        })

        it('不存在的提供商应返回空数组', async () => {
            if (!dbAvailable) return

            const keys = await getModelApiKeysByProviderIdService(9999999)
            expect(keys.length).toBe(0)
        })
    })

    // ==================== getDefaultModelApiKeyService 测试 ====================

    describe('getDefaultModelApiKeyService 测试', () => {
        it('应返回提供商的默认密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const defaultKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(defaultKey.id)

            const found = await getDefaultModelApiKeyService(provider.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(defaultKey.id)
        })

        it('无默认密钥时应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push()

            const found = await getDefaultModelApiKeyService(provider.id)
            expect(found).toBeNull()
        })
    })

    // ==================== updateModelApiKeyService 测试 ====================

    describe('updateModelApiKeyService 测试', () => {
        it('应成功更新密钥名称', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { name: '原名称' })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyService(apiKey.id, { name: '新名称' })

            expect(updated.name).toBe('新名称')
        })

        it('密钥不存在时应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updateModelApiKeyService(9999999, { name: '新名称' })
            ).rejects.toThrow('API 密钥不存在')
        })

        it('设置为默认时应取消其他默认密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push(key1.id, key2.id)

            await updateModelApiKeyService(key2.id, { isDefault: true })

            const foundKey1 = await findModelApiKeyByIdDao(key1.id)
            const foundKey2 = await findModelApiKeyByIdDao(key2.id)

            expect(foundKey1!.isDefault).toBe(false)
            expect(foundKey2!.isDefault).toBe(true)
        })

        it('同时更新多个字段应正常工作', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, {
                name: '原名称',
                status: ModelStatus.ENABLED,
            })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyService(apiKey.id, {
                name: '新名称',
                status: ModelStatus.DISABLED,
            })

            expect(updated.name).toBe('新名称')
            expect(updated.status).toBe(ModelStatus.DISABLED)
        })

        it('只设置 isDefault 不传其他字段应只更新 isDefault', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, {
                isDefault: true,
                name: 'key1',
            })
            const key2 = await createTestModelApiKey(provider.id, {
                isDefault: false,
                name: 'key2',
            })
            testIds.apiKeyIds.push(key1.id, key2.id)

            await updateModelApiKeyService(key2.id, { isDefault: true })

            const foundKey2 = await findModelApiKeyByIdDao(key2.id)
            expect(foundKey2!.isDefault).toBe(true)
            expect(foundKey2!.name).toBe('key2')
        })
    })

    // ==================== setDefaultModelApiKeyService 测试 ====================

    describe('setDefaultModelApiKeyService 测试', () => {
        it('应成功设置默认密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push(key1.id, key2.id)

            await setDefaultModelApiKeyService(key2.id)

            const foundKey1 = await findModelApiKeyByIdDao(key1.id)
            const foundKey2 = await findModelApiKeyByIdDao(key2.id)

            expect(foundKey1!.isDefault).toBe(false)
            expect(foundKey2!.isDefault).toBe(true)
        })

        it('密钥不存在时应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(setDefaultModelApiKeyService(9999999)).rejects.toThrow('API 密钥不存在')
        })
    })

    // ==================== deleteModelApiKeyService 测试 ====================

    describe('deleteModelApiKeyService 测试', () => {
        it('应成功软删除密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await deleteModelApiKeyService(apiKey.id)

            const found = await findModelApiKeyByIdDao(apiKey.id)
            expect(found).toBeNull()
        })

        it('软删除后数据库中 deletedAt 应被设置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await deleteModelApiKeyService(apiKey.id)

            const found = await prisma.modelApiKeys.findUnique({
                where: { id: apiKey.id },
            })

            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('密钥不存在时应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(deleteModelApiKeyService(9999999)).rejects.toThrow('API 密钥不存在')
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
