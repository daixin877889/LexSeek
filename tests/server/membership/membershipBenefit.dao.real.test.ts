/**
 * 会员权益关联 DAO 真实数据库覆盖测试
 *
 * 覆盖 membershipBenefit.dao.ts 中全部 CRUD 路径：
 * - createMembershipBenefitDao / findBenefitsByLevelIdDao
 * - deleteMembershipBenefitDao / batchCreateMembershipBenefitsDao
 * - deleteAllMembershipBenefitsByLevelIdDao
 * - 全部 catch 分支（Proxy 故障注入）
 *
 * **Feature: server-test-coverage**
 * **Validates: membershipBenefit.dao.ts 完整覆盖**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestMembershipLevel,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from './test-db-helper'
import {
    createMembershipBenefitDao,
    findBenefitsByLevelIdDao,
    deleteMembershipBenefitDao,
    batchCreateMembershipBenefitsDao,
    deleteAllMembershipBenefitsByLevelIdDao,
} from '../../../server/services/membership/membershipBenefit.dao'

/** 故障注入：使 globalThis.prisma 访问任何属性时抛错 */
const withFaultyPrisma = async (fn: () => Promise<void>) => {
    const original = (globalThis as any).prisma
    ; (globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('injected-fault')
        },
    })
    try {
        await fn()
    } finally {
        ; (globalThis as any).prisma = original
    }
}

/** 生成唯一权益 code */
const uniqueCode = (prefix = 'mb_ben'): string => {
    const rand = Math.random().toString(36).slice(2, 8)
    return `${prefix}_${Date.now()}_${rand}`
}

