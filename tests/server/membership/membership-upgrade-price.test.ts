/**
 * 会员升级服务 - 覆盖率补充测试
 *
 * 覆盖 membershipUpgrade.service.ts 中 calculateUpgradePrice 纯函数的边缘路径
 *
 * **Feature: membership-upgrade**
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { calculateUpgradePrice } from '~~/server/services/membership/membershipUpgrade.service'
import dayjs from 'dayjs'

// 创建模拟会员记录
const createMockMembership = (overrides: Partial<{
    startDate: Date
    endDate: Date
    levelSortOrder: number
}> = {}) => {
    const startDate = overrides.startDate ?? dayjs().subtract(265, 'day').toDate()
    const endDate = overrides.endDate ?? dayjs().add(100, 'day').toDate()
    return {
        id: 1,
        userId: 1,
        levelId: 1,
        startDate,
        endDate,
        status: 1,
        sourceType: 'direct_purchase',
        sourceId: 1,
        settlementAt: null,
        remark: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        level: {
            id: 1,
            name: '基础版',
            description: null,
            sortOrder: overrides.levelSortOrder ?? 1,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        },
    } as any
}

const createMockLevel = (sortOrder: number = 2) => ({
    id: 2,
    name: '专业版',
    description: null,
    sortOrder,
    status: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
}) as any

const createMockProduct = (config: {
    priceYearly?: any
    priceMonthly?: any
} = {}) => ({
    id: 1,
    name: '专业版年卡',
    type: 1,
    status: 1,
    priceYearly: 'priceYearly' in config ? config.priceYearly : { toNumber: () => 680 },
    priceMonthly: 'priceMonthly' in config ? config.priceMonthly : null,
    unitPrice: null,
    levelId: 2,
    sortOrder: 1,
    purchaseLimit: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
}) as any

describe('会员升级服务 - calculateUpgradePrice 覆盖率补充', () => {
    describe('基本升级价格计算', () => {
        it('应正确计算标准升级价格', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership,
                targetLevel,
                null,
                targetProduct,
                100,
                365,
                365
            )

            // 日均价值 = 365/365 = 1
            // 当前剩余价值 = 1 * 100 = 100
            // 目标日均价值 = 680/365 ≈ 1.863
            // 目标剩余价值 = 1.863 * 100 ≈ 186.30
            // 升级价格 = 186.30 - 100 = 86.30
            expect(result.upgradePrice).toBeCloseTo(86.30, 1)
            expect(result.upgradePrice).toBeGreaterThan(0)
        })
    })

    describe('边缘情况：剩余天数', () => {
        it('剩余天数为 0 时升级价格应为 0', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                0, 365, 365
            )

            expect(result.upgradePrice).toBe(0)
            expect(result.pointCompensation).toBe(0)
            expect(result.originalRemainingValue).toBe(0)
            expect(result.targetRemainingValue).toBe(0)
        })

        it('剩余天数为负数时应被限制为 0', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                -10, 365, 365
            )

            expect(result.upgradePrice).toBe(0)
            expect(result.calculationDetails.remainingDays).toBe(0)
        })

        it('剩余天数大于总天数时应被限制为总天数', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                500, 365, 365
            )

            expect(result.calculationDetails.remainingDays).toBe(365)
        })
    })

    describe('边缘情况：实付金额', () => {
        it('实付金额为 0 时当前剩余价值应为 0', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                100, 0, 365
            )

            expect(result.originalRemainingValue).toBe(0)
            expect(result.calculationDetails.dailyValue).toBe(0)
            expect(result.upgradePrice).toBeGreaterThan(0)
        })
    })

    describe('边缘情况：目标商品价格', () => {
        it('目标商品只有月价没有年价时应按月价*12计算', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct({
                priceYearly: null,
                priceMonthly: { toNumber: () => 56 },
            })

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                100, 365, 365
            )

            // 目标年价 = 56 * 12 = 672
            expect(result.calculationDetails.targetYearlyPrice).toBe(672)
        })

        it('目标商品没有年价和月价时目标日均价值为 0', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct({
                priceYearly: null,
                priceMonthly: null,
            })

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                100, 365, 365
            )

            expect(result.calculationDetails.targetYearlyPrice).toBe(0)
            expect(result.calculationDetails.targetDailyValue).toBe(0)
            expect(result.upgradePrice).toBe(0)
        })
    })

    describe('边缘情况：原始总天数', () => {
        it('不传 originalTotalDays 时应使用会员记录计算', () => {
            const startDate = dayjs().subtract(265, 'day').toDate()
            const endDate = dayjs().add(100, 'day').toDate()
            const membership = createMockMembership({ startDate, endDate })
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                100, 365
            )

            expect(result.calculationDetails.totalDays).toBeGreaterThan(0)
        })

        it('总天数为 0 时日均价值应为 0', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                0, 365, 0
            )

            expect(result.calculationDetails.dailyValue).toBe(0)
        })
    })

    describe('积分补偿计算', () => {
        it('积分补偿应为升级价格的 10 倍', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                100, 365, 365
            )

            expect(result.pointCompensation).toBe(Math.round(result.upgradePrice * 10))
        })

        it('升级价格为 0 时积分补偿也为 0', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const targetProduct = createMockProduct()

            const result = calculateUpgradePrice(
                membership, targetLevel, null, targetProduct,
                0, 365, 365
            )

            expect(result.pointCompensation).toBe(0)
        })
    })

    describe('Property: 升级价格非负性', () => {
        it('任意参数组合下升级价格应大于等于 0', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 365 }),
                    fc.integer({ min: 0, max: 10000 }),
                    fc.integer({ min: 1, max: 730 }),
                    fc.integer({ min: 1, max: 10000 }),
                    (remainingDays, paidAmount, totalDays, targetYearlyPrice) => {
                        const membership = createMockMembership()
                        const targetLevel = createMockLevel()
                        const targetProduct = createMockProduct({
                            priceYearly: { toNumber: () => targetYearlyPrice },
                        })

                        const result = calculateUpgradePrice(
                            membership, targetLevel, null, targetProduct,
                            remainingDays, paidAmount, totalDays
                        )

                        expect(result.upgradePrice).toBeGreaterThanOrEqual(0)
                        expect(result.pointCompensation).toBeGreaterThanOrEqual(0)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
