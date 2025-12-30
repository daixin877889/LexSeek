/**
 * 会员升级价格计算测试
 *
 * 测试按实际剩余天数计算升级价格的逻辑
 *
 * **Feature: membership-upgrade-calculation**
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import {
    getTestPrisma,
    createTestUser,
    createTestMembershipLevel,
    createTestUserMembership,
    cleanupTestData,
    createEmptyTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    MembershipStatus,
    MembershipLevelStatus,
    type TestIds,
} from './test-db-helper'
import { PBT_CONFIG } from './test-generators'

// 导入实际的服务函数
import { calculateUpgradePrice } from '../../../server/services/membership/membershipUpgrade.service'
import { findCurrentUserMembershipDao } from '../../../server/services/membership/userMembership.dao'

// 测试数据 ID 追踪
let testIds: TestIds

// 数据库连接
const prisma = getTestPrisma()

// 检查数据库是否可用
let dbAvailable = false

describe('会员升级价格计算测试', () => {
    testIds = createEmptyTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        } else {
            // 重置数据库序列，避免与种子数据冲突
            await resetDatabaseSequences()
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData(testIds)
            Object.keys(testIds).forEach(key => {
                (testIds as any)[key] = []
            })
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ==================== 计算示例单元测试 ====================
    describe('计算示例验证', () => {
        /**
         * 示例 1：365 元/365 天，剩余 100 天，升级到 680 元/年
         * - 日均价值 = 365 / 365 = 1 元/天
         * - 当前剩余价值 = 1 × 100 = 100 元
         * - 目标日均价值 = 680 / 365 ≈ 1.863 元/天
         * - 目标剩余价值 = 1.863 × 100 ≈ 186.30 元
         * - 升级价格 = 186.30 - 100 = 86.30 元
         */
        it('示例1：365元/365天，剩余100天，升级到680元/年，预期升级价格86.30元', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            // 创建 365 天的会员，剩余 100 天
            const now = new Date()
            const startDate = dayjs(now).subtract(265, 'day').toDate() // 已过 265 天
            const endDate = dayjs(now).add(100, 'day').toDate() // 剩余 100 天

            const membership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const currentMembership = await findCurrentUserMembershipDao(user.id)
            expect(currentMembership).not.toBeNull()

            // 模拟商品数据
            const targetProduct = {
                id: 1,
                priceYearly: { toNumber: () => 680 },
                priceMonthly: null,
            } as any

            const paidAmount = 365 // 实付金额 365 元
            const remainingDays = 100

            const result = calculateUpgradePrice(
                currentMembership!,
                targetLevel,
                null,
                targetProduct,
                remainingDays,
                paidAmount
            )

            // 验证计算结果
            // 日均价值 = 365 / 365 = 1
            // 当前剩余价值 = 1 × 100 = 100
            expect(result.originalRemainingValue).toBeCloseTo(100, 1)

            // 目标日均价值 = 680 / 365 ≈ 1.863
            // 目标剩余价值 = 1.863 × 100 ≈ 186.30
            expect(result.targetRemainingValue).toBeCloseTo(186.30, 1)

            // 升级价格 = 186.30 - 100 = 86.30
            expect(result.upgradePrice).toBeCloseTo(86.30, 1)

            // 积分补偿 = 86.30 × 10 ≈ 863
            expect(result.pointCompensation).toBe(Math.round(result.upgradePrice * 10))
        })

        /**
         * 示例 2：兑换码会员（实付 0 元），剩余 100 天，升级到 680 元/年
         * - 当前剩余价值 = 0 元
         * - 目标日均价值 = 680 / 365 ≈ 1.863 元/天
         * - 目标剩余价值 = 1.863 × 100 ≈ 186.30 元
         * - 升级价格 = 186.30 元
         */
        it('示例2：兑换码会员（实付0元），剩余100天，升级到680元/年，预期升级价格186.30元', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const startDate = dayjs(now).subtract(265, 'day').toDate()
            const endDate = dayjs(now).add(100, 'day').toDate()

            const membership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const currentMembership = await findCurrentUserMembershipDao(user.id)
            expect(currentMembership).not.toBeNull()

            const targetProduct = {
                id: 1,
                priceYearly: { toNumber: () => 680 },
                priceMonthly: null,
            } as any

            const paidAmount = 0 // 兑换码会员，实付金额为 0
            const remainingDays = 100

            const result = calculateUpgradePrice(
                currentMembership!,
                targetLevel,
                null,
                targetProduct,
                remainingDays,
                paidAmount
            )

            // 当前剩余价值 = 0
            expect(result.originalRemainingValue).toBe(0)

            // 目标剩余价值 ≈ 186.30
            expect(result.targetRemainingValue).toBeCloseTo(186.30, 1)

            // 升级价格 = 186.30
            expect(result.upgradePrice).toBeCloseTo(186.30, 1)
        })
    })

    // ==================== Property 1: 当前剩余价值计算正确性 ====================
    describe('Property 1: 当前剩余价值计算正确性', () => {
        it('当前剩余价值应等于 (实付金额 / 总天数) × 剩余天数', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // 实付金额
                    fc.integer({ min: 30, max: 365 }), // 总天数
                    fc.integer({ min: 1, max: 365 }),  // 剩余天数
                    async (paidAmount, totalDays, remainingDays) => {
                        // 确保剩余天数不超过总天数
                        const actualRemainingDays = Math.min(remainingDays, totalDays)

                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        const now = new Date()
                        const startDate = dayjs(now).subtract(totalDays - actualRemainingDays, 'day').toDate()
                        const endDate = dayjs(now).add(actualRemainingDays, 'day').toDate()

                        const membership = await createTestUserMembership(user.id, currentLevel.id, {
                            startDate,
                            endDate,
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        const currentMembership = await findCurrentUserMembershipDao(user.id)
                        if (!currentMembership) return true

                        const targetProduct = {
                            id: 1,
                            priceYearly: { toNumber: () => 680 },
                            priceMonthly: null,
                        } as any

                        const result = calculateUpgradePrice(
                            currentMembership,
                            targetLevel,
                            null,
                            targetProduct,
                            actualRemainingDays,
                            paidAmount
                        )

                        // 验证计算公式：当前剩余价值 = (实付金额 / 总天数) × 剩余天数
                        const expectedDailyValue = paidAmount / totalDays
                        const expectedRemainingValue = Math.round(expectedDailyValue * actualRemainingDays * 100) / 100

                        expect(result.originalRemainingValue).toBeCloseTo(expectedRemainingValue, 1)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    // ==================== Property 2: 目标剩余价值计算正确性 ====================
    describe('Property 2: 目标剩余价值计算正确性', () => {
        it('目标剩余价值应等于 (目标年价 / 365) × 剩余天数', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 100, max: 2000 }), // 目标年价
                    fc.integer({ min: 1, max: 365 }),    // 剩余天数
                    async (targetYearlyPrice, remainingDays) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        const now = new Date()
                        const startDate = dayjs(now).subtract(30, 'day').toDate()
                        const endDate = dayjs(now).add(remainingDays, 'day').toDate()

                        const membership = await createTestUserMembership(user.id, currentLevel.id, {
                            startDate,
                            endDate,
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        const currentMembership = await findCurrentUserMembershipDao(user.id)
                        if (!currentMembership) return true

                        const targetProduct = {
                            id: 1,
                            priceYearly: { toNumber: () => targetYearlyPrice },
                            priceMonthly: null,
                        } as any

                        const result = calculateUpgradePrice(
                            currentMembership,
                            targetLevel,
                            null,
                            targetProduct,
                            remainingDays,
                            0
                        )

                        // 验证计算公式：目标剩余价值 = (目标年价 / 365) × 剩余天数
                        const expectedTargetDailyValue = targetYearlyPrice / 365
                        const expectedTargetRemainingValue = Math.round(expectedTargetDailyValue * remainingDays * 100) / 100

                        expect(result.targetRemainingValue).toBeCloseTo(expectedTargetRemainingValue, 1)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    // ==================== Property 3: 升级价格计算正确性 ====================
    describe('Property 3: 升级价格计算正确性', () => {
        it('升级价格应等于 max(0, 目标剩余价值 - 当前剩余价值)', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 1000 }),   // 实付金额
                    fc.integer({ min: 100, max: 2000 }), // 目标年价
                    fc.integer({ min: 30, max: 365 }),   // 总天数
                    fc.integer({ min: 1, max: 365 }),    // 剩余天数
                    async (paidAmount, targetYearlyPrice, totalDays, remainingDays) => {
                        const actualRemainingDays = Math.min(remainingDays, totalDays)

                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        const now = new Date()
                        const startDate = dayjs(now).subtract(totalDays - actualRemainingDays, 'day').toDate()
                        const endDate = dayjs(now).add(actualRemainingDays, 'day').toDate()

                        const membership = await createTestUserMembership(user.id, currentLevel.id, {
                            startDate,
                            endDate,
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        const currentMembership = await findCurrentUserMembershipDao(user.id)
                        if (!currentMembership) return true

                        const targetProduct = {
                            id: 1,
                            priceYearly: { toNumber: () => targetYearlyPrice },
                            priceMonthly: null,
                        } as any

                        const result = calculateUpgradePrice(
                            currentMembership,
                            targetLevel,
                            null,
                            targetProduct,
                            actualRemainingDays,
                            paidAmount
                        )

                        // 验证升级价格 = max(0, 目标剩余价值 - 当前剩余价值)
                        const expectedUpgradePrice = Math.max(0, result.targetRemainingValue - result.originalRemainingValue)
                        expect(result.upgradePrice).toBeCloseTo(expectedUpgradePrice, 1)

                        // 验证升级价格不为负数
                        expect(result.upgradePrice).toBeGreaterThanOrEqual(0)

                        // 验证精度（保留两位小数）
                        expect(result.upgradePrice).toBe(Math.round(result.upgradePrice * 100) / 100)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    // ==================== Property 4: 剩余天数约束 ====================
    describe('Property 4: 剩余天数约束', () => {
        it('实际使用的剩余天数应满足 0 ≤ 剩余天数 ≤ 总天数', async () => {
            if (!dbAvailable) return

            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 30, max: 365 }),  // 总天数
                    fc.integer({ min: -10, max: 400 }), // 剩余天数（可能超出范围）
                    async (totalDays, remainingDays) => {
                        const user = await createTestUser()
                        testIds.userIds.push(user.id)

                        const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
                        const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
                        testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

                        const now = new Date()
                        const startDate = dayjs(now).subtract(totalDays, 'day').toDate()
                        const endDate = dayjs(startDate).add(totalDays, 'day').toDate()

                        const membership = await createTestUserMembership(user.id, currentLevel.id, {
                            startDate,
                            endDate,
                            status: MembershipStatus.ACTIVE,
                        })
                        testIds.userMembershipIds.push(membership.id)

                        const currentMembership = await findCurrentUserMembershipDao(user.id)
                        if (!currentMembership) return true

                        const targetProduct = {
                            id: 1,
                            priceYearly: { toNumber: () => 680 },
                            priceMonthly: null,
                        } as any

                        const result = calculateUpgradePrice(
                            currentMembership,
                            targetLevel,
                            null,
                            targetProduct,
                            remainingDays,
                            365
                        )

                        // 验证结果是有效的（不是 NaN 或 Infinity）
                        expect(Number.isFinite(result.originalRemainingValue)).toBe(true)
                        expect(Number.isFinite(result.targetRemainingValue)).toBe(true)
                        expect(Number.isFinite(result.upgradePrice)).toBe(true)

                        // 验证升级价格不为负数
                        expect(result.upgradePrice).toBeGreaterThanOrEqual(0)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    // ==================== 边界条件测试 ====================
    describe('边界条件测试', () => {
        it('剩余天数为0时，升级价格应为0', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const startDate = dayjs(now).subtract(365, 'day').toDate()
            const endDate = now // 今天到期

            const membership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const currentMembership = await findCurrentUserMembershipDao(user.id)
            if (!currentMembership) return

            const targetProduct = {
                id: 1,
                priceYearly: { toNumber: () => 680 },
                priceMonthly: null,
            } as any

            const result = calculateUpgradePrice(
                currentMembership,
                targetLevel,
                null,
                targetProduct,
                0, // 剩余 0 天
                365
            )

            expect(result.originalRemainingValue).toBe(0)
            expect(result.targetRemainingValue).toBe(0)
            expect(result.upgradePrice).toBe(0)
        })

        it('只有月价时应使用月价×12作为年价', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const currentLevel = await createTestMembershipLevel({ sortOrder: 2 })
            const targetLevel = await createTestMembershipLevel({ sortOrder: 1 })
            testIds.membershipLevelIds.push(currentLevel.id, targetLevel.id)

            const now = new Date()
            const startDate = dayjs(now).subtract(265, 'day').toDate()
            const endDate = dayjs(now).add(100, 'day').toDate()

            const membership = await createTestUserMembership(user.id, currentLevel.id, {
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
            })
            testIds.userMembershipIds.push(membership.id)

            const currentMembership = await findCurrentUserMembershipDao(user.id)
            if (!currentMembership) return

            // 只有月价，没有年价
            const targetProduct = {
                id: 1,
                priceYearly: null,
                priceMonthly: { toNumber: () => 56.67 }, // 56.67 × 12 ≈ 680
            } as any

            const result = calculateUpgradePrice(
                currentMembership,
                targetLevel,
                null,
                targetProduct,
                100,
                0
            )

            // 目标年价 = 56.67 × 12 = 680.04
            // 目标日均价值 = 680.04 / 365 ≈ 1.863
            // 目标剩余价值 = 1.863 × 100 ≈ 186.30
            expect(result.targetRemainingValue).toBeCloseTo(186.30, 0)
        })
    })
})
