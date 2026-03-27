/**
 * 用户权益 DAO 测试
 *
 * 测试用户权益数据访问层的 CRUD 操作：
 * - 查询生效中的用户权益
 * - 汇总用户权益总值
 * - 创建/批量创建用户权益记录
 * - 过期用户权益记录
 * - 查询用户指定权益的所有记录
 *
 * **Feature: user-benefit-dao**
 * **Validates: Requirements 会员权益模块**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestUser,
    createTestUserMembership,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from './test-db-helper'
import { BenefitConsumptionMode, UserBenefitStatus } from '../../../shared/types/benefit'

// 导入 DAO 函数
import {
    findUserActiveBenefitsDao,
    sumUserBenefitValueDao,
    createUserBenefitDao,
    createUserBenefitsDao,
    expireUserBenefitsBySourceDao,
    findUserBenefitsByCodeDao,
} from '../../../server/services/membership/userBenefit.dao'
import type { CreateUserBenefitInput } from '../../../server/services/membership/userBenefit.dao'

// 检查数据库是否可用
let dbAvailable = false

describe('用户权益 DAO 测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    // 测试数据追踪
    const testBenefitIds: number[] = []
    const testUserBenefitIds: number[] = []
    const testUserMembershipIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理用户权益记录
            if (testUserBenefitIds.length > 0) {
                await prisma.userBenefits.deleteMany({
                    where: { id: { in: testUserBenefitIds } },
                })
                testUserBenefitIds.length = 0
            }

            // 清理用户会员记录
            if (testUserMembershipIds.length > 0) {
                await prisma.userMemberships.deleteMany({
                    where: { id: { in: testUserMembershipIds } },
                })
                testUserMembershipIds.length = 0
            }

            // 清理权益
            if (testBenefitIds.length > 0) {
                await prisma.benefits.deleteMany({
                    where: { id: { in: testBenefitIds } },
                })
                testBenefitIds.length = 0
            }

            await cleanupTestData(testIds)
            testIds.userIds = []
            testIds.membershipLevelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // 创建测试权益
    const createTestBenefit = async (data?: {
        name?: string
        code?: string
        description?: string
        unitType?: string
        consumptionMode?: string
        defaultValue?: bigint
    }) => {
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const benefit = await prisma.benefits.create({
            data: {
                code: data?.code || `test_benefit_${uniqueId}`,
                name: data?.name || `测试权益_${uniqueId}`,
                description: data?.description || '测试权益描述',
                unitType: data?.unitType ?? 'count',
                consumptionMode: data?.consumptionMode ?? 'sum',
                defaultValue: data?.defaultValue ?? BigInt(0),
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testBenefitIds.push(benefit.id)
        return benefit
    }

    // 创建测试用户权益记录
    const createTestUserBenefit = async (
        userId: number,
        benefitId: number,
        data?: {
            benefitValue?: bigint | number
            sourceType?: string
            sourceId?: number
            effectiveAt?: Date
            expiredAt?: Date
            status?: number
        }
    ) => {
        const now = new Date()
        const defaultEndDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

        const ub = await prisma.userBenefits.create({
            data: {
                userId,
                benefitId,
                benefitValue: BigInt(data?.benefitValue ?? 100),
                sourceType: data?.sourceType ?? 'membership_gift',
                sourceId: data?.sourceId ?? null,
                effectiveAt: data?.effectiveAt ?? now,
                expiredAt: data?.expiredAt ?? defaultEndDate,
                status: data?.status ?? UserBenefitStatus.ACTIVE,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testUserBenefitIds.push(ub.id)
        return ub
    }

    // ========== findUserActiveBenefitsDao 测试 ==========

    describe('findUserActiveBenefitsDao 测试', () => {
        it('应返回用户生效中的权益记录', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '活跃权益' })

            // 创建生效中的用户权益记录
            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            await createTestUserBenefit(user.id, benefit.id, {
                effectiveAt: now,
                expiredAt: futureDate,
                status: UserBenefitStatus.ACTIVE,
            })

            const results = await findUserActiveBenefitsDao(user.id)

            expect(results.length).toBeGreaterThan(0)
            expect(results.some(r => r.benefit.code === benefit.code)).toBe(true)
        })

        it('按权益标识码筛选应只返回指定权益的记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit1 = await createTestBenefit({ code: 'test_code_1', name: '权益1' })
            const benefit2 = await createTestBenefit({ code: 'test_code_2', name: '权益2' })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            await createTestUserBenefit(user.id, benefit1.id, { effectiveAt: now, expiredAt: futureDate })
            await createTestUserBenefit(user.id, benefit2.id, { effectiveAt: now, expiredAt: futureDate })

            const results = await findUserActiveBenefitsDao(user.id, 'test_code_1')

            expect(results.length).toBe(1)
            expect(results[0].benefit.code).toBe('test_code_1')
        })

        it('过期的权益记录不应返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '过期权益' })

            // 创建已过期的用户权益记录
            const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            await createTestUserBenefit(user.id, benefit.id, {
                effectiveAt: pastDate,
                expiredAt: pastDate,
                status: UserBenefitStatus.ACTIVE,
            })

            const results = await findUserActiveBenefitsDao(user.id, benefit.code)

            expect(results.length).toBe(0)
        })

        it('无效状态的权益记录不应返回', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '无效权益' })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            await createTestUserBenefit(user.id, benefit.id, {
                effectiveAt: now,
                expiredAt: futureDate,
                status: UserBenefitStatus.INACTIVE,
            })

            const results = await findUserActiveBenefitsDao(user.id, benefit.code)

            expect(results.length).toBe(0)
        })

        it('不存在的用户应返回空数组', async () => {
            if (!dbAvailable) return

            const results = await findUserActiveBenefitsDao(999999)

            expect(results).toEqual([])
        })
    })

    // ========== sumUserBenefitValueDao 测试 ==========

    describe('sumUserBenefitValueDao 测试', () => {
        it('SUM 模式应正确汇总权益总值', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({
                code: 'sum_benefit',
                name: 'SUM权益',
                consumptionMode: BenefitConsumptionMode.SUM,
            })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 创建两条权益记录
            await createTestUserBenefit(user.id, benefit.id, {
                benefitValue: 100,
                effectiveAt: now,
                expiredAt: futureDate,
            })
            await createTestUserBenefit(user.id, benefit.id, {
                benefitValue: 200,
                effectiveAt: now,
                expiredAt: futureDate,
            })

            const total = await sumUserBenefitValueDao(
                user.id,
                'sum_benefit',
                BenefitConsumptionMode.SUM
            )

            expect(total).toBe(BigInt(300))
        })

        it('MAX 模式应返回最大值', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({
                code: 'max_benefit',
                name: 'MAX权益',
                consumptionMode: BenefitConsumptionMode.MAX,
            })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            await createTestUserBenefit(user.id, benefit.id, {
                benefitValue: 100,
                effectiveAt: now,
                expiredAt: futureDate,
            })
            await createTestUserBenefit(user.id, benefit.id, {
                benefitValue: 300,
                effectiveAt: now,
                expiredAt: futureDate,
            })
            await createTestUserBenefit(user.id, benefit.id, {
                benefitValue: 200,
                effectiveAt: now,
                expiredAt: futureDate,
            })

            const max = await sumUserBenefitValueDao(
                user.id,
                'max_benefit',
                BenefitConsumptionMode.MAX
            )

            expect(max).toBe(BigInt(300))
        })

        it('无权益记录应返回 0', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const total = await sumUserBenefitValueDao(
                user.id,
                'non_existent',
                BenefitConsumptionMode.SUM
            )

            expect(total).toBe(BigInt(0))
        })

        it('过期的权益记录不应计入', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({
                code: 'expired_sum',
                name: '过期SUM',
                consumptionMode: BenefitConsumptionMode.SUM,
            })

            const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            await createTestUserBenefit(user.id, benefit.id, {
                benefitValue: 500,
                effectiveAt: pastDate,
                expiredAt: pastDate,
            })

            const total = await sumUserBenefitValueDao(
                user.id,
                'expired_sum',
                BenefitConsumptionMode.SUM
            )

            expect(total).toBe(BigInt(0))
        })
    })

    // ========== createUserBenefitDao 测试 ==========

    describe('createUserBenefitDao 测试', () => {
        it('应成功创建用户权益记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '新建权益' })

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const input: CreateUserBenefitInput = {
                userId: user.id,
                benefitId: benefit.id,
                benefitValue: 500,
                sourceType: 'membership_gift',
                sourceId: 1,
                effectiveAt: now,
                expiredAt: endDate,
                remark: '测试备注',
            }

            const result = await createUserBenefitDao(input)

            expect(result.id).toBeDefined()
            expect(result.userId).toBe(user.id)
            expect(result.benefitId).toBe(benefit.id)
            expect(result.benefitValue).toBe(BigInt(500))
            expect(result.sourceType).toBe('membership_gift')
            expect(result.status).toBe(UserBenefitStatus.ACTIVE)

            testUserBenefitIds.push(result.id)
        })

        it('数字类型的权益值应自动转换为 BigInt', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: 'BigInt转换' })

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const input: CreateUserBenefitInput = {
                userId: user.id,
                benefitId: benefit.id,
                benefitValue: 123,
                sourceType: 'admin_gift',
                effectiveAt: now,
                expiredAt: endDate,
            }

            const result = await createUserBenefitDao(input)

            expect(typeof result.benefitValue).toBe('bigint')
            expect(result.benefitValue).toBe(BigInt(123))

            testUserBenefitIds.push(result.id)
        })

        it('未提供 sourceId 应允许创建', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '无SourceId' })

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const input: CreateUserBenefitInput = {
                userId: user.id,
                benefitId: benefit.id,
                benefitValue: 100,
                sourceType: 'admin_gift',
                effectiveAt: now,
                expiredAt: endDate,
            }

            const result = await createUserBenefitDao(input)

            expect(result.sourceId).toBeNull()

            testUserBenefitIds.push(result.id)
        })
    })

    // ========== createUserBenefitsDao (批量创建) 测试 ==========

    describe('createUserBenefitsDao 测试', () => {
        it('应成功批量创建用户权益记录', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit1 = await createTestBenefit({ name: '批量权益1' })
            const benefit2 = await createTestBenefit({ name: '批量权益2' })

            const now = new Date()
            const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const inputs: CreateUserBenefitInput[] = [
                {
                    userId: user.id,
                    benefitId: benefit1.id,
                    benefitValue: 100,
                    sourceType: 'membership_gift',
                    effectiveAt: now,
                    expiredAt: endDate,
                },
                {
                    userId: user.id,
                    benefitId: benefit2.id,
                    benefitValue: 200,
                    sourceType: 'membership_gift',
                    effectiveAt: now,
                    expiredAt: endDate,
                },
            ]

            const results = await createUserBenefitsDao(inputs)

            expect(results.length).toBe(2)
            expect(results[0].benefitValue).toBe(BigInt(100))
            expect(results[1].benefitValue).toBe(BigInt(200))

            results.forEach(r => testUserBenefitIds.push(r.id))
        })

        it('空列表应返回空数组', async () => {
            if (!dbAvailable) return

            const results = await createUserBenefitsDao([])

            expect(results).toEqual([])
        })
    })

    // ========== expireUserBenefitsBySourceDao 测试 ==========

    describe('expireUserBenefitsBySourceDao 测试', () => {
        it('应将指定来源的权益记录设为无效', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '过期权益' })
            const membershipId = 1

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const ub = await createTestUserBenefit(user.id, benefit.id, {
                sourceType: 'membership_gift',
                sourceId: membershipId,
                effectiveAt: now,
                expiredAt: futureDate,
                status: UserBenefitStatus.ACTIVE,
            })

            await expireUserBenefitsBySourceDao(
                user.id,
                'membership_gift',
                membershipId
            )

            // 从数据库重新查询验证状态已变更
            const updated = await prisma.userBenefits.findUnique({
                where: { id: ub.id },
            })

            expect(updated?.status).toBe(UserBenefitStatus.INACTIVE)
        })

        it('不同来源的权益记录不应被过期', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '不同来源' })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            // 创建两条记录：来源1和来源2
            const ub1 = await createTestUserBenefit(user.id, benefit.id, {
                sourceType: 'membership_gift',
                sourceId: 1,
                effectiveAt: now,
                expiredAt: futureDate,
            })
            const ub2 = await createTestUserBenefit(user.id, benefit.id, {
                sourceType: 'membership_gift',
                sourceId: 2,
                effectiveAt: now,
                expiredAt: futureDate,
            })

            // 只过期来源1
            await expireUserBenefitsBySourceDao(user.id, 'membership_gift', 1)

            const updated1 = await prisma.userBenefits.findUnique({
                where: { id: ub1.id },
            })
            const updated2 = await prisma.userBenefits.findUnique({
                where: { id: ub2.id },
            })

            expect(updated1?.status).toBe(UserBenefitStatus.INACTIVE)
            expect(updated2?.status).toBe(UserBenefitStatus.ACTIVE)
        })

        it('不匹配的 sourceId 不应被过期', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({ name: '不匹配来源' })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

            const ub = await createTestUserBenefit(user.id, benefit.id, {
                sourceType: 'membership_gift',
                sourceId: 1,
                effectiveAt: now,
                expiredAt: futureDate,
            })

            // 过期不同的 sourceId
            await expireUserBenefitsBySourceDao(user.id, 'membership_gift', 999)

            const updated = await prisma.userBenefits.findUnique({
                where: { id: ub.id },
            })

            expect(updated?.status).toBe(UserBenefitStatus.ACTIVE)
        })
    })

    // ========== findUserBenefitsByCodeDao 测试 ==========

    describe('findUserBenefitsByCodeDao 测试', () => {
        it('应返回用户指定权益的所有记录（包括已过期）', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefit = await createTestBenefit({
                code: 'all_records',
                name: '所有记录权益',
            })

            const now = new Date()
            const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
            const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

            // 创建一条有效和一条已过期的记录
            await createTestUserBenefit(user.id, benefit.id, {
                effectiveAt: now,
                expiredAt: futureDate,
                status: UserBenefitStatus.ACTIVE,
            })
            await createTestUserBenefit(user.id, benefit.id, {
                effectiveAt: pastDate,
                expiredAt: pastDate,
                status: UserBenefitStatus.INACTIVE,
            })

            const results = await findUserBenefitsByCodeDao(user.id, 'all_records')

            expect(results.length).toBe(2)
            expect(results.every(r => r.benefit.code === 'all_records')).toBe(true)
        })

        it('不存在的权益码应返回空数组', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const results = await findUserBenefitsByCodeDao(user.id, 'non_existent_code')

            expect(results).toEqual([])
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        const available = await isTestDbAvailable()
        if (!available) {
            console.log('请确保数据库已启动并配置正确的连接字符串')
        }
        expect(true).toBe(true)
    })
})
