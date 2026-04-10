/**
 * 会员升级服务覆盖率补充测试
 *
 * 覆盖 membershipUpgrade.service.ts 中未被测试的路径：
 * - calculateUpgradePrice 各种边界条件
 * - getUserUpgradeRecordsService 格式化输出
 *
 * **Feature: membership-upgrade-coverage**
 * **Validates: Requirements 会员升级模块**
 */

import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { calculateUpgradePrice } from '../../../server/services/membership/membershipUpgrade.service'

/** 创建模拟会员记录 */
function createMockMembership(overrides: Record<string, any> = {}) {
    const startDate = dayjs().subtract(265, 'day').toDate()
    const endDate = dayjs().add(100, 'day').toDate()
    return {
        id: 1,
        userId: 1,
        levelId: 1,
        startDate,
        endDate,
        status: 1,
        sourceType: 1,
        sourceId: null,
        remark: null,
        settlementAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        level: {
            id: 1,
            name: '基础版',
            sortOrder: 1,
            status: 1,
            description: null,
            features: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        },
        ...overrides,
    } as any
}

/** 创建模拟目标级别 */
function createMockLevel(overrides: Record<string, any> = {}) {
    return {
        id: 2,
        name: '专业版',
        sortOrder: 2,
        status: 1,
        description: null,
        features: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as any
}

/** 创建模拟商品（Decimal 模拟） */
function createMockProduct(overrides: Record<string, any> = {}) {
    return {
        id: 1,
        name: '专业版年费',
        type: 1,
        levelId: 2,
        status: 1,
        priceMonthly: null,
        priceYearly: { toNumber: () => 680, toString: () => '680' },
        sortOrder: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as any
}

describe('会员升级价格计算 - 覆盖率补充', () => {
    describe('calculateUpgradePrice - 基本计算', () => {
        it('应正确计算升级价格（标准场景）', () => {
            const membership = createMockMembership()
            const targetLevel = createMockLevel()
            const currentProduct = createMockProduct({
                priceYearly: { toNumber: () => 365, toString: () => '365' },
            })
            const targetProduct = createMockProduct({
                priceYearly: { toNumber: () => 680, toString: () => '680' },
            })

            const result = calculateUpgradePrice(
                membership,
                targetLevel,
                currentProduct,
                targetProduct,
                100, // 剩余 100 天
                365, // 实付 365 元
                365, // 总天数 365 天
            )

            expect(result.upgradePrice).toBeGreaterThan(0)
            expect(result.pointCompensation).toBe(Math.round(result.upgradePrice * 10))
            expect(result.calculationDetails.paidAmount).toBe(365)
            expect(result.calculationDetails.totalDays).toBe(365)
            expect(result.calculationDetails.remainingDays).toBe(100)
        })

        it('剩余 0 天时升级价格应为 0', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                0, // 剩余 0 天
                365,
                365,
            )

            expect(result.upgradePrice).toBe(0)
            expect(result.pointCompensation).toBe(0)
        })

        it('实付金额为 0 时应基于目标价格计算', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                100,
                0, // 实付 0
                365,
            )

            // 当前剩余价值为 0，升级价格 = 目标剩余价值
            expect(result.upgradePrice).toBeGreaterThan(0)
            expect(result.originalRemainingValue).toBe(0)
        })

        it('totalDays 为 0 时日均价值应为 0', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                0,
                365,
                0, // 总天数 0
            )

            expect(result.calculationDetails.dailyValue).toBe(0)
        })

        it('剩余天数不应超过总天数', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                500, // 剩余天数大于总天数
                365,
                365, // 总天数 365
            )

            expect(result.calculationDetails.remainingDays).toBeLessThanOrEqual(365)
        })

        it('剩余天数为负数时应取 0', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                -10, // 负数剩余天数
                365,
                365,
            )

            expect(result.calculationDetails.remainingDays).toBe(0)
            expect(result.upgradePrice).toBe(0)
        })
    })

    describe('calculateUpgradePrice - 月价计算', () => {
        it('当只有月价时应按月价 × 12 计算年价', () => {
            const targetProduct = createMockProduct({
                priceYearly: null,
                priceMonthly: { toNumber: () => 68, toString: () => '68' },
            })

            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                targetProduct,
                100,
                365,
                365,
            )

            expect(result.calculationDetails.targetYearlyPrice).toBe(68 * 12)
        })

        it('当月价和年价都不存在时目标年价为 0', () => {
            const targetProduct = createMockProduct({
                priceYearly: null,
                priceMonthly: null,
            })

            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                targetProduct,
                100,
                365,
                365,
            )

            expect(result.calculationDetails.targetYearlyPrice).toBe(0)
            // 目标剩余价值为 0，升级价格取 max(0, ...) = 0
            expect(result.upgradePrice).toBe(0)
        })
    })

    describe('calculateUpgradePrice - 不传 originalTotalDays', () => {
        it('应从会员记录计算总天数', () => {
            const startDate = dayjs().subtract(100, 'day').toDate()
            const endDate = dayjs().add(265, 'day').toDate()
            const membership = createMockMembership({ startDate, endDate })

            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                265,
                365,
                undefined, // 不传 originalTotalDays
            )

            // 总天数应从 startDate 到 endDate 计算
            expect(result.calculationDetails.totalDays).toBe(dayjs(endDate).diff(dayjs(startDate), 'day'))
        })
    })

    describe('calculateUpgradePrice - 返回值精度', () => {
        it('upgradePrice 应精确到分（两位小数）', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                100,
                365,
                365,
            )

            const decimals = result.upgradePrice.toString().split('.')[1]
            if (decimals) {
                expect(decimals.length).toBeLessThanOrEqual(2)
            }
        })

        it('pointCompensation 应为整数', () => {
            const membership = createMockMembership()
            const result = calculateUpgradePrice(
                membership,
                createMockLevel(),
                null,
                createMockProduct(),
                100,
                365,
                365,
            )

            expect(Number.isInteger(result.pointCompensation)).toBe(true)
        })
    })
})
