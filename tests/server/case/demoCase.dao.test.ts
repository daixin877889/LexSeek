/**
 * 示范案例 DAO 层测试
 *
 * **Feature: case-demo**
 * **Validates: demoCase.dao.ts 核心函数**
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

// 导入被测试的 DAO 函数
import {
    createDemoCaseDao,
    findDemoCaseByIdDao,
    findDemoCaseByTitleDao,
    findManyDemoCasesDao,
    findEnabledDemoCasesDao,
    updateDemoCaseDao,
    softDeleteDemoCaseDao,
    DemoCaseStatus,
} from '../../../server/services/case/demoCase.dao'

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

describe('示范案例 DAO 层', () => {
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

    // ==================== createDemoCaseDao ====================

    describe('createDemoCaseDao - 创建示范案例', () => {
        it('应成功创建示范案例', async () => {
            const ct = await createTestCaseType()
            const now = Date.now()

            const demoCase = await createDemoCaseDao({
                title: `测试示范案例_${now}`,
                description: '测试描述',
                caseTypeId: ct.id,
                status: DemoCaseStatus.ENABLED,
            })
            testIds.demoCaseIds.push(demoCase.id)

            expect(demoCase).toBeDefined()
            expect(demoCase.id).toBeGreaterThan(0)
            expect(demoCase.title).toBe(`测试示范案例_${now}`)
            expect(demoCase.status).toBe(DemoCaseStatus.ENABLED)
        })

        it('应使用默认 priority', async () => {
            const ct = await createTestCaseType()

            const demoCase = await createDemoCaseDao({
                title: `测试优先级_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(demoCase.id)

            expect(demoCase.priority).toBe(100)
        })

        it('应使用默认 status 为 ENABLED', async () => {
            const ct = await createTestCaseType()

            const demoCase = await createDemoCaseDao({
                title: `测试默认状态_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(demoCase.id)

            expect(demoCase.status).toBe(DemoCaseStatus.ENABLED)
        })
    })

    // ==================== findDemoCaseByIdDao ====================

    describe('findDemoCaseByIdDao - 通过 ID 查询', () => {
        it('应返回存在的示范案例', async () => {
            const ct = await createTestCaseType()
            const ts = Date.now()
            const created = await createDemoCaseDao({
                title: `测试查询ID_${ts}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(created.id)

            const found = await findDemoCaseByIdDao(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.title).toBe(`测试查询ID_${ts}`)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await findDemoCaseByIdDao(999999)
            expect(found).toBeNull()
        })

        it('已软删除的记录不应返回', async () => {
            const ct = await createTestCaseType()
            const created = await createDemoCaseDao({
                title: `测试软删除_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(created.id)

            await softDeleteDemoCaseDao(created.id)

            const found = await findDemoCaseByIdDao(created.id)
            expect(found).toBeNull()
        })
    })

    // ==================== findDemoCaseByTitleDao ====================

    describe('findDemoCaseByTitleDao - 通过标题查询', () => {
        it('应返回存在的示范案例', async () => {
            const ct = await createTestCaseType()
            const uniqueTitle = `测试查询标题_${Date.now()}`
            const created = await createDemoCaseDao({
                title: uniqueTitle,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(created.id)

            const found = await findDemoCaseByTitleDao(uniqueTitle)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
        })

        it('不存在的标题应返回 null', async () => {
            const found = await findDemoCaseByTitleDao('不存在的标题')
            expect(found).toBeNull()
        })
    })

    // ==================== findManyDemoCasesDao ====================

    describe('findManyDemoCasesDao - 分页查询', () => {
        it('应返回分页结果', async () => {
            const ct = await createTestCaseType()
            for (let i = 0; i < 3; i++) {
                const dc = await createDemoCaseDao({
                    title: `测试分页_${Date.now()}_${i}`,
                    caseTypeId: ct.id,
                })
                testIds.demoCaseIds.push(dc.id)
            }

            const result = await findManyDemoCasesDao({ page: 1, pageSize: 10 })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应按 caseTypeId 筛选', async () => {
            const ct1 = await createTestCaseType()
            const ct2 = await createTestCaseType()

            const dc1 = await createDemoCaseDao({
                title: `测试类型筛选_1_${Date.now()}`,
                caseTypeId: ct1.id,
            })
            const dc2 = await createDemoCaseDao({
                title: `测试类型筛选_2_${Date.now()}`,
                caseTypeId: ct2.id,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            const result = await findManyDemoCasesDao({ caseTypeId: ct1.id })

            expect(result.list.every(dc => dc.caseTypeId === ct1.id)).toBe(true)
        })

        it('应按 status 筛选', async () => {
            const ct = await createTestCaseType()
            const dc1 = await createDemoCaseDao({
                title: `测试状态筛选_启用_${Date.now()}`,
                caseTypeId: ct.id,
                status: DemoCaseStatus.ENABLED,
            })
            const dc2 = await createDemoCaseDao({
                title: `测试状态筛选_禁用_${Date.now()}`,
                caseTypeId: ct.id,
                status: DemoCaseStatus.DISABLED,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            const result = await findManyDemoCasesDao({ status: DemoCaseStatus.ENABLED })

            expect(result.list.every(dc => dc.status === DemoCaseStatus.ENABLED)).toBe(true)
        })

        it('应按关键词搜索', async () => {
            const ct = await createTestCaseType()
            const keyword = `唯一关键词_${Date.now()}`
            const dc = await createDemoCaseDao({
                title: `测试搜索_${keyword}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const result = await findManyDemoCasesDao({ keyword })

            expect(result.list.some(dc => dc.title.includes(keyword))).toBe(true)
        })

        it('应支持排序', async () => {
            const ct = await createTestCaseType()
            // 使用随机 suffix 确保标题唯一
            const random = Math.random().toString(36).substring(2, 8)

            const dc1 = await createDemoCaseDao({
                title: `测试排序A_${random}`,
                caseTypeId: ct.id,
                priority: 10,
            })
            const dc2 = await createDemoCaseDao({
                title: `测试排序B_${random}`,
                caseTypeId: ct.id,
                priority: 20,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            // 用关键词搜索来定位本轮创建的记录，避免其他测试数据的干扰
            const resultAsc = await findManyDemoCasesDao({ keyword: random, orderBy: 'priority', orderDir: 'asc' })
            const resultDesc = await findManyDemoCasesDao({ keyword: random, orderBy: 'priority', orderDir: 'desc' })

            // 验证升序：priority 10 应该在 priority 20 前面
            const ascIndex1 = resultAsc.list.findIndex(dc => dc.id === dc1.id)
            const ascIndex2 = resultAsc.list.findIndex(dc => dc.id === dc2.id)
            if (ascIndex1 !== -1 && ascIndex2 !== -1) {
                expect(ascIndex1).toBeLessThan(ascIndex2)
            }

            // 验证降序：priority 10 应该在 priority 20 后面
            const descIndex1 = resultDesc.list.findIndex(dc => dc.id === dc1.id)
            const descIndex2 = resultDesc.list.findIndex(dc => dc.id === dc2.id)
            if (descIndex1 !== -1 && descIndex2 !== -1) {
                expect(descIndex1).toBeGreaterThan(descIndex2)
            }
        })
    })

    // ==================== findEnabledDemoCasesDao ====================

    describe('findEnabledDemoCasesDao - 查询启用的案例', () => {
        it('应只返回启用的案例', async () => {
            const ct = await createTestCaseType()
            const dc1 = await createDemoCaseDao({
                title: `测试启用查询_启用_${Date.now()}`,
                caseTypeId: ct.id,
                status: DemoCaseStatus.ENABLED,
            })
            const dc2 = await createDemoCaseDao({
                title: `测试启用查询_禁用_${Date.now()}`,
                caseTypeId: ct.id,
                status: DemoCaseStatus.DISABLED,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            const result = await findEnabledDemoCasesDao()

            expect(result.every(dc => dc.status === DemoCaseStatus.ENABLED)).toBe(true)
        })

        it('应按优先级升序排列', async () => {
            const ct = await createTestCaseType()
            const dc1 = await createDemoCaseDao({
                title: `测试排序_后_${Date.now()}`,
                caseTypeId: ct.id,
                priority: 2,
            })
            const dc2 = await createDemoCaseDao({
                title: `测试排序_先_${Date.now()}`,
                caseTypeId: ct.id,
                priority: 1,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            const result = await findEnabledDemoCasesDao()
            const idx1 = result.findIndex(dc => dc.id === dc1.id)
            const idx2 = result.findIndex(dc => dc.id === dc2.id)

            if (idx1 !== -1 && idx2 !== -1) {
                expect(idx1).toBeGreaterThan(idx2)
            }
        })

        it('应支持按案件类型筛选', async () => {
            const ct1 = await createTestCaseType()
            const ct2 = await createTestCaseType()
            const dc1 = await createDemoCaseDao({
                title: `测试CT筛选_1_${Date.now()}`,
                caseTypeId: ct1.id,
                status: DemoCaseStatus.ENABLED,
            })
            const dc2 = await createDemoCaseDao({
                title: `测试CT筛选_2_${Date.now()}`,
                caseTypeId: ct2.id,
                status: DemoCaseStatus.ENABLED,
            })
            testIds.demoCaseIds.push(dc1.id, dc2.id)

            const result = await findEnabledDemoCasesDao(ct1.id)
            expect(result.every(dc => dc.caseTypeId === ct1.id)).toBe(true)
        })
    })

    // ==================== updateDemoCaseDao ====================

    describe('updateDemoCaseDao - 更新示范案例', () => {
        it('应成功更新字段', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseDao({
                title: `测试更新前_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const newTitle = `测试更新后_${Date.now()}`
            const updated = await updateDemoCaseDao(dc.id, { title: newTitle })

            expect(updated.title).toBe(newTitle)
        })

        it('应更新 priority', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseDao({
                title: `测试更新Priority_${Date.now()}`,
                caseTypeId: ct.id,
                priority: 10,
            })
            testIds.demoCaseIds.push(dc.id)

            const updated = await updateDemoCaseDao(dc.id, { priority: 50 })

            expect(updated.priority).toBe(50)
        })

        it('应更新 status', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseDao({
                title: `测试更新Status_${Date.now()}`,
                caseTypeId: ct.id,
                status: DemoCaseStatus.ENABLED,
            })
            testIds.demoCaseIds.push(dc.id)

            const updated = await updateDemoCaseDao(dc.id, { status: DemoCaseStatus.DISABLED })

            expect(updated.status).toBe(DemoCaseStatus.DISABLED)
        })

        it('应更新 materials', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseDao({
                title: `测试更新Materials_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            const materials = [
                { name: '材料1', type: 1 as const, content: '内容1' },
                { name: '材料2', type: 2 as const, fileUrl: '/path/to/file.pdf' },
            ]
            const updated = await updateDemoCaseDao(dc.id, { materials })

            expect(updated.materials).toEqual(materials)
        })

        it('不存在的 ID 应抛出错误', async () => {
            await expect(updateDemoCaseDao(999999, { title: '新标题' })).rejects.toThrow()
        })
    })

    // ==================== softDeleteDemoCaseDao ====================

    describe('softDeleteDemoCaseDao - 软删除', () => {
        it('应设置 deletedAt', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseDao({
                title: `测试软删除_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            await softDeleteDemoCaseDao(dc.id)

            const found = await getTestPrisma().demoCases.findUnique({ where: { id: dc.id } })
            expect(found).not.toBeNull()
            expect(found!.deletedAt).not.toBeNull()
        })

        it('软删除后 findDemoCaseByIdDao 不应返回', async () => {
            const ct = await createTestCaseType()
            const dc = await createDemoCaseDao({
                title: `测试软删除后查询_${Date.now()}`,
                caseTypeId: ct.id,
            })
            testIds.demoCaseIds.push(dc.id)

            await softDeleteDemoCaseDao(dc.id)

            const found = await findDemoCaseByIdDao(dc.id)
            expect(found).toBeNull()
        })
    })
})