describe('会员权益关联 DAO 真实数据库测试', () => {
    let dbAvailable = false
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    /** 当前测试用例创建的权益 ID */
    const createdBenefitIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
    })

    afterEach(async () => {
        if (!dbAvailable) return
        // membershipBenefits 依赖 level + benefit，先按 level 清理所有关联（含软删除的）
        if (testIds.membershipLevelIds.length > 0) {
            await prisma.membershipBenefits.deleteMany({
                where: { levelId: { in: testIds.membershipLevelIds } },
            })
        }
        if (createdBenefitIds.length > 0) {
            await prisma.membershipBenefits.deleteMany({
                where: { benefitId: { in: createdBenefitIds } },
            })
            await prisma.benefits.deleteMany({
                where: { id: { in: createdBenefitIds } },
            })
            createdBenefitIds.length = 0
        }
        await cleanupTestData(testIds)
        testIds.userIds = []
        testIds.membershipLevelIds = []
        testIds.userMembershipIds = []
        testIds.pointRecordIds = []
        testIds.redemptionCodeIds = []
        testIds.redemptionRecordIds = []
        testIds.campaignIds = []
        testIds.membershipUpgradeRecordIds = []
        testIds.orderIds = []
        testIds.productIds = []
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    /** 创建一个真实权益，返回 id */
    const createBenefit = async (status: number = 1): Promise<number> => {
        const b = await prisma.benefits.create({
            data: {
                code: uniqueCode(),
                name: '测试权益',
                description: '用于 membershipBenefit.dao 测试',
                unitType: 'count',
                consumptionMode: 'sum',
                status,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        createdBenefitIds.push(b.id)
        return b.id
    }

    describe('createMembershipBenefitDao', () => {
        it('应成功创建权益关联并正确写入 benefitValue', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const benefitId = await createBenefit()

            const mb = await createMembershipBenefitDao(level.id, benefitId, 2048)
            expect(mb.id).toBeGreaterThan(0)
            expect(mb.levelId).toBe(level.id)
            expect(mb.benefitId).toBe(benefitId)
            expect(mb.benefitValue).toBe(BigInt(2048))
            expect(mb.createdAt).toBeInstanceOf(Date)
            expect(mb.updatedAt).toBeInstanceOf(Date)
        })

        it('catch 分支 - prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(createMembershipBenefitDao(1, 1, 100)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('findBenefitsByLevelIdDao', () => {
        it('应返回启用且未软删除的权益列表（含 benefit 关联数据）', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const enabledBenefitId = await createBenefit(1)
            const disabledBenefitId = await createBenefit(0)

            await createMembershipBenefitDao(level.id, enabledBenefitId, 1000)
            await createMembershipBenefitDao(level.id, disabledBenefitId, 500)

            const list = await findBenefitsByLevelIdDao(level.id)
            const ids = list.map(x => x.benefitId)
            expect(ids).toContain(enabledBenefitId)
            expect(ids).not.toContain(disabledBenefitId) // 权益 status=0 应被过滤

            for (const mb of list) {
                expect(mb.benefit).toBeDefined()
                expect(mb.benefit.status).toBe(1)
            }
        })

        it('没有任何关联的级别应返回空数组', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const list = await findBenefitsByLevelIdDao(level.id)
            expect(list).toEqual([])
        })

        it('catch 分支 - prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(findBenefitsByLevelIdDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('deleteMembershipBenefitDao', () => {
        it('应软删除匹配 levelId/benefitId 的关联', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            const benefitId = await createBenefit()

            const mb = await createMembershipBenefitDao(level.id, benefitId, 300)
            await deleteMembershipBenefitDao(level.id, benefitId)

            const raw = await prisma.membershipBenefits.findUnique({ where: { id: mb.id } })
            expect(raw).not.toBeNull()
            expect(raw!.deletedAt).not.toBeNull()

            // findBenefitsByLevelIdDao 不应再返回
            const list = await findBenefitsByLevelIdDao(level.id)
            expect(list.some(x => x.benefitId === benefitId)).toBe(false)
        })

        it('对不存在的关联不会抛错（updateMany 返回 count=0）', async () => {
            if (!dbAvailable) return
            await expect(deleteMembershipBenefitDao(-99999, -99999)).resolves.toBeUndefined()
        })

        it('catch 分支 - prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(deleteMembershipBenefitDao(1, 1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('batchCreateMembershipBenefitsDao', () => {
        it('应批量创建多个会员权益关联', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const b1 = await createBenefit()
            const b2 = await createBenefit()

            await batchCreateMembershipBenefitsDao(level.id, [b1, b2], [100, 200])

            const list = await findBenefitsByLevelIdDao(level.id)
            const values = new Map(list.map(x => [x.benefitId, x.benefitValue]))
            expect(values.get(b1)).toBe(BigInt(100))
            expect(values.get(b2)).toBe(BigInt(200))
        })

        it('benefitValues 缺失时应使用默认值 0', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const b1 = await createBenefit()
            // 传入空数组作为值列表，所有条目应落入 ?? 0
            await batchCreateMembershipBenefitsDao(level.id, [b1], [])

            const list = await findBenefitsByLevelIdDao(level.id)
            expect(list.length).toBe(1)
            expect(list[0].benefitValue).toBe(BigInt(0))
        })

        it('catch 分支 - prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    batchCreateMembershipBenefitsDao(1, [1], [100])
                ).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('deleteAllMembershipBenefitsByLevelIdDao', () => {
        it('应软删除该级别的所有关联', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const b1 = await createBenefit()
            const b2 = await createBenefit()
            await createMembershipBenefitDao(level.id, b1, 100)
            await createMembershipBenefitDao(level.id, b2, 200)

            await deleteAllMembershipBenefitsByLevelIdDao(level.id)

            // 物理仍存在但 deletedAt 非空
            const raws = await prisma.membershipBenefits.findMany({
                where: { levelId: level.id },
            })
            expect(raws.length).toBe(2)
            for (const r of raws) expect(r.deletedAt).not.toBeNull()

            const list = await findBenefitsByLevelIdDao(level.id)
            expect(list).toEqual([])
        })

        it('对无关联级别执行也不应抛错', async () => {
            if (!dbAvailable) return
            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)
            await expect(deleteAllMembershipBenefitsByLevelIdDao(level.id)).resolves.toBeUndefined()
        })

        it('catch 分支 - prisma 抛错应透传', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    deleteAllMembershipBenefitsByLevelIdDao(1)
                ).rejects.toThrow('injected-fault')
            })
        })
    })
})

describe('membershipBenefit.dao 环境自检', () => {
    it('测试数据库应可用', async () => {
        const available = await isTestDbAvailable()
        expect(available).toBe(true)
    })
})
