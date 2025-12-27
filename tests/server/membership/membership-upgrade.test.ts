/**
 * 会员升级属性测试
 *
 * 使用 fast-check 进行属性测试，验证会员升级的核心业务逻辑
 *
 * **Feature: membership-system**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 会员状态
const MembershipStatus = {
    INACTIVE: 0,
    ACTIVE: 1,
} as const

// 会员来源类型
const UserMembershipSourceType = {
    REDEMPTION_CODE: 1,
    DIRECT_PURCHASE: 2,
    ADMIN_GIFT: 3,
    ACTIVITY_AWARD: 4,
    TRIAL: 5,
    REGISTRATION_AWARD: 6,
    INVITATION_TO_REGISTER: 7,
    MEMBERSHIP_UPGRADE: 8,
    OTHER: 99,
} as const

/** 模拟会员级别 */
interface MockMembershipLevel {
    id: number
    name: string
    sortOrder: number
    status: number
}

/** 模拟商品 */
interface MockProduct {
    id: number
    name: string
    levelId: number
    priceMonthly: number | null
    priceYearly: number | null
}

/** 模拟用户会员记录 */
interface MockUserMembership {
    id: number
    userId: number
    levelId: number
    level: MockMembershipLevel
    startDate: Date
    endDate: Date
    status: number
    sourceType: number
}

/** 模拟积分记录 */
interface MockPointRecord {
    id: number
    userId: number
    userMembershipId: number
    pointAmount: number
    remaining: number
}

/** 升级价格计算结果 */
interface UpgradePriceResult {
    originalRemainingValue: number
    targetRemainingValue: number
    upgradePrice: number
    pointCompensation: number
}

/**
 * 计算升级价格
 * @param currentMembership 当前会员
 * @param targetProduct 目标商品
 * @param remainingDays 剩余天数
 */
const calculateUpgradePrice = (
    currentMembership: MockUserMembership,
    currentProduct: MockProduct | null,
    targetProduct: MockProduct,
    remainingDays: number
): UpgradePriceResult => {
    // 获取当前级别的日均价格
    const currentYearlyPrice = currentProduct?.priceYearly ?? 0
    const currentDailyPrice = currentYearlyPrice / 365

    // 获取目标级别的日均价格
    const targetYearlyPrice = targetProduct.priceYearly
        ?? (targetProduct.priceMonthly ? targetProduct.priceMonthly * 12 : 0)
    const targetDailyPrice = targetYearlyPrice / 365

    // 计算原级别剩余价值
    const originalRemainingValue = Math.round(currentDailyPrice * remainingDays * 100) / 100

    // 计算目标级别剩余价值
    const targetRemainingValue = Math.round(targetDailyPrice * remainingDays * 100) / 100

    // 升级价格 = 目标级别剩余价值 - 原级别剩余价值
    const upgradePrice = Math.max(0, Math.round((targetRemainingValue - originalRemainingValue) * 100) / 100)

    // 积分补偿 = 升级价格 × 10
    const pointCompensation = Math.round(upgradePrice * 10)

    return {
        originalRemainingValue,
        targetRemainingValue,
        upgradePrice,
        pointCompensation,
    }
}

/**
 * Property 10: 升级价格计算正确性
 *
 * For any 会员升级操作，升级价格 SHALL 等于 (目标级别剩余价值 - 原级别剩余价值)，
 * 积分补偿 SHALL 等于 (升级价格 × 10)。
 *
 * **Feature: membership-system, Property 10: 升级价格计算正确性**
 * **Validates: Requirements 8.2, 8.3**
 */
