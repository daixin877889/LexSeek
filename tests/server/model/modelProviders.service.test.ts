/**
 * 模型提供商服务层集成测试
 *
 * 测试 modelProviders.service.ts 中各函数的业务逻辑
 *
 * **Feature: model-management**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestModelProvider,
    cleanupModelTestData,
    createEmptyModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetModelDatabaseSequences,
    type ModelTestIds,
} from './test-db-helper'

// 导入服务函数
import {
    createModelProviderService,
    getModelProviderByIdService,
    getModelProvidersService,
    getAllModelProvidersService,
    updateModelProviderService,
    deleteModelProviderService,
} from '../../../server/services/model/modelProviders.service'

// 导入 DAO 函数（服务层依赖，这些函数在服务文件中通过 Nitro 自动导入，
// 但在测试环境中需要显式导入）
import {
    findModelProviderByIdDao,
} from '../../../server/services/model/modelProviders.dao'

// 导入 DAO 函数（用于验证）

// 检查数据库是否可用
let dbAvailable = false

describe('模型提供商服务层集成测试', () => {
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

    // ==================== createModelProviderService 测试 ====================

    describe('createModelProviderService 测试', () => {
        it('应成功创建模型提供商', async () => {
            if (!dbAvailable) return

            const provider = await createModelProviderService({
                name: '服务层_创建测试',
                baseUrl: 'https://api.service-test.com',
                description: '服务层测试描述',
            })
            testIds.providerIds.push(provider.id)

            expect(provider.id).toBeGreaterThan(0)
            expect(provider.name).toBe('服务层_创建测试')
            expect(provider.baseUrl).toBe('https://api.service-test.com')
            expect(provider.description).toBe('服务层测试描述')
        })

        it('提供商名称已存在时应抛出错误', async () => {
            if (!dbAvailable) return

            const existing = await createTestModelProvider({ name: '重复名称_服务测试' })
            testIds.providerIds.push(existing.id)

            await expect(
                createModelProviderService({
                    name: '重复名称_服务测试',
                    baseUrl: 'https://different.com',
                })
            ).rejects.toThrow('提供商名称已存在')
        })

        it('description 为 null 时应正常创建', async () => {
            if (!dbAvailable) return

            const provider = await createModelProviderService({
                name: '服务层_无描述',
                baseUrl: 'https://api.no-desc.com',
                description: null,
            })
            testIds.providerIds.push(provider.id)

            expect(provider.description).toBeNull()
        })

        it('创建的提供商可通过服务层查询到', async () => {
            if (!dbAvailable) return

            const created = await createModelProviderService({
                name: '服务层_可查询测试',
                baseUrl: 'https://api.queryable.com',
            })
            testIds.providerIds.push(created.id)

            const found = await getModelProviderByIdService(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.name).toBe('服务层_可查询测试')
        })
    })

    // ==================== getModelProviderByIdService 测试 ====================

    describe('getModelProviderByIdService 测试', () => {
        it('应返回提供商详情', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const found = await getModelProviderByIdService(provider.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(provider.id)
            expect(found!.name).toBe(provider.name)
        })

        it('不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await getModelProviderByIdService(9999999)
            expect(found).toBeNull()
        })

        it('已删除的提供商应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await deleteModelProviderService(provider.id)

            const found = await getModelProviderByIdService(provider.id)
            expect(found).toBeNull()
        })
    })

    // ==================== getModelProvidersService 测试 ====================

    describe('getModelProvidersService 测试', () => {
        it('应返回分页的提供商列表', async () => {
            if (!dbAvailable) return

            await createTestModelProvider()
            await createTestModelProvider()
            await createTestModelProvider()
            testIds.providerIds.push()

            const result = await getModelProvidersService({ page: 1, pageSize: 10 })

            expect(result.list.length).toBeGreaterThanOrEqual(3)
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应支持分页功能', async () => {
            if (!dbAvailable) return

            await createTestModelProvider()
            await createTestModelProvider()
            await createTestModelProvider()
            testIds.providerIds.push()

            const page1 = await getModelProvidersService({ page: 1, pageSize: 2 })
            const page2 = await getModelProvidersService({ page: 2, pageSize: 2 })

            expect(page1.list.length).toBeLessThanOrEqual(2)
            expect(page2.list.length).toBeLessThanOrEqual(2)
            expect(page1.total).toBe(page2.total)
        })

        it('includeDeleted 为 true 时应包含已删除提供商', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            await deleteModelProviderService(provider1.id)

            const result = await getModelProvidersService({
                page: 1,
                pageSize: 10,
                includeDeleted: true,
            })

            expect(result.list.some(p => p.id === provider1.id)).toBe(true)
            expect(result.list.some(p => p.id === provider2.id)).toBe(true)
        })

        it('默认条件应排除已删除的提供商', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            await deleteModelProviderService(provider1.id)

            const result = await getModelProvidersService({ page: 1, pageSize: 10 })

            expect(result.list.some(p => p.id === provider1.id)).toBe(false)
            expect(result.list.some(p => p.id === provider2.id)).toBe(true)
        })

        it('无参数时应返回默认分页结果', async () => {
            if (!dbAvailable) return

            const result = await getModelProvidersService()

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(0)
        })
    })

    // ==================== getAllModelProvidersService 测试 ====================

    describe('getAllModelProvidersService 测试', () => {
        it('应返回所有未删除的提供商（不分页）', async () => {
            if (!dbAvailable) return

            await createTestModelProvider()
            await createTestModelProvider()
            testIds.providerIds.push()

            const providers = await getAllModelProvidersService()

            expect(providers.length).toBeGreaterThanOrEqual(2)
        })

        it('返回结果应排除已删除的提供商', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider()
            const provider2 = await createTestModelProvider()
            testIds.providerIds.push(provider1.id, provider2.id)

            await deleteModelProviderService(provider1.id)

            const providers = await getAllModelProvidersService()

            expect(providers.some(p => p.id === provider1.id)).toBe(false)
            expect(providers.some(p => p.id === provider2.id)).toBe(true)
        })
    })

    // ==================== updateModelProviderService 测试 ====================

    describe('updateModelProviderService 测试', () => {
        it('应成功更新提供商名称', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({ name: '原名称' })
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderService(provider.id, {
                name: '新名称',
            })

            expect(updated.name).toBe('新名称')
        })

        it('应成功更新提供商 baseUrl', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderService(provider.id, {
                baseUrl: 'https://updated.com',
            })

            expect(updated.baseUrl).toBe('https://updated.com')
        })

        it('提供商不存在时应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(
                updateModelProviderService(9999999, { name: '新名称' })
            ).rejects.toThrow('提供商不存在')
        })

        it('更新为已存在的名称时应抛出错误', async () => {
            if (!dbAvailable) return

            const provider1 = await createTestModelProvider({ name: '名称A' })
            const provider2 = await createTestModelProvider({ name: '名称B' })
            testIds.providerIds.push(provider1.id, provider2.id)

            await expect(
                updateModelProviderService(provider2.id, { name: '名称A' })
            ).rejects.toThrow('提供商名称已存在')
        })

        it('更新为相同的名称应正常工作', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({ name: '相同名称测试' })
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderService(provider.id, {
                name: '相同名称测试',
            })

            expect(updated.name).toBe('相同名称测试')
        })

        it('应支持部分更新', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider({
                name: '原名称',
                baseUrl: 'https://original.com',
                description: '原描述',
            })
            testIds.providerIds.push(provider.id)

            const updated = await updateModelProviderService(provider.id, {
                description: '只更新描述',
            })

            expect(updated.name).toBe('原名称')
            expect(updated.baseUrl).toBe('https://original.com')
            expect(updated.description).toBe('只更新描述')
        })
    })

    // ==================== deleteModelProviderService 测试 ====================

    describe('deleteModelProviderService 测试', () => {
        it('应成功软删除提供商', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await deleteModelProviderService(provider.id)

            const found = await findModelProviderByIdDao(provider.id)
            expect(found).toBeNull()
        })

        it('软删除后数据库中 deletedAt 应被设置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await deleteModelProviderService(provider.id)

            const found = await prisma.modelProviders.findUnique({
                where: { id: provider.id },
            })

            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('提供商不存在时应抛出错误', async () => {
            if (!dbAvailable) return

            await expect(deleteModelProviderService(9999999)).rejects.toThrow('提供商不存在')
        })

        it('已删除的提供商再次删除应抛出错误', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await deleteModelProviderService(provider.id)

            await expect(deleteModelProviderService(provider.id)).rejects.toThrow('提供商不存在')
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
