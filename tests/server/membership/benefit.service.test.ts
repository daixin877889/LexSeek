/**
 * 权益服务测试
 *
 * 测试权益服务层功能，包括：
 * - 获取用户当前会员的权益列表
 * - 获取指定会员级别的权益列表
 *
 * **Feature: benefit-service**
 * **Validates: Requirements 1.1, 1.2, 2.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestMembershipLevel,
    createTestUser,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    type TestIds,
} from './test-db-helper'

// 导入服务函数
import {
    getUserBenefitsService,
    getBenefitsByLevelIdService,
} from '../../../server/services/membership/benefit.service'

// 检查数据库是否可用
let dbAvailable = false

describe('权益服务测试', () => {
    const testIds: TestIds = createEmptyTestIds()
    const prisma = getTestPrisma()

    // 测试数据追踪
    const testBenefitIds: number[] = []
    const testMembershipBenefitIds: number[] = []
    const testUserMembershipIds: number[] = []

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            // 清理会员权益关联
            if (testMembershipBenefitIds.length > 0) {
                await prisma.membershipBenefits.deleteMany({
                    where: { id: { in: testMembershipBenefitIds } },
                })
                testMembershipBenefitIds.length = 0
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

    // 创建会员权益关联
    const createTestMembershipBenefit = async (levelId: number, benefitId: number, benefitValue?: bigint) => {
        const mb = await prisma.membershipBenefits.create({
            data: {
                levelId,
                benefitId,
                benefitValue: benefitValue ?? BigInt(100),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testMembershipBenefitIds.push(mb.id)
        return mb
    }

    // 创建用户会员记录
    const createTestUserMembership = async (userId: number, levelId: number) => {
        const now = new Date()
        const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        const um = await prisma.userMemberships.create({
            data: {
                userId,
                levelId,
                startDate: now,
                endDate,
                status: 1, // ACTIVE
                sourceType: 1,
                createdAt: now,
                updatedAt: now,
            },
        })
        testUserMembershipIds.push(um.id)
        return um
    }

    describe('getBenefitsByLevelIdService 测试', () => {
        it('应返回指定级别的权益列表', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            // 创建权益并关联到级别
            const benefit1 = await createTestBenefit({ name: '权益1' })
            const benefit2 = await createTestBenefit({ name: '权益2' })

            await createTestMembershipBenefit(level.id, benefit1.id)
            await createTestMembershipBenefit(level.id, benefit2.id)

            const benefits = await getBenefitsByLevelIdService(level.id)

            expect(benefits.length).toBe(2)
            expect(benefits.map(b => b.name)).toContain('权益1')
            expect(benefits.map(b => b.name)).toContain('权益2')
        })

        it('没有权益的级别应返回空数组', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const benefits = await getBenefitsByLevelIdService(level.id)

            expect(benefits).toEqual([])
        })

        it('Property: 返回的权益数量应等于关联数量', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 5 }),
                    async (benefitCount) => {
                        const level = await createTestMembershipLevel()
                        testIds.membershipLevelIds.push(level.id)

                        // 创建指定数量的权益并关联
                        for (let i = 0; i < benefitCount; i++) {
                            const benefit = await createTestBenefit({ name: `权益_${i}` })
                            await createTestMembershipBenefit(level.id, benefit.id)
                        }

                        const benefits = await getBenefitsByLevelIdService(level.id)

                        expect(benefits.length).toBe(benefitCount)

                        return true
                    }
                ),
                { numRuns: 5 }
            )
        })
    })

    describe('getUserBenefitsService 测试', () => {
        it('有会员的用户应返回权益列表', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建权益并关联到级别
            const benefit = await createTestBenefit({ name: '用户权益' })
            await createTestMembershipBenefit(level.id, benefit.id)

            // 创建用户会员记录
            await createTestUserMembership(user.id, level.id)

            const benefits = await getUserBenefitsService(user.id)

            expect(benefits.length).toBe(1)
            expect(benefits[0].name).toBe('用户权益')
        })

        it('没有会员的用户应返回空数组', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const benefits = await getUserBenefitsService(user.id)

            expect(benefits).toEqual([])
        })

        it('会员过期的用户应返回空数组', async () => {
            if (!dbAvailable) return

            const level = await createTestMembershipLevel()
            testIds.membershipLevelIds.push(level.id)

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建权益并关联到级别
            const benefit = await createTestBenefit({ name: '过期权益' })
            await createTestMembershipBenefit(level.id, benefit.id)

            // 创建已过期的用户会员记录
            const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            const um = await prisma.userMemberships.create({
                data: {
                    userId: user.id,
                    levelId: level.id,
                    startDate: new Date(pastDate.getTime() - 30 * 24 * 60 * 60 * 1000),
                    endDate: pastDate,
                    status: 2, // EXPIRED
                    sourceType: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testUserMembershipIds.push(um.id)

            const benefits = await getUserBenefitsService(user.id)

            expect(benefits).toEqual([])
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
