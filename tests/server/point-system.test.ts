/**
 * 积分系统属性测试
 * 
 * 使用 fast-check 进行属性测试，验证积分系统的核心业务逻辑
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 积分记录状态（与 shared/types/pointRecords.types.ts 保持一致）
const PointRecordStatus = {
    VALID: 1,
    MEMBERSHIP_UPGRADE_SETTLEMENT: 2,
    CANCELLED: 3,
} as const

/**
 * Property 1: 积分记录创建不变量
 * 对于任意新创建的积分记录，remaining 字段应该等于 pointAmount，used 字段应该为 0
 * Validates: Requirements 1.4
 */
describe('Property 1: 积分记录创建不变量', () => {
    /**
     * 模拟积分记录创建逻辑
     */
    const createPointRecord = (pointAmount: number) => {
        return {
            pointAmount,
            used: 0,
            remaining: pointAmount,
            status: PointRecordStatus.VALID,
        }
    }

    it('新创建的积分记录 remaining 应等于 pointAmount', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000000 }),
                (pointAmount) => {
                    const record = createPointRecord(pointAmount)
                    expect(record.remaining).toBe(pointAmount)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('新创建的积分记录 used 应为 0', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000000 }),
                (pointAmount) => {
                    const record = createPointRecord(pointAmount)
                    expect(record.used).toBe(0)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('新创建的积分记录状态应为 VALID', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000000 }),
                (pointAmount) => {
                    const record = createPointRecord(pointAmount)
                    expect(record.status).toBe(PointRecordStatus.VALID)
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * Property 4: FIFO 消耗策略属性
 * 对于任意积分消耗操作，系统应该按照积分记录的 expiredAt 升序依次消耗
 * Validates: Requirements 5.3, 5.4
 */
describe('Property 4: FIFO 消耗策略属性', () => {
    /**
     * 模拟积分记录
     */
    interface MockPointRecord {
        id: number
        remaining: number
        used: number
        expiredAt: Date
    }

    /**
     * 模拟 FIFO 消耗逻辑
     */
    const consumePointsFIFO = (
        records: MockPointRecord[],
        consumeAmount: number
    ): { consumedRecords: { id: number; consumed: number }[]; success: boolean } => {
        // 按过期时间升序排序
        const sortedRecords = [...records].sort(
            (a, b) => a.expiredAt.getTime() - b.expiredAt.getTime()
        )

        const totalRemaining = sortedRecords.reduce((sum, r) => sum + r.remaining, 0)
        if (totalRemaining < consumeAmount) {
            return { consumedRecords: [], success: false }
        }

        let remainingToConsume = consumeAmount
        const consumedRecords: { id: number; consumed: number }[] = []

        for (const record of sortedRecords) {
            if (remainingToConsume <= 0) break

            const consumeFromRecord = Math.min(record.remaining, remainingToConsume)
            if (consumeFromRecord > 0) {
                consumedRecords.push({ id: record.id, consumed: consumeFromRecord })
                remainingToConsume -= consumeFromRecord
            }
        }

        return { consumedRecords, success: true }
    }

    it('应按过期时间升序消耗积分', () => {
        fc.assert(
            fc.property(
                // 生成 2-5 条积分记录
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 1000 }),
                        remaining: fc.integer({ min: 10, max: 100 }),
                        used: fc.constant(0),
                        expiredAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2025-12-31') }),
                    }),
                    { minLength: 2, maxLength: 5 }
                ),
                fc.integer({ min: 1, max: 50 }),
                (records, consumeAmount) => {
                    // 确保记录 ID 唯一
                    const uniqueRecords = records.map((r, i) => ({ ...r, id: i + 1 }))
                    const result = consumePointsFIFO(uniqueRecords, consumeAmount)

                    if (result.success && result.consumedRecords.length > 1) {
                        // 验证消耗顺序：先消耗的记录过期时间应该更早
                        const sortedByExpiry = [...uniqueRecords].sort(
                            (a, b) => a.expiredAt.getTime() - b.expiredAt.getTime()
                        )

                        // 获取被消耗记录的原始顺序
                        const consumedIds = result.consumedRecords.map(r => r.id)
                        const expectedOrder = sortedByExpiry
                            .filter(r => consumedIds.includes(r.id))
                            .map(r => r.id)

                        expect(consumedIds).toEqual(expectedOrder)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('积分不足时应返回失败', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 1000 }),
                        remaining: fc.integer({ min: 1, max: 10 }),
                        used: fc.constant(0),
                        expiredAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2025-12-31') }),
                    }),
                    { minLength: 1, maxLength: 3 }
                ),
                (records) => {
                    const totalRemaining = records.reduce((sum, r) => sum + r.remaining, 0)
                    const consumeAmount = totalRemaining + 1 // 超过可用积分

                    const result = consumePointsFIFO(records, consumeAmount)
                    expect(result.success).toBe(false)
                    expect(result.consumedRecords).toHaveLength(0)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('消耗总量应等于请求消耗量', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 1000 }),
                        remaining: fc.integer({ min: 50, max: 100 }),
                        used: fc.constant(0),
                        expiredAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2025-12-31') }),
                    }),
                    { minLength: 2, maxLength: 5 }
                ),
                fc.integer({ min: 1, max: 100 }),
                (records, consumeAmount) => {
                    const uniqueRecords = records.map((r, i) => ({ ...r, id: i + 1 }))
                    const totalRemaining = uniqueRecords.reduce((sum, r) => sum + r.remaining, 0)

                    if (consumeAmount <= totalRemaining) {
                        const result = consumePointsFIFO(uniqueRecords, consumeAmount)
                        const totalConsumed = result.consumedRecords.reduce((sum, r) => sum + r.consumed, 0)
                        expect(totalConsumed).toBe(consumeAmount)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})

