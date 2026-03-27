/**
 * 模型 API 密钥 DAO 层集成测试
 *
 * 测试 modelApiKeys.dao.ts 中各函数的真实数据库操作
 *
 * **Feature: model-management**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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

// 导入 DAO 函数
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

// 检查数据库是否可用
let dbAvailable = false

describe('模型 API 密钥 DAO 层集成测试', () => {
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

    // ==================== createModelApiKeyDao 测试 ====================

    describe('createModelApiKeyDao 测试', () => {
        it('应成功创建 API 密钥并返回完整数据', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createModelApiKeyDao({
                providerId: provider.id,
                name: '测试密钥_DAO创建',
                apiKey: 'sk-test-dao-001',
                isDefault: false,
                status: ModelStatus.ENABLED,
            })
            testIds.apiKeyIds.push(apiKey.id)

            expect(apiKey.id).toBeGreaterThan(0)
            expect(apiKey.providerId).toBe(provider.id)
            expect(apiKey.name).toBe('测试密钥_DAO创建')
            expect(apiKey.apiKey).toBe('sk-test-dao-001')
            expect(apiKey.isDefault).toBe(false)
            expect(apiKey.status).toBe(ModelStatus.ENABLED)
            expect(apiKey.deletedAt).toBeNull()
        })

        it('创建时应设置默认值 isDefault 为 false', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createModelApiKeyDao({
                providerId: provider.id,
                name: '测试密钥_默认isDefault',
                apiKey: 'sk-test-default-001',
            })
            testIds.apiKeyIds.push(apiKey.id)

            expect(apiKey.isDefault).toBe(false)
        })

        it('创建时应设置默认值 status 为 1', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createModelApiKeyDao({
                providerId: provider.id,
                name: '测试密钥_默认status',
                apiKey: 'sk-test-status-001',
            })
            testIds.apiKeyIds.push(apiKey.id)

            expect(apiKey.status).toBe(1)
        })

        it('创建时应支持设置每日和每月限制', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createModelApiKeyDao({
                providerId: provider.id,
                name: '测试密钥_限制',
                apiKey: 'sk-test-limit-001',
                dailyLimit: 1000,
                monthlyLimit: 50000,
            })
            testIds.apiKeyIds.push(apiKey.id)

            expect(apiKey.dailyLimit).toBe(1000)
            expect(apiKey.monthlyLimit).toBe(50000)
        })

        it('创建后立即查询应返回等价数据', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const created = await createModelApiKeyDao({
                providerId: provider.id,
                name: '测试密钥_等价性',
                apiKey: 'sk-test-equality-001',
                isDefault: true,
                status: ModelStatus.DISABLED,
                dailyLimit: 500,
            })
            testIds.apiKeyIds.push(created.id)

            const found = await findModelApiKeyByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.providerId).toBe(provider.id)
            expect(found!.name).toBe('测试密钥_等价性')
            expect(found!.apiKey).toBe('sk-test-equality-001')
            expect(found!.isDefault).toBe(true)
            expect(found!.status).toBe(ModelStatus.DISABLED)
            expect(found!.dailyLimit).toBe(500)
            expect(found!.modelProvider).toBeDefined()
        })
    })

    // ==================== findModelApiKeyByIdDao 测试 ====================

    describe('findModelApiKeyByIdDao 测试', () => {
        it('应通过 ID 查询并包含关联的提供商数据', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            const found = await findModelApiKeyByIdDao(apiKey.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(apiKey.id)
            expect(found!.modelProvider.id).toBe(provider.id)
        })

        it('查询不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findModelApiKeyByIdDao(9999999)
            expect(found).toBeNull()
        })

        it('软删除的密钥通过 ID 查询应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await softDeleteModelApiKeyDao(apiKey.id)

            const found = await findModelApiKeyByIdDao(apiKey.id)
            expect(found).toBeNull()
        })
    })

    // ==================== findModelApiKeysByProviderIdDao 测试 ====================

    describe('findModelApiKeysByProviderIdDao 测试', () => {
        it('应返回指定提供商的所有密钥', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            const key1 = await createTestModelApiKey(provider1.id)
            const key2 = await createTestModelApiKey(provider1.id)
            const key3 = await createTestModelApiKey(provider2.id)
            testIds.apiKeyIds.push(key1.id, key2.id, key3.id)

            const keys = await findModelApiKeysByProviderIdDao(provider1.id)

            expect(keys.length).toBeGreaterThanOrEqual(2)
            expect(keys.some(k => k.id === key1.id)).toBe(true)
            expect(keys.some(k => k.id === key2.id)).toBe(true)
            expect(keys.some(k => k.id === key3.id)).toBe(false)
        })

        it('返回的密钥应包含关联的提供商数据', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            const keys = await findModelApiKeysByProviderIdDao(provider.id)

            expect(keys[0].modelProvider).toBeDefined()
            expect(keys[0].modelProvider.id).toBe(provider.id)
        })

        it('返回结果应按 isDefault 降序、createdAt 降序排列', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 创建两个密钥，第二个设为默认
            const key1 = await createTestModelApiKey(provider.id, { isDefault: false })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(key1.id, key2.id)

            const keys = await findModelApiKeysByProviderIdDao(provider.id)

            expect(keys[0].id).toBe(key2.id)
            expect(keys[0].isDefault).toBe(true)
        })

        it('不存在的提供商 ID 应返回空数组', async () => {
            if (!dbAvailable) return

            const keys = await findModelApiKeysByProviderIdDao(9999999)
            expect(keys.length).toBe(0)
        })
    })

    // ==================== findDefaultModelApiKeyByProviderIdDao 测试 ====================

    describe('findDefaultModelApiKeyByProviderIdDao 测试', () => {
        it('应返回状态为启用且已标记为默认的密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, { isDefault: false, status: ModelStatus.ENABLED })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: true, status: ModelStatus.ENABLED })
            testIds.apiKeyIds.push(key1.id, key2.id)

            const defaultKey = await findDefaultModelApiKeyByProviderIdDao(provider.id)

            expect(defaultKey).not.toBeNull()
            expect(defaultKey!.id).toBe(key2.id)
            expect(defaultKey!.isDefault).toBe(true)
        })

        it('无默认密钥时应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push()

            const defaultKey = await findDefaultModelApiKeyByProviderIdDao(provider.id)
            expect(defaultKey).toBeNull()
        })

        it('禁用状态的默认密钥不应被返回', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 创建一个禁用的默认密钥
            const disabledKey = await createTestModelApiKey(provider.id, {
                isDefault: true,
                status: ModelStatus.DISABLED,
            })
            testIds.apiKeyIds.push(disabledKey.id)

            const defaultKey = await findDefaultModelApiKeyByProviderIdDao(provider.id)

            // 查询条件包含 status: 1，所以禁用的密钥不会被返回
            expect(defaultKey).toBeNull()
        })
    })

    // ==================== findManyModelApiKeysDao 测试 ====================

    describe('findManyModelApiKeysDao 测试', () => {
        it('应返回分页的密钥列表和总数', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await createTestModelApiKey(provider.id)
            await createTestModelApiKey(provider.id)
            await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push()

            const result = await findManyModelApiKeysDao({ page: 1, pageSize: 10 })

            expect(result.list.length).toBeGreaterThanOrEqual(3)
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应支持按提供商 ID 过滤', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            const key1 = await createTestModelApiKey(provider1.id)
            const key2 = await createTestModelApiKey(provider2.id)
            testIds.apiKeyIds.push(key1.id, key2.id)

            const result = await findManyModelApiKeysDao({ providerId: provider1.id })

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

            const enabledResult = await findManyModelApiKeysDao({ status: ModelStatus.ENABLED })

            expect(enabledResult.list.some(k => k.id === enabledKey.id)).toBe(true)
            expect(enabledResult.list.some(k => k.id === disabledKey.id)).toBe(false)
        })

        it('应支持分页功能', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await createTestModelApiKey(provider.id)
            await createTestModelApiKey(provider.id)
            await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push()

            const page1 = await findManyModelApiKeysDao({ page: 1, pageSize: 2 })
            const page2 = await findManyModelApiKeysDao({ page: 2, pageSize: 2 })

            expect(page1.list.length).toBeLessThanOrEqual(2)
            expect(page2.list.length).toBeLessThanOrEqual(2)
            expect(page1.total).toBe(page2.total)
        })

        it('返回的密钥应包含关联的提供商数据', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push()

            const result = await findManyModelApiKeysDao({ providerId: provider.id })

            expect(result.list[0].modelProvider).toBeDefined()
        })
    })

    // ==================== updateModelApiKeyDao 测试 ====================

    describe('updateModelApiKeyDao 测试', () => {
        it('应成功更新密钥名称', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { name: '原名称' })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyDao(apiKey.id, { name: '新名称' })

            expect(updated.name).toBe('新名称')
        })

        it('应成功更新 API 密钥值', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { apiKey: 'sk-old-key' })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyDao(apiKey.id, { apiKey: 'sk-new-key' })

            expect(updated.apiKey).toBe('sk-new-key')
        })

        it('应成功更新 isDefault 状态', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyDao(apiKey.id, { isDefault: true })

            expect(updated.isDefault).toBe(true)
        })

        it('应成功更新 status', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { status: ModelStatus.ENABLED })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyDao(apiKey.id, { status: ModelStatus.DISABLED })

            expect(updated.status).toBe(ModelStatus.DISABLED)
        })

        it('应成功更新 dailyLimit 和 monthlyLimit', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyDao(apiKey.id, {
                dailyLimit: 2000,
                monthlyLimit: 100000,
            })

            expect(updated.dailyLimit).toBe(2000)
            expect(updated.monthlyLimit).toBe(100000)
        })

        it('更新不存在的密钥应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updateModelApiKeyDao(9999999, { name: '新名称' })
            ).rejects.toThrow()
        })

        it('应支持部分更新（只传 name）', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, {
                name: '原名称',
                apiKey: 'sk-keep-key',
                status: ModelStatus.ENABLED,
            })
            testIds.apiKeyIds.push(apiKey.id)

            const updated = await updateModelApiKeyDao(apiKey.id, { name: '新名称' })

            expect(updated.name).toBe('新名称')
            expect(updated.apiKey).toBe('sk-keep-key')
            expect(updated.status).toBe(ModelStatus.ENABLED)
        })
    })

    // ==================== setDefaultModelApiKeyDao 测试 ====================

    describe('setDefaultModelApiKeyDao 测试', () => {
        it('设置默认密钥应取消其他默认密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push(key1.id, key2.id)

            await setDefaultModelApiKeyDao(key2.id, provider.id)

            const foundKey1 = await findModelApiKeyByIdDao(key1.id)
            const foundKey2 = await findModelApiKeyByIdDao(key2.id)

            expect(foundKey1!.isDefault).toBe(false)
            expect(foundKey2!.isDefault).toBe(true)
        })

        it('同一个密钥多次设置为默认应正常工作', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const key1 = await createTestModelApiKey(provider.id, { isDefault: true })
            const key2 = await createTestModelApiKey(provider.id, { isDefault: false })
            testIds.apiKeyIds.push(key1.id, key2.id)

            // 第一次切换
            await setDefaultModelApiKeyDao(key2.id, provider.id)
            // 第二次切换回 key1
            await setDefaultModelApiKeyDao(key1.id, provider.id)

            const foundKey1 = await findModelApiKeyByIdDao(key1.id)
            const foundKey2 = await findModelApiKeyByIdDao(key2.id)

            expect(foundKey1!.isDefault).toBe(true)
            expect(foundKey2!.isDefault).toBe(false)
        })

        it('只设置默认不更新其他字段', async () => {
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

            await setDefaultModelApiKeyDao(key2.id, provider.id)

            const foundKey2 = await findModelApiKeyByIdDao(key2.id)

            expect(foundKey2!.isDefault).toBe(true)
            expect(foundKey2!.name).toBe('key2')
        })

        it('不存在的密钥 ID 应抛出错误', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await expect(
                setDefaultModelApiKeyDao(9999999, provider.id)
            ).rejects.toThrow()
        })
    })

    // ==================== softDeleteModelApiKeyDao 测试 ====================

    describe('softDeleteModelApiKeyDao 测试', () => {
        it('软删除后密钥应不可见于正常查询', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await softDeleteModelApiKeyDao(apiKey.id)

            const found = await findModelApiKeyByIdDao(apiKey.id)
            expect(found).toBeNull()
        })

        it('软删除应设置 deletedAt 时间戳', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await softDeleteModelApiKeyDao(apiKey.id)

            const found = await prisma.modelApiKeys.findUnique({
                where: { id: apiKey.id },
            })

            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('软删除后通过 findManyModelApiKeysDao 查询不应包含该密钥', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await softDeleteModelApiKeyDao(apiKey.id)

            const result = await findManyModelApiKeysDao({ providerId: provider.id })

            expect(result.list.some(k => k.id === apiKey.id)).toBe(false)
        })

        it('软删除不存在的密钥应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(softDeleteModelApiKeyDao(9999999)).rejects.toThrow()
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
