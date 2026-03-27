/**
 * 示范案例服务层测试
 *
 * **Feature: case-demo**
 * **Validates: demoCase.service.ts 核心函数**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'

// 加载环境变量
config()

// 创建独立的测试 Prisma 客户端
let _testPrisma: InstanceType<typeof PrismaClient> | null = null

const getTestPrisma = () => {
    if (!_testPrisma) {
        const connectionString = process.env.DATABASE_URL
        if (!connectionString) {
            throw new Error('DATABASE_URL 环境变量未设置')
        }
        const pool = new PrismaPg({ connectionString })
        _testPrisma = new PrismaClient({ adapter: pool })
    }
    return _testPrisma
}

// 导入被测试的 Service 函数
import {
    createDemoCaseService,
    getDemoCaseByIdService,
    getDemoCasesService,
    getEnabledDemoCasesService,
    updateDemoCaseService,
    updateDemoCaseStatusService,
    deleteDemoCaseService,
} from '../../../server/services/case/demoCase.service'

// 测试数据追踪
interface TestIds {
    userIds: number[]
    caseTypeIds: number[]
    demoCaseIds: number[]
}

const createEmptyTestIds = (): TestIds => ({
    userIds: [],
    caseTypeIds: [],
    demoCaseIds: [],
})

const cleanupTestData = async (testIds: TestIds) => {
    try {
        const prisma = getTestPrisma()
        if (testIds.demoCaseIds.length > 0) {
            await prisma.demoCases.deleteMany({ where: { id: { in: testIds.demoCaseIds } } })
        }
        if (testIds.caseTypeIds.length > 0) {
            await prisma.caseTypes.deleteMany({ where: { id: { in: testIds.caseTypeIds } } })
        }
        if (testIds.userIds.length > 0) {
            await prisma.users.deleteMany({ where: { id: { in: testIds.userIds } } })
        }
    } catch (error) {
        console.warn('清理测试数据时出错：', error)
    }
}

describe('示范案例服务层', () => {
    let testIds: TestIds

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        const prisma = getTestPrisma()
        await prisma.$connect()
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
        testIds.demoCaseIds = []
        testIds.caseTypeIds = []
        testIds.userIds = []
    })

    afterAll(async () => {
        if (_testPrisma) {
            await _testPrisma.$disconnect()
            _testPrisma = null
        }
    })

    // ==================== 辅助函数：创建测试数据 ====================

    const createTestCaseType = async (name?: string) => {
        const prisma = getTestPrisma()
        const ct = await prisma.caseTypes.create({
            data: {
                name: name || `测试类型_${Date.now()}`,
                description: '测试描述',
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.caseTypeIds.push(ct.id)
        return ct
    }

    // ==================== createDemoCaseService ====================

    describe('createDemoCaseService - 创建示范案例', () => {
        it('应成功创建示范案例', async () => {
            const ct = await createTestCaseType()
            const now = Date.now()

            const demoCase = await createDemoCaseService({
                title: `测试Service创建_${now}`,
                description: '测试描述',
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(demoCase.id)

            expect(demoCase).toBeDefined()
            expect(demoCase.id).toBeGreaterThan(0)
            expect(demoCase.title).toBe(`测试Service创建_${now}`)
        })

        it('重复标题应抛出错误', async () => {
            const ct = await createTestCaseType()
            const uniqueTitle = `测试重复标题_${Date.now()}`

            const dc1 = await createDemoCaseService({
                title: uniqueTitle,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc1.id)

            await expect(
                createDemoCaseService({ title: uniqueTitle, caseTypeId: ct.id })
            ).rejects.toThrow('示范案例标题已存在')
        })
    })

    // ==================== getDemoCaseByIdService ====================

    describe('getDemoCaseByIdService - 获取详情', () => {
        it('应返回存在的案例', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试获取详情_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const found = await getDemoCaseByIdService(dc.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(dc.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await getDemoCaseByIdService(999999)
            expect(found).toBeNull()
        })
    })

    // ==================== getDemoCasesService ====================

    describe('getDemoCasesService - 分页列表', () => {
        it('应返回分页结果', async () => {
            const ct = await createTestCaseType()
            for (let i = 0; i < 3; i++) {
                const dc = await createDemoCaseService({
                    title: `测试列表_${Date.now()}_${i}`,
                    caseTypeId: ct.id,
                })
                testIds.demoCaseIds.push(dc.id)
            }

            const result = await getDemoCasesService({ page: 1, pageSize: 10 })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应支持关键词搜索', async () => {
            const ct = await createTestCaseType()
            const keyword = `唯一关键词_${Date.now()}`
            const dc = await createDemoCaseService({
                title: `测试搜索_${keyword}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const result = await getDemoCasesService({ keyword })

            expect(result.list.some(dc => dc.title.includes(keyword))).toBe(true)
        })

        it('应支持按案件类型筛选', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试CT筛选_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const result = await getDemoCasesService({ caseTypeId: ct.id })

            expect(result.list.every(dc => dc.caseTypeId === ct.id)).toBe(true)
        })
    })

    // ==================== getEnabledDemoCasesService ====================

    describe('getEnabledDemoCasesService - 启用列表', () => {
        it('应只返回启用的案例', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试启用列表_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const result = await getEnabledDemoCasesService()

            expect(result.every(dc => dc.status === 1)).toBe(true)
        })

        it('应支持按案件类型筛选', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试启用CT筛选_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const result = await getEnabledDemoCasesService(ct.id)

            expect(result.every(dc => dc.caseTypeId === ct.id)).toBe(true)
        })
    })

    // ==================== updateDemoCaseService ====================

    describe('updateDemoCaseService - 更新示范案例', () => {
        it('应成功更新', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试更新前_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const newTitle = `测试更新后_${Date.now()}`
            const updated = await updateDemoCaseService(dc.id, { title: newTitle })

            expect(updated.title).toBe(newTitle)
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(
                updateDemoCaseService(999999, { title: '新标题' })
            ).rejects.toThrow('示范案例不存在')
        })

        it('更新为已存在的标题应抛出错误', async () => {
            const ct = await createTestCaseType()
            const dc1 = await createDemoCaseService({
                title: `测试标题1_${Date.now()}`,
                caseTypeId: ct.id,
            })
            const dc2 = await createDemoCaseService({
                title: `测试标题2_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            await expect(
                updateDemoCaseService(dc2.id, { title: dc1.title })
            ).rejects.toThrow('示范案例标题已存在')
        })

        it('更新为自身标题应不报错', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试自身标题_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const updated = await updateDemoCaseService(dc.id, { title: dc.title })

            expect(updated.title).toBe(dc.title)
        })

        it('应更新 materials', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试更新Materials_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const materials = [
                { name: '新材料', type: 1 as const },
            ]
            const updated = await updateDemoCaseService(dc.id, { materials })

            expect(updated.materials).toEqual(materials)
        })

        it('应更新 priority', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试更新Priority_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const updated = await updateDemoCaseService(dc.id, { priority: 99 })

            expect(updated.priority).toBe(99)
        })
    })

    // ==================== updateDemoCaseStatusService ====================

    describe('updateDemoCaseStatusService - 更新状态', () => {
        it('应成功更新状态', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试更新状态_${Date.now()}`,
                caseTypeId: ct.id,
                status: 1,
            })
            testIds.demoCaseIds.push(dc.id)

            const updated = await updateDemoCaseStatusService(dc.id, 0)

            expect(updated.status).toBe(0)
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(updateDemoCaseStatusService(999999, 0)).rejects.toThrow('示范案例不存在')
        })
    })

    // ==================== deleteDemoCaseService ====================

    describe('deleteDemoCaseService - 删除案例', () => {
        it('应成功软删除', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseService({
                title: `测试删除_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            await deleteDemoCaseService(dc.id)

            const found = await getDemoCaseByIdService(dc.id)
            expect(found).toBeNull()
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(deleteDemoCaseService(999999)).rejects.toThrow('示范案例不存在')
        })
    })
})