describe('Property 10: 升级价格计算正确性', () => {
    it('升级价格应等于目标级别剩余价值减去原级别剩余价值', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 365 }), // 剩余天数
                fc.integer({ min: 0, max: 1000 }), // 当前级别年价格
                fc.integer({ min: 100, max: 2000 }), // 目标级别年价格
                (remainingDays, currentYearlyPrice, targetYearlyPrice) => {
                    // 确保目标价格高于当前价格
                    const actualTargetPrice = Math.max(targetYearlyPrice, currentYearlyPrice + 100)

                    const currentProduct: MockProduct = {
                        id: 1,
                        name: '当前商品',
                        levelId: 1,
                        priceMonthly: null,
                        priceYearly: currentYearlyPrice,
                    }

                    const targetProduct: MockProduct = {
                        id: 2,
                        name: '目标商品',
                        levelId: 2,
                        priceMonthly: null,
                        priceYearly: actualTargetPrice,
                    }

                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId: 1,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const result = calculateUpgradePrice(
                        currentMembership,
                        currentProduct,
                        targetProduct,
                        remainingDays
                    )

                    // 验证升级价格计算
                    const expectedOriginalValue = Math.round((currentYearlyPrice / 365) * remainingDays * 100) / 100
                    const expectedTargetValue = Math.round((actualTargetPrice / 365) * remainingDays * 100) / 100
                    const expectedUpgradePrice = Math.max(0, Math.round((expectedTargetValue - expectedOriginalValue) * 100) / 100)

                    expect(result.originalRemainingValue).toBeCloseTo(expectedOriginalValue, 2)
                    expect(result.targetRemainingValue).toBeCloseTo(expectedTargetValue, 2)
                    expect(result.upgradePrice).toBeCloseTo(expectedUpgradePrice, 2)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('积分补偿应等于升级价格乘以10', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 365 }),
                fc.integer({ min: 0, max: 500 }),
                fc.integer({ min: 500, max: 2000 }),
                (remainingDays, currentYearlyPrice, targetYearlyPrice) => {
                    const currentProduct: MockProduct = {
                        id: 1,
                        name: '当前商品',
                        levelId: 1,
                        priceMonthly: null,
                        priceYearly: currentYearlyPrice,
                    }

                    const targetProduct: MockProduct = {
                        id: 2,
                        name: '目标商品',
                        levelId: 2,
                        priceMonthly: null,
                        priceYearly: targetYearlyPrice,
                    }

                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId: 1,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const result = calculateUpgradePrice(
                        currentMembership,
                        currentProduct,
                        targetProduct,
                        remainingDays
                    )

                    // 积分补偿 = 升级价格 × 10
                    expect(result.pointCompensation).toBe(Math.round(result.upgradePrice * 10))
                }
            ),
            { numRuns: 100 }
        )
    })

    it('升级价格不应为负数', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 365 }),
                fc.integer({ min: 0, max: 2000 }),
                fc.integer({ min: 0, max: 2000 }),
                (remainingDays, currentYearlyPrice, targetYearlyPrice) => {
                    const currentProduct: MockProduct = {
                        id: 1,
                        name: '当前商品',
                        levelId: 1,
                        priceMonthly: null,
                        priceYearly: currentYearlyPrice,
                    }

                    const targetProduct: MockProduct = {
                        id: 2,
                        name: '目标商品',
                        levelId: 2,
                        priceMonthly: null,
                        priceYearly: targetYearlyPrice,
                    }

                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId: 1,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

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

    it('剩余天数为0时升级价格应为0', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: 100, max: 2000 }),
                (currentYearlyPrice, targetYearlyPrice) => {
                    const currentProduct: MockProduct = {
                        id: 1,
                        name: '当前商品',
                        levelId: 1,
                        priceMonthly: null,
                        priceYearly: currentYearlyPrice,
                    }

                    const targetProduct: MockProduct = {
                        id: 2,
                        name: '目标商品',
                        levelId: 2,
                        priceMonthly: null,
                        priceYearly: targetYearlyPrice,
                    }

                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId: 1,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const result = calculateUpgradePrice(
                        currentMembership,
                        currentProduct,
                        targetProduct,
                        0 // 剩余天数为0
                    )

                    expect(result.upgradePrice).toBe(0)
                    expect(result.pointCompensation).toBe(0)
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * Property 11: 会员升级状态转换
 *
 * For any 成功的会员升级操作，原会员记录 SHALL 被标记为无效，新会员记录 SHALL 被创建，
 * 原会员关联的积分记录 SHALL 转移到新会员。
 *
 * **Feature: membership-system, Property 11: 会员升级状态转换**
 * **Validates: Requirements 8.4, 8.5, 10.2**
 */
describe('Property 11: 会员升级状态转换', () => {
    /**
     * 模拟执行会员升级
     */
    const executeMembershipUpgrade = (
        currentMembership: MockUserMembership,
        targetLevel: MockMembershipLevel,
        pointRecords: MockPointRecord[],
        orderId: number
    ): {
        success: boolean
        oldMembership: MockUserMembership
        newMembership: MockUserMembership
        transferredPoints: MockPointRecord[]
    } => {
        // 1. 将原会员标记为无效
        const oldMembership: MockUserMembership = {
            ...currentMembership,
            status: MembershipStatus.INACTIVE,
        }

        // 2. 创建新会员记录
        const newMembership: MockUserMembership = {
            id: currentMembership.id + 1000,
            userId: currentMembership.userId,
            levelId: targetLevel.id,
            level: targetLevel,
            startDate: new Date(),
            endDate: currentMembership.endDate, // 继承原会员的结束时间
            status: MembershipStatus.ACTIVE,
            sourceType: UserMembershipSourceType.MEMBERSHIP_UPGRADE,
        }

        // 3. 转移积分记录
        const transferredPoints = pointRecords
            .filter((p) => p.userMembershipId === currentMembership.id)
            .map((p) => ({
                ...p,
                userMembershipId: newMembership.id,
            }))

        return {
            success: true,
            oldMembership,
            newMembership,
            transferredPoints,
        }
    }

    it('升级后原会员状态应变为 INACTIVE', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 1, max: 100 }),
                (userId, levelId) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId,
                        level: { id: levelId, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const targetLevel: MockMembershipLevel = {
                        id: levelId + 1,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = executeMembershipUpgrade(
                        currentMembership,
                        targetLevel,
                        [],
                        1
                    )

                    expect(result.oldMembership.status).toBe(MembershipStatus.INACTIVE)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('升级后应创建新的会员记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 1, max: 100 }),
                (userId, levelId) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId,
                        level: { id: levelId, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const targetLevel: MockMembershipLevel = {
                        id: levelId + 1,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = executeMembershipUpgrade(
                        currentMembership,
                        targetLevel,
                        [],
                        1
                    )

                    expect(result.newMembership).toBeDefined()
                    expect(result.newMembership.userId).toBe(userId)
                    expect(result.newMembership.levelId).toBe(targetLevel.id)
                    expect(result.newMembership.status).toBe(MembershipStatus.ACTIVE)
                    expect(result.newMembership.sourceType).toBe(UserMembershipSourceType.MEMBERSHIP_UPGRADE)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('新会员应继承原会员的结束时间', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 1, max: 365 }),
                (userId, remainingDays) => {
                    const endDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000)

                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate,
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const targetLevel: MockMembershipLevel = {
                        id: 2,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = executeMembershipUpgrade(
                        currentMembership,
                        targetLevel,
                        [],
                        1
                    )

                    expect(result.newMembership.endDate.getTime()).toBe(endDate.getTime())
                }
            ),
            { numRuns: 100 }
        )
    })

    it('升级后积分记录应转移到新会员', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        pointAmount: fc.integer({ min: 1, max: 1000 }),
                        remaining: fc.integer({ min: 0, max: 1000 }),
                    }),
                    { minLength: 1, maxLength: 5 }
                ),
                (userId, pointsData) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const pointRecords: MockPointRecord[] = pointsData.map((p, index) => ({
                        id: p.id + index,
                        userId,
                        userMembershipId: currentMembership.id,
                        pointAmount: p.pointAmount,
                        remaining: Math.min(p.remaining, p.pointAmount),
                    }))

                    const targetLevel: MockMembershipLevel = {
                        id: 2,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = executeMembershipUpgrade(
                        currentMembership,
                        targetLevel,
                        pointRecords,
                        1
                    )

                    // 验证所有积分记录都转移到了新会员
                    expect(result.transferredPoints.length).toBe(pointRecords.length)
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
                fc.integer({ min: 1, max: 1000 }),
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        pointAmount: fc.integer({ min: 1, max: 1000 }),
                        remaining: fc.integer({ min: 0, max: 1000 }),
                    }),
                    { minLength: 1, maxLength: 5 }
                ),
                (userId, pointsData) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const pointRecords: MockPointRecord[] = pointsData.map((p, index) => ({
                        id: p.id + index,
                        userId,
                        userMembershipId: currentMembership.id,
                        pointAmount: p.pointAmount,
                        remaining: Math.min(p.remaining, p.pointAmount),
                    }))

                    const targetLevel: MockMembershipLevel = {
                        id: 2,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = executeMembershipUpgrade(
                        currentMembership,
                        targetLevel,
                        pointRecords,
                        1
                    )

                    // 验证积分数量保持不变
                    const originalTotal = pointRecords.reduce((sum, p) => sum + p.remaining, 0)
                    const transferredTotal = result.transferredPoints.reduce((sum, p) => sum + p.remaining, 0)
                    expect(transferredTotal).toBe(originalTotal)
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * 升级资格验证测试
 */
describe('会员升级资格验证', () => {
    /**
     * 检查是否可以升级
     */
    const canUpgrade = (
        currentMembership: MockUserMembership | null,
        targetLevel: MockMembershipLevel
    ): { canUpgrade: boolean; reason?: string } => {
        // 没有有效会员不能升级
        if (!currentMembership) {
            return { canUpgrade: false, reason: '用户没有有效会员' }
        }

        // 会员已过期不能升级
        if (currentMembership.endDate < new Date()) {
            return { canUpgrade: false, reason: '会员已过期' }
        }

        // 会员状态无效不能升级
        if (currentMembership.status !== MembershipStatus.ACTIVE) {
            return { canUpgrade: false, reason: '会员状态无效' }
        }

        // 目标级别必须高于当前级别（sortOrder 更小）
        if (targetLevel.sortOrder >= currentMembership.level.sortOrder) {
            return { canUpgrade: false, reason: '目标级别必须高于当前级别' }
        }

        return { canUpgrade: true }
    }

    it('没有有效会员时不能升级', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }),
                (targetLevelId) => {
                    const targetLevel: MockMembershipLevel = {
                        id: targetLevelId,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = canUpgrade(null, targetLevel)

                    expect(result.canUpgrade).toBe(false)
                    expect(result.reason).toBe('用户没有有效会员')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('会员已过期时不能升级', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                (userId) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: 2, status: 1 },
                        startDate: new Date('2024-01-01'),
                        endDate: new Date('2024-12-31'), // 已过期
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    const targetLevel: MockMembershipLevel = {
                        id: 2,
                        name: '高级会员',
                        sortOrder: 1,
                        status: 1,
                    }

                    const result = canUpgrade(currentMembership, targetLevel)

                    expect(result.canUpgrade).toBe(false)
                    expect(result.reason).toBe('会员已过期')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('目标级别不高于当前级别时不能升级', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 1, max: 10 }),
                (userId, sortOrder) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId: 1,
                        level: { id: 1, name: '高级会员', sortOrder, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    // 目标级别 sortOrder >= 当前级别（级别更低或相同）
                    const targetLevel: MockMembershipLevel = {
                        id: 2,
                        name: '普通会员',
                        sortOrder: sortOrder + 1, // sortOrder 更大，级别更低
                        status: 1,
                    }

                    const result = canUpgrade(currentMembership, targetLevel)

                    expect(result.canUpgrade).toBe(false)
                    expect(result.reason).toBe('目标级别必须高于当前级别')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('满足所有条件时可以升级', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 2, max: 10 }),
                (userId, currentSortOrder) => {
                    const currentMembership: MockUserMembership = {
                        id: 1,
                        userId,
                        levelId: 1,
                        level: { id: 1, name: '普通会员', sortOrder: currentSortOrder, status: 1 },
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        status: MembershipStatus.ACTIVE,
                        sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                    }

                    // 目标级别 sortOrder < 当前级别（级别更高）
                    const targetLevel: MockMembershipLevel = {
                        id: 2,
                        name: '高级会员',
                        sortOrder: currentSortOrder - 1,
                        status: 1,
                    }

                    const result = canUpgrade(currentMembership, targetLevel)

                    expect(result.canUpgrade).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })
})