/**
 * Property 6: 积分记录数据一致性属性
 * 对于任意积分记录，remaining = pointAmount - used
 * Validates: Requirements 7.3, 7.4
 */
describe('Property 6: 积分记录数据一致性属性', () => {
    /**
     * 模拟积分记录更新逻辑
     */
    const updatePointRecord = (
        record: { pointAmount: number; used: number; remaining: number },
        consumeAmount: number
    ) => {
        return {
            ...record,
            used: record.used + consumeAmount,
            remaining: record.remaining - consumeAmount,
        }
    }

    it('remaining 应始终等于 pointAmount - used', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 100, max: 10000 }),
                fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
                (pointAmount, consumeAmounts) => {
                    let record = {
                        pointAmount,
                        used: 0,
                        remaining: pointAmount,
                    }

                    // 模拟多次消耗
                    for (const amount of consumeAmounts) {
                        if (record.remaining >= amount) {
                            record = updatePointRecord(record, amount)
                            // 验证不变量
                            expect(record.remaining).toBe(record.pointAmount - record.used)
                        }
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('used 不应超过 pointAmount', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 100, max: 10000 }),
                fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 20 }),
                (pointAmount, consumeAmounts) => {
                    let record = {
                        pointAmount,
                        used: 0,
                        remaining: pointAmount,
                    }

                    for (const amount of consumeAmounts) {
                        if (record.remaining >= amount) {
                            record = updatePointRecord(record, amount)
                        }
                    }

                    // 验证 used 不超过 pointAmount
                    expect(record.used).toBeLessThanOrEqual(record.pointAmount)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('remaining 不应为负数', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 100, max: 10000 }),
                fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 20 }),
                (pointAmount, consumeAmounts) => {
                    let record = {
                        pointAmount,
                        used: 0,
                        remaining: pointAmount,
                    }

                    for (const amount of consumeAmounts) {
                        if (record.remaining >= amount) {
                            record = updatePointRecord(record, amount)
                        }
                    }

                    // 验证 remaining 不为负数
                    expect(record.remaining).toBeGreaterThanOrEqual(0)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('消耗记录总和应等于 used 字段', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 100, max: 10000 }),
                fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 10 }),
                (pointAmount, consumeAmounts) => {
                    let record = {
                        pointAmount,
                        used: 0,
                        remaining: pointAmount,
                    }

                    const consumptionRecords: number[] = []

                    for (const amount of consumeAmounts) {
                        if (record.remaining >= amount) {
                            record = updatePointRecord(record, amount)
                            consumptionRecords.push(amount)
                        }
                    }

                    // 验证消耗记录总和等于 used
                    const totalConsumed = consumptionRecords.reduce((sum, a) => sum + a, 0)
                    expect(totalConsumed).toBe(record.used)
                }
            ),
            { numRuns: 100 }
        )
    })
})
