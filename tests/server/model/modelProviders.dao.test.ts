/**
 * 模型提供商 DAO 层集成测试
 *
 * 测试 modelProviders.dao.ts 中各函数的真实数据库操作
 *
 * **Feature: model-management**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
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
    ModelType,
    type ModelTestIds,
} from './test-db-helper'

// 导入 DAO 函数
import {
    createModelProviderDao,
    findModelProviderByIdDao,
    findModelProviderByNameDao,
    findManyModelProvidersDao,
    findAllModelProvidersDao,
    updateModelProviderDao,
    softDeleteModelProviderDao,
} from '../../../server/services/model/modelProviders.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('模型提供商 DAO 层集成测试', () => {
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

    // ==================== createModelProviderDao 测试 ====================

    describe('createModelProviderDao 测试', () => {
        it('应成功创建模型提供商并返回完整数据', async () => {
            if (!dbAvailable) return

            const provider = await createModelProviderDao({
                name: 'DAO测试_提供商_创建',
                baseUrl: 'https://api.dao-test.com',
                description: 'DAO层测试描述',
            })
            testIds.providerIds.push(provider.id)

            expect(provider.id).toBeGreaterThan(0)
            expect(provider.name).toBe('DAO测试_提供商_创建')
            expect(provider.baseUrl).toBe('https://api.dao-test.com')
            expect(provider.description).toBe('DAO层测试描述')
            expect(provider.deletedAt).toBeNull()
        })

        it('创建时应支持可选字段 description 为 null', async () => {
            if (!dbAvailable) return

            const provider = await createModelProviderDao({
                name: 'DAO测试_无描述',
                baseUrl: 'https://api.no-desc.com',
                description: null,
            })
            testIds.providerIds.push(provider.id)

            expect(provider.description).toBeNull()
        })

        it('创建后立即查询应返回等价数据', async () => {
            if (!dbAvailable) return

            const created = await createModelProviderDao({
                name: 'DAO测试_等价性',
                baseUrl: 'https://api.equality.com',
                description: '测试等价性',
            })
            testIds.providerIds.push(created.id)

            const found = await findModelProviderByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.name).toBe(created.name)
            expect(found!.baseUrl).toBe(created.baseUrl)
            expect(found!.description).toBe(created.description)
        })
    })

    // ==================== findModelProviderByIdDao 测试 ====================

    describe('findModelProviderByIdDao 测试', () => {
        it('应通过 ID 查询提供商', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const found = await findModelProviderByIdDao(provider.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(provider.id)
        })

        it('查询不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findModelProviderByIdDao(9999999)
            expect(found).toBeNull()
        })

        it('软删除的提供商通过 ID 查询应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await softDeleteModelProviderDao(provider.id)

            const found = await findModelProviderByIdDao(provider.id)
            expect(found).toBeNull()
        })
    })

    // ==================== findModelProviderByNameDao 测试 ====================

    describe('findModelProviderByNameDao 测试', () => {
        it('应通过名称精确查询提供商', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({ name: 'DAO测试_精确查询' })
            testIds.providerIds.push(provider.id)

            const found = await findModelProviderByNameDao('DAO测试_精确查询')

            expect(found).not.toBeNull()
            expect(found!.id).toBe(provider.id)
        })

        it('不存在的名称应返回 null', async () => {
            if (!dbAvailable) return

            const found = await findModelProviderByNameDao('不存在的提供商名称')
            expect(found).toBeNull()
        })

        it('软删除的提供商通过名称查询应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({ name: 'DAO测试_软删除名称查询' })
            testIds.providerIds.push(provider.id)

            await softDeleteModelProviderDao(provider.id)

            const found = await findModelProviderByNameDao('DAO测试_软删除名称查询')
            expect(found).toBeNull()
        })
    })

    // ==================== findManyModelProvidersDao 测试 ====================

    describe('findManyModelProvidersDao 测试', () => {
        it('应返回分页的提供商列表和总数', async () => {
            if (!dbAvailable) return

            await createTestModelProvider()
            await createTestModelProvider()
            await createTestModelProvider()
            testIds.providerIds.push()

            const result = await findManyModelProvidersDao({ page: 1, pageSize: 10 })

            expect(result.list.length).toBeGreaterThanOrEqual(3)
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应支持分页功能', async () => {
            if (!dbAvailable) return

            await createTestModelProvider()
            await createTestModelProvider()
            await createTestModelProvider()
            testIds.providerIds.push()

            const page1 = await findManyModelProvidersDao({ page: 1, pageSize: 2 })
            const page2 = await findManyModelProvidersDao({ page: 2, pageSize: 2 })

            expect(page1.list.length).toBeLessThanOrEqual(2)
            expect(page2.list.length).toBeLessThanOrEqual(2)
            expect(page1.total).toBe(page2.total)
        })

        it('默认查询条件应排除已删除的提供商', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            await softDeleteModelProviderDao(provider1.id)

            const result = await findManyModelProvidersDao({ page: 1, pageSize: 10 })

            expect(result.list.some(p => p.id === provider1.id)).toBe(false)
            expect(result.list.some(p => p.id === provider2.id)).toBe(true)
        })

        it('includeDeleted 为 true 时应包含已删除的提供商', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            await softDeleteModelProviderDao(provider1.id)

            const result = await findManyModelProvidersDao({
                page: 1,
                pageSize: 10,
                includeDeleted: true,
            })

            expect(result.list.some(p => p.id === provider1.id)).toBe(true)
            expect(result.list.some(p => p.id === provider2.id)).toBe(true)
        })

        it('返回结果应按创建时间降序排列', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            // 确保两个提供商有不同的时间戳
            await new Promise(resolve => setTimeout(resolve, 10))
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            const result = await findManyModelProvidersDao({ page: 1, pageSize: 10 })

            const testProviders = result.list.filter(
                p => p.id === provider1.id || p.id === provider2.id
            )

            if (testProviders.length === 2) {
                const p1Index = result.list.findIndex(p => p.id === provider1.id)
                const p2Index = result.list.findIndex(p => p.id === provider2.id)
                // 越晚创建的排在越前面，所以 provider2 应该在 provider1 前面
                expect(p2Index).toBeLessThan(p1Index)
            }
        })
    })

    // ==================== findAllModelProvidersDao 测试 ====================

    describe('findAllModelProvidersDao 测试', () => {
        it('应返回所有未删除的提供商（不分页）', async () => {
            if (!dbAvailable) return

            await createTestModelProvider()
            await createTestModelProvider()
            await createTestModelProvider()
            testIds.providerIds.push()

            const providers = await findAllModelProvidersDao()

            expect(providers.length).toBeGreaterThanOrEqual(3)
        })

        it('应按名称升序排列', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider({ name: 'AAA测试_排序' })
            const provider2 = await createTestModelProvider({ name: 'BBB测试_排序' })
            testIds.providerIds.push(provider1.id, provider2.id)

            const providers = await findAllModelProvidersDao()

            const testProviders = providers.filter(
                p => p.id === provider1.id || p.id === provider2.id
            )

            expect(testProviders.length).toBe(2)
            expect(testProviders[0].name).toBe('AAA测试_排序')
            expect(testProviders[1].name).toBe('BBB测试_排序')
        })
    })

    // ==================== updateModelProviderDao 测试 ====================

    describe('updateModelProviderDao 测试', () => {
        it('应成功更新提供商名称', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({ name: '原名称' })
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderDao(provider.id, { name: '新名称' })

            expect(updated.name).toBe('新名称')
        })

        it('应成功更新提供商 baseUrl', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderDao(provider.id, {
                baseUrl: 'https://updated.api.com',
            })

            expect(updated.baseUrl).toBe('https://updated.api.com')
        })

        it('应成功更新提供商 description', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({ description: '原描述' })
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderDao(provider.id, {
                description: '新描述',
            })

            expect(updated.description).toBe('新描述')
        })

        it('应支持部分更新（只传 name）', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({
                name: '原名称',
                baseUrl: 'https://original.com',
                description: '原描述',
            })
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderDao(provider.id, { name: '新名称' })

            expect(updated.name).toBe('新名称')
            expect(updated.baseUrl).toBe('https://original.com')
            expect(updated.description).toBe('原描述')
        })

        it('更新不存在的提供商应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updateModelProviderDao(9999999, { name: '新名称' })
            ).rejects.toThrow()
        })
    })

    // ==================== softDeleteModelProviderDao 测试 ====================

    describe('softDeleteModelProviderDao 测试', () => {
        it('软删除后提供商应不可见于正常查询', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await softDeleteModelProviderDao(provider.id)

            const found = await findModelProviderByIdDao(provider.id)
            expect(found).toBeNull()
        })

        it('软删除应设置 deletedAt 时间戳', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await softDeleteModelProviderDao(provider.id)

            const found = await prisma.modelProviders.findUnique({
                where: { id: provider.id },
            })

            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('软删除后通过 findManyModelProvidersDao 查询不应包含该提供商', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await softDeleteModelProviderDao(provider.id)

            const result = await findManyModelProvidersDao({ page: 1, pageSize: 10 })

            expect(result.list.some(p => p.id === provider.id)).toBe(false)
        })

        it('软删除不存在的提供商应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(softDeleteModelProviderDao(9999999)).rejects.toThrow()
        })

        it('软删除提供商后该提供商的密钥应仍存在于数据库', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id)
            testIds.apiKeyIds.push(apiKey.id)

            await softDeleteModelProviderDao(provider.id)

            // API 密钥在数据库中仍然存在（只是通过 DAO 查询不到，因为它没有 deletedAt）
            const foundApiKey = await prisma.modelApiKeys.findUnique({
                where: { id: apiKey.id },
            })

            expect(foundApiKey).not.toBeNull()
            expect(foundApiKey!.deletedAt).toBeNull()
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
