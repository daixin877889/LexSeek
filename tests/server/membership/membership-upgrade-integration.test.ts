/**
 * 会员升级集成测试
 *
 * 测试场景：
 * - 查询可升级目标级别 → 返回比当前级别高的级别
 * - 计算升级价格 → 符合公式
 * - 计算积分补偿 → 符合公式
 * - 升级成功 → 原会员失效 + 新会员创建
 * - 升级成功 → 原积分转移到新会员
 * - 升级成功 → 发放积分补偿
 * - 升级成功 → 记录升级历史
 * - 无有效会员 → 不允许升级
 * - 已是最高级别 → 不允许升级
 *
 * **Feature: membership-system**
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createMembershipLevel,
    createUserMembership,
    createProduct,
    createPointRecord,
    generateMembershipLevels,
    generatePointRecords,
    MembershipStatus,
    UserMembershipSourceType,
    type MockPointRecord,
} from './membership-test-fixtures'
import {
    canUpgrade,
    calculateUpgradePrice,
    simulateMembershipUpgrade,
    getHigherLevels,
    getRemainingDays,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('会员升级集成测试', () => {
    describe('查询可升级目标级别', () => {
        it('应返回比当前级别高的级别', () => {
            const levels = generateMembershipLevels(3)
            const currentLevel = levels[2] // 普通会员，sortOrder = 3

            const higherLevels = getHigherLevels(currentLevel, levels)

            expect(higherLevels.length).toBe(2)
            higherLevels.forEach((level) => {
                expect(level.sortOrder).toBeLessThan(currentLevel.sortOrder)
            })
        })

        it('最高级别应没有可升级目标', () => {
            const levels = generateMembershipLevels(3)
            const highestLevel = levels[0] // 钻石会员，sortOrder = 1

            const higherLevels = getHigherLevels(highestLevel, levels)

            expect(higherLevels.length).toBe(0)
        })
    })

    describe('升级价格计算', () => {
        it('升级价格应等于目标级别剩余价值减去原级别剩余价值', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 500, max: 1000 }),
                    (remainingDays, currentYearlyPrice, targetYearlyPrice) => {
                        const currentMembership = createUserMembership({
                            levelId: 1,
                            endDate: daysFromNow(remainingDays),
                        })

                        const currentProduct = createProduct({
                            levelId: 1,
                            priceYearly: currentYearlyPrice,
                        })

                        const targetProduct = createProduct({
                            id: 2,
                            levelId: 2,
                            priceYearly: targetYearlyPrice,
                        })

                        const result = calculateUpgradePrice(
                            currentMembership,
                            currentProduct,
                            targetProduct,
                            remainingDays
                        )

                        // 验证计算公式
                        const expectedOriginal =
                            Math.round((currentYearlyPrice / 365) * remainingDays * 100) / 100
                        const expectedTarget =
                            Math.round((targetYearlyPrice / 365) * remainingDays * 100) / 100
                        const expectedPrice = Math.max(
                            0,
                            Math.round((expectedTarget - expectedOriginal) * 100) / 100
                        )

                        expect(result.originalRemainingValue).toBeCloseTo(expectedOriginal, 2)
                        expect(result.targetRemainingValue).toBeCloseTo(expectedTarget, 2)
                        expect(result.upgradePrice).toBeCloseTo(expectedPrice, 2)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('积分补偿应等于升级价格乘以10', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 500, max: 1000 }),
                    (remainingDays, currentYearlyPrice, targetYearlyPrice) => {
                        const currentMembership = createUserMembership({
                            levelId: 1,
                            endDate: daysFromNow(remainingDays),
                        })

                        const currentProduct = createProduct({
                            levelId: 1,
                            priceYearly: currentYearlyPrice,
                        })

                        const targetProduct = createProduct({
                            id: 2,
                            levelId: 2,
                            priceYearly: targetYearlyPrice,
                        })

                        const result = calculateUpgradePrice(
                            currentMembership,
                            currentProduct,
                            targetProduct,
                            remainingDays
                        )

                        expect(result.pointCompensation).toBe(
                            Math.round(result.upgradePrice * 10)
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('升级价格不应为负数', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    fc.integer({ min: 0, max: 1000 }),
                    fc.integer({ min: 0, max: 1000 }),
                    (remainingDays, currentYearlyPrice, targetYearlyPrice) => {
                        const currentMembership = createUserMembership({
                            levelId: 1,
                            endDate: daysFromNow(remainingDays),
                        })

                        const currentProduct = createProduct({
                            levelId: 1,
                            priceYearly: currentYearlyPrice,
                        })

                        const targetProduct = createProduct({
                            id: 2,
                            levelId: 2,
                            priceYearly: targetYearlyPrice,
                        })

                        const result = calculateUpgradePrice(
                            currentMembership,
                            currentProduct,
                            targetProduct,
                            remainingDays
                        )

                        expect(result.upgradePrice).toBeGreaterThanOrEqual(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('升级资格验证', () => {
        it('没有有效会员时不允许升级', () => {
            const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

            const result = canUpgrade(null, targetLevel)

            expect(result.canUpgrade).toBe(false)
            expect(result.reason).toBe('用户没有有效会员')
        })

        it('会员已过期时不允许升级', () => {
            const currentMembership = createUserMembership({
                status: MembershipStatus.ACTIVE,
                endDate: daysAgo(1), // 已过期
                level: createMembershipLevel({ id: 1, sortOrder: 2 }),
            })

            const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

            const result = canUpgrade(currentMembership, targetLevel)

            expect(result.canUpgrade).toBe(false)
            expect(result.reason).toBe('会员已过期')
        })

        it('会员状态无效时不允许升级', () => {
            const currentMembership = createUserMembership({
                status: MembershipStatus.INACTIVE,
                endDate: daysFromNow(30),
                level: createMembershipLevel({ id: 1, sortOrder: 2 }),
            })

            const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

            const result = canUpgrade(currentMembership, targetLevel)

            expect(result.canUpgrade).toBe(false)
            expect(result.reason).toBe('会员状态无效')
        })

        it('目标级别不高于当前级别时不允许升级', () => {
            const currentMembership = createUserMembership({
                status: MembershipStatus.ACTIVE,
                endDate: daysFromNow(30),
                level: createMembershipLevel({ id: 1, sortOrder: 1 }), // 最高级别
            })

            const targetLevel = createMembershipLevel({ id: 2, sortOrder: 2 }) // 更低级别

            const result = canUpgrade(currentMembership, targetLevel)

            expect(result.canUpgrade).toBe(false)
            expect(result.reason).toBe('目标级别必须高于当前级别')
        })

        it('满足所有条件时允许升级', () => {
            const currentMembership = createUserMembership({
                status: MembershipStatus.ACTIVE,
                endDate: daysFromNow(30),
                level: createMembershipLevel({ id: 1, sortOrder: 2 }),
            })

            const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

            const result = canUpgrade(currentMembership, targetLevel)

            expect(result.canUpgrade).toBe(true)
        })
    })

    describe('升级执行', () => {
        it('升级后原会员状态应变为 INACTIVE', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const currentMembership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(30),
                            level: createMembershipLevel({ id: 1, sortOrder: 2 }),
                        })

                        const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

                        const result = simulateMembershipUpgrade(
                            currentMembership,
                            targetLevel,
                            []
                        )

                        expect(result.oldMembership.status).toBe(MembershipStatus.INACTIVE)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('升级后应创建新会员记录', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const currentMembership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(30),
                            level: createMembershipLevel({ id: 1, sortOrder: 2 }),
                        })

                        const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

                        const result = simulateMembershipUpgrade(
                            currentMembership,
                            targetLevel,
                            []
                        )

                        expect(result.newMembership).toBeDefined()
                        expect(result.newMembership.userId).toBe(userId)
                        expect(result.newMembership.levelId).toBe(targetLevel.id)
                        expect(result.newMembership.status).toBe(MembershipStatus.ACTIVE)
                        expect(result.newMembership.sourceType).toBe(
                            UserMembershipSourceType.MEMBERSHIP_UPGRADE
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('新会员应继承原会员的结束时间', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 365 }),
                    (userId, remainingDays) => {
                        const endDate = daysFromNow(remainingDays)
                        const currentMembership = createUserMembership({
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate,
                            level: createMembershipLevel({ id: 1, sortOrder: 2 }),
                        })

                        const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

                        const result = simulateMembershipUpgrade(
                            currentMembership,
                            targetLevel,
                            []
                        )

                        expect(result.newMembership.endDate.getTime()).toBe(
                            endDate.getTime()
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('升级后积分记录应转移到新会员', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 5 }),
                    (userId, pointRecordCount) => {
                        const currentMembership = createUserMembership({
                            id: 1,
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(30),
                            level: createMembershipLevel({ id: 1, sortOrder: 2 }),
                        })

                        const pointRecords = generatePointRecords(
                            userId,
                            pointRecordCount,
                            currentMembership.id
                        )

                        const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

                        const result = simulateMembershipUpgrade(
                            currentMembership,
                            targetLevel,
                            pointRecords
                        )

                        // 验证所有积分记录都转移到了新会员
                        expect(result.transferredPoints.length).toBe(pointRecordCount)
                        result.transferredPoints.forEach((p) => {
                            expect(p.userMembershipId).toBe(result.newMembership.id)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('转移后积分数量应保持不变', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const currentMembership = createUserMembership({
                            id: 1,
                            userId,
                            status: MembershipStatus.ACTIVE,
                            endDate: daysFromNow(30),
                            level: createMembershipLevel({ id: 1, sortOrder: 2 }),
                        })

                        const pointRecords = generatePointRecords(
                            userId,
                            3,
                            currentMembership.id
                        )

                        const originalTotal = pointRecords.reduce(
                            (sum, p) => sum + p.remaining,
                            0
                        )

                        const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

                        const result = simulateMembershipUpgrade(
                            currentMembership,
                            targetLevel,
                            pointRecords
                        )

                        const transferredTotal = result.transferredPoints.reduce(
                            (sum, p) => sum + p.remaining,
                            0
                        )

                        expect(transferredTotal).toBe(originalTotal)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 10 & 11: 升级价格和状态转换', () => {
        it('升级价格计算应符合公式', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 30, max: 365 }),
                    fc.integer({ min: 100, max: 500 }),
                    fc.integer({ min: 600, max: 1200 }),
                    (remainingDays, currentPrice, targetPrice) => {
                        const currentMembership = createUserMembership({
                            endDate: daysFromNow(remainingDays),
                        })

                        const currentProduct = createProduct({ priceYearly: currentPrice })
                        const targetProduct = createProduct({ priceYearly: targetPrice })

                        const result = calculateUpgradePrice(
                            currentMembership,
                            currentProduct,
                            targetProduct,
                            remainingDays
                        )

                        // 升级价格 = 目标剩余价值 - 原剩余价值
                        expect(result.upgradePrice).toBeCloseTo(
                            result.targetRemainingValue - result.originalRemainingValue,
                            2
                        )

                        // 积分补偿 = 升级价格 × 10
                        expect(result.pointCompensation).toBe(
                            Math.round(result.upgradePrice * 10)
                        )
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('升级后状态转换应正确', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    (userId) => {
                        const currentMembership = createUserMembership({
                            id: 1,
                            userId,
                            status: MembershipStatus.ACTIVE,
                            level: createMembershipLevel({ id: 1, sortOrder: 2 }),
                        })

                        const pointRecords = generatePointRecords(userId, 2, 1)
                        const targetLevel = createMembershipLevel({ id: 2, sortOrder: 1 })

                        const result = simulateMembershipUpgrade(
                            currentMembership,
                            targetLevel,
                            pointRecords
                        )

                        // 原会员失效
                        expect(result.oldMembership.status).toBe(MembershipStatus.INACTIVE)

                        // 新会员创建
                        expect(result.newMembership.status).toBe(MembershipStatus.ACTIVE)
                        expect(result.newMembership.levelId).toBe(targetLevel.id)

                        // 积分转移
                        expect(result.transferredPoints.length).toBe(2)
                        result.transferredPoints.forEach((p) => {
                            expect(p.userMembershipId).toBe(result.newMembership.id)
                        })
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
