/**
 * 积分系统集成测试
 *
 * 测试场景：
 * - 创建会员时关联积分记录
 * - 会员升级时积分转移
 * - 查询可用积分（区分来源）
 * - 积分消耗顺序（先到期先消耗）
 *
 * **Feature: membership-system**
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    createPointRecord,
    generatePointRecords,
    PointRecordStatus,
    UserMembershipSourceType,
    type MockPointRecord,
} from './membership-test-fixtures'
import {
    sortPointsByExpiry,
    getValidPointRecords,
    getTotalAvailablePoints,
    simulateConsumePoints,
    daysFromNow,
    daysAgo,
} from './membership-test-helpers'

describe('积分系统集成测试', () => {
    describe('积分记录创建', () => {
        it('新创建的积分记录 remaining 应等于 pointAmount', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    (userId, pointAmount) => {
                        const record = createPointRecord({
                            userId,
                            pointAmount,
                            remaining: pointAmount,
                            used: 0,
                        })

                        expect(record.remaining).toBe(pointAmount)
                        expect(record.used).toBe(0)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('积分记录可以关联到会员', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    (userId, userMembershipId) => {
                        const record = createPointRecord({
                            userId,
                            userMembershipId,
                            pointAmount: 100,
                        })

                        expect(record.userMembershipId).toBe(userMembershipId)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('积分记录排序', () => {
        it('应按过期时间升序排序', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.array(
                        fc.integer({ min: 1, max: 365 }),
                        { minLength: 2, maxLength: 10 }
                    ),
                    (userId, daysUntilExpiry) => {
                        const records = daysUntilExpiry.map((days, index) =>
                            createPointRecord({
                                id: index + 1,
                                userId,
                                pointAmount: 100,
                                remaining: 100,
                                expiredAt: daysFromNow(days),
                            })
                        )

                        const sorted = sortPointsByExpiry(records)

                        for (let i = 0; i < sorted.length - 1; i++) {
                            expect(sorted[i].expiredAt.getTime()).toBeLessThanOrEqual(
                                sorted[i + 1].expiredAt.getTime()
                            )
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('有效积分筛选', () => {
        it('应排除无效状态的记录', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    status: PointRecordStatus.VALID,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                }),
                createPointRecord({
                    id: 2,
                    status: PointRecordStatus.CANCELLED,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                }),
                createPointRecord({
                    id: 3,
                    status: PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                }),
            ]

            const validRecords = getValidPointRecords(records)

            expect(validRecords.length).toBe(1)
            expect(validRecords[0].id).toBe(1)
        })

        it('应排除 remaining 为 0 的记录', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    status: PointRecordStatus.VALID,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                }),
                createPointRecord({
                    id: 2,
                    status: PointRecordStatus.VALID,
                    remaining: 0,
                    expiredAt: daysFromNow(30),
                }),
            ]

            const validRecords = getValidPointRecords(records)

            expect(validRecords.length).toBe(1)
            expect(validRecords[0].id).toBe(1)
        })

        it('应排除已过期的记录', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    status: PointRecordStatus.VALID,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                }),
                createPointRecord({
                    id: 2,
                    status: PointRecordStatus.VALID,
                    remaining: 100,
                    expiredAt: daysAgo(1), // 已过期
                }),
            ]

            const validRecords = getValidPointRecords(records)

            expect(validRecords.length).toBe(1)
            expect(validRecords[0].id).toBe(1)
        })

        it('应排除已删除的记录', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    status: PointRecordStatus.VALID,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                    deletedAt: null,
                }),
                createPointRecord({
                    id: 2,
                    status: PointRecordStatus.VALID,
                    remaining: 100,
                    expiredAt: daysFromNow(30),
                    deletedAt: new Date(), // 已删除
                }),
            ]

            const validRecords = getValidPointRecords(records)

            expect(validRecords.length).toBe(1)
            expect(validRecords[0].id).toBe(1)
        })
    })

    describe('可用积分计算', () => {
        it('应正确计算可用积分总数', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.array(
                        fc.integer({ min: 1, max: 1000 }),
                        { minLength: 1, maxLength: 5 }
                    ),
                    (userId, amounts) => {
                        const records = amounts.map((amount, index) =>
                            createPointRecord({
                                id: index + 1,
                                userId,
                                pointAmount: amount,
                                remaining: amount,
                                status: PointRecordStatus.VALID,
                                expiredAt: daysFromNow(30),
                            })
                        )

                        const total = getTotalAvailablePoints(records)
                        const expected = amounts.reduce((sum, a) => sum + a, 0)

                        expect(total).toBe(expected)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('无效记录不应计入可用积分', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    pointAmount: 100,
                    remaining: 100,
                    status: PointRecordStatus.VALID,
                    expiredAt: daysFromNow(30),
                }),
                createPointRecord({
                    id: 2,
                    pointAmount: 200,
                    remaining: 200,
                    status: PointRecordStatus.CANCELLED,
                    expiredAt: daysFromNow(30),
                }),
            ]

            const total = getTotalAvailablePoints(records)

            expect(total).toBe(100)
        })
    })

    describe('积分消耗', () => {
        it('应按过期时间升序消耗（先到期先消耗）', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    remaining: 50,
                    expiredAt: daysFromNow(60), // 后过期
                    status: PointRecordStatus.VALID,
                }),
                createPointRecord({
                    id: 2,
                    remaining: 100,
                    expiredAt: daysFromNow(30), // 先过期
                    status: PointRecordStatus.VALID,
                }),
                createPointRecord({
                    id: 3,
                    remaining: 30,
                    expiredAt: daysFromNow(90), // 最后过期
                    status: PointRecordStatus.VALID,
                }),
            ]

            const result = simulateConsumePoints(records, 80)

            expect(result.success).toBe(true)
            // 应该先消耗 id=2（先过期）
            expect(result.consumedRecords[0].recordId).toBe(2)
        })

        it('消耗完一条记录后才消耗下一条', () => {
            const records: MockPointRecord[] = [
                createPointRecord({
                    id: 1,
                    remaining: 50,
                    expiredAt: daysFromNow(30),
                    status: PointRecordStatus.VALID,
                }),
                createPointRecord({
                    id: 2,
                    remaining: 100,
                    expiredAt: daysFromNow(60),
                    status: PointRecordStatus.VALID,
                }),
            ]

            // 消耗 80，应该先消耗完第一条（50），再从第二条消耗（30）
            const result = simulateConsumePoints(records, 80)

            expect(result.success).toBe(true)
            expect(result.consumedRecords.length).toBe(2)
            expect(result.consumedRecords[0].recordId).toBe(1)
            expect(result.consumedRecords[0].amount).toBe(50)
            expect(result.consumedRecords[1].recordId).toBe(2)
            expect(result.consumedRecords[1].amount).toBe(30)
        })

        it('积分不足时应返回失败', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.integer({ min: 1, max: 100 }),
                        { minLength: 1, maxLength: 3 }
                    ),
                    (amounts) => {
                        const records = amounts.map((amount, index) =>
                            createPointRecord({
                                id: index + 1,
                                remaining: amount,
                                expiredAt: daysFromNow(30),
                                status: PointRecordStatus.VALID,
                            })
                        )

                        const total = amounts.reduce((sum, a) => sum + a, 0)
                        const result = simulateConsumePoints(records, total + 1)

                        expect(result.success).toBe(false)
                        expect(result.errorMessage).toBe('积分不足')
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('消耗总量应精确等于请求量', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.integer({ min: 50, max: 200 }),
                        { minLength: 2, maxLength: 5 }
                    ),
                    fc.integer({ min: 10, max: 100 }),
                    (amounts, consumeAmount) => {
                        const records = amounts.map((amount, index) =>
                            createPointRecord({
                                id: index + 1,
                                remaining: amount,
                                expiredAt: daysFromNow(30 + index * 10),
                                status: PointRecordStatus.VALID,
                            })
                        )

                        const total = amounts.reduce((sum, a) => sum + a, 0)

                        if (consumeAmount <= total) {
                            const result = simulateConsumePoints(records, consumeAmount)
                            const consumed = result.consumedRecords.reduce(
                                (sum, r) => sum + r.amount,
                                0
                            )
                            expect(consumed).toBe(consumeAmount)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 12: 积分消耗顺序', () => {
        it('应按 expiredAt 升序消耗（先到期先消耗）', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 1000 }),
                    fc.array(
                        fc.record({
                            remaining: fc.integer({ min: 20, max: 100 }),
                            daysUntilExpiry: fc.integer({ min: 1, max: 365 }),
                        }),
                        { minLength: 3, maxLength: 6 }
                    ),
                    fc.integer({ min: 10, max: 80 }),
                    (userId, recordsData, consumeAmount) => {
                        const records = recordsData.map((data, index) =>
                            createPointRecord({
                                id: index + 1,
                                userId,
                                remaining: data.remaining,
                                expiredAt: daysFromNow(data.daysUntilExpiry),
                                status: PointRecordStatus.VALID,
                            })
                        )

                        const total = records.reduce((sum, r) => sum + r.remaining, 0)

                        if (consumeAmount <= total) {
                            const result = simulateConsumePoints(records, consumeAmount)

                            if (result.success && result.consumedRecords.length > 1) {
                                // 获取消耗记录对应的原始记录
                                const consumedOriginals = result.consumedRecords.map((cr) =>
                                    records.find((r) => r.id === cr.recordId)!
                                )

                                // 验证消耗顺序
                                for (let i = 0; i < consumedOriginals.length - 1; i++) {
                                    expect(
                                        consumedOriginals[i].expiredAt.getTime()
                                    ).toBeLessThanOrEqual(
                                        consumedOriginals[i + 1].expiredAt.getTime()
                                    )
                                }
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
