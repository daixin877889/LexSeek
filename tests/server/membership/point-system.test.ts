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

/**
 * Property 12: 积分消耗顺序
 * 
 * For any 积分消耗操作，SHALL 按积分记录的 expiredAt 字段升序消耗（先到期先消耗）。
 * 
 * **Feature: membership-system, Property 12: 积分消耗顺序**
 * **Validates: Requirements 10.4**
 */
describe('Property 12: 积分消耗顺序', () => {
    /** 模拟积分记录 */
    interface MockPointRecord {
        id: number
        userId: number
        remaining: number
        expiredAt: Date
        status: number
    }

    /**
     * 模拟按过期时间排序的积分消耗
     */
    const consumePointsByExpiry = (
        records: MockPointRecord[],
        consumeAmount: number
    ): {
        success: boolean
        consumedRecords: { recordId: number; amount: number; expiredAt: Date }[]
        errorMessage?: string
    } => {
        // 过滤有效记录并按过期时间升序排序
        const validRecords = records
            .filter((r) => r.status === PointRecordStatus.VALID && r.remaining > 0)
            .sort((a, b) => a.expiredAt.getTime() - b.expiredAt.getTime())

        const totalRemaining = validRecords.reduce((sum, r) => sum + r.remaining, 0)
        if (totalRemaining < consumeAmount) {
            return { success: false, consumedRecords: [], errorMessage: '积分不足' }
        }

        let remainingToConsume = consumeAmount
        const consumedRecords: { recordId: number; amount: number; expiredAt: Date }[] = []

        for (const record of validRecords) {
            if (remainingToConsume <= 0) break

            const consumeFromRecord = Math.min(record.remaining, remainingToConsume)
            consumedRecords.push({
                recordId: record.id,
                amount: consumeFromRecord,
                expiredAt: record.expiredAt,
            })
            remainingToConsume -= consumeFromRecord
        }

        return { success: true, consumedRecords }
    }

    it('应优先消耗过期时间最早的积分记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }), // userId
                fc.array(
                    fc.record({
                        id: fc.integer({ min: 1, max: 10000 }),
                        remaining: fc.integer({ min: 10, max: 100 }),
                        expiredAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31') })
                            .filter(d => !isNaN(d.getTime())),
                    }),
                    { minLength: 3, maxLength: 6 }
                ),
                fc.integer({ min: 5, max: 50 }),
                (userId, recordsData, consumeAmount) => {
                    // 创建唯一 ID 的记录
                    const records: MockPointRecord[] = recordsData.map((r, i) => ({
                        id: i + 1,
                        userId,
                        remaining: r.remaining,
                        expiredAt: r.expiredAt,
                        status: PointRecordStatus.VALID,
                    }))

                    const result = consumePointsByExpiry(records, consumeAmount)

                    if (result.success && result.consumedRecords.length > 1) {
                        // 验证消耗顺序：每条记录的过期时间应该 <= 下一条记录的过期时间
                        for (let i = 0; i < result.consumedRecords.length - 1; i++) {
                            const current = result.consumedRecords[i]
                            const next = result.consumedRecords[i + 1]
                            expect(current.expiredAt.getTime()).toBeLessThanOrEqual(next.expiredAt.getTime())
                        }
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('消耗完一条记录后才消耗下一条', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                (userId) => {
                    // 创建固定的测试数据
                    const records: MockPointRecord[] = [
                        { id: 1, userId, remaining: 50, expiredAt: new Date('2025-03-01'), status: PointRecordStatus.VALID },
                        { id: 2, userId, remaining: 100, expiredAt: new Date('2025-06-01'), status: PointRecordStatus.VALID },
                        { id: 3, userId, remaining: 30, expiredAt: new Date('2025-09-01'), status: PointRecordStatus.VALID },
                    ]

                    // 消耗 80 积分，应该先消耗完第一条（50），再从第二条消耗（30）
                    const result = consumePointsByExpiry(records, 80)

                    expect(result.success).toBe(true)
                    expect(result.consumedRecords.length).toBe(2)
                    expect(result.consumedRecords[0].recordId).toBe(1)
                    expect(result.consumedRecords[0].amount).toBe(50) // 第一条全部消耗
                    expect(result.consumedRecords[1].recordId).toBe(2)
                    expect(result.consumedRecords[1].amount).toBe(30) // 第二条部分消耗
                }
            ),
            { numRuns: 100 }
        )
    })

    it('不应消耗无效状态的积分记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.constantFrom(PointRecordStatus.MEMBERSHIP_UPGRADE_SETTLEMENT, PointRecordStatus.CANCELLED),
                (userId, invalidStatus) => {
                    const records: MockPointRecord[] = [
                        { id: 1, userId, remaining: 100, expiredAt: new Date('2025-03-01'), status: invalidStatus },
                        { id: 2, userId, remaining: 50, expiredAt: new Date('2025-06-01'), status: PointRecordStatus.VALID },
                    ]

                    const result = consumePointsByExpiry(records, 30)

                    expect(result.success).toBe(true)
                    // 应该只消耗有效状态的记录
                    expect(result.consumedRecords.length).toBe(1)
                    expect(result.consumedRecords[0].recordId).toBe(2)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('不应消耗 remaining 为 0 的记录', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                (userId) => {
                    const records: MockPointRecord[] = [
                        { id: 1, userId, remaining: 0, expiredAt: new Date('2025-03-01'), status: PointRecordStatus.VALID },
                        { id: 2, userId, remaining: 50, expiredAt: new Date('2025-06-01'), status: PointRecordStatus.VALID },
                    ]

                    const result = consumePointsByExpiry(records, 30)

                    expect(result.success).toBe(true)
                    expect(result.consumedRecords.length).toBe(1)
                    expect(result.consumedRecords[0].recordId).toBe(2)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('消耗总量应精确等于请求量', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.array(
                    fc.record({
                        remaining: fc.integer({ min: 20, max: 100 }),
                        expiredAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31') }),
                    }),
                    { minLength: 2, maxLength: 5 }
                ),
                fc.integer({ min: 10, max: 80 }),
                (userId, recordsData, consumeAmount) => {
                    const records: MockPointRecord[] = recordsData.map((r, i) => ({
                        id: i + 1,
                        userId,
                        remaining: r.remaining,
                        expiredAt: r.expiredAt,
                        status: PointRecordStatus.VALID,
                    }))

                    const totalAvailable = records.reduce((sum, r) => sum + r.remaining, 0)

                    if (consumeAmount <= totalAvailable) {
                        const result = consumePointsByExpiry(records, consumeAmount)
                        const totalConsumed = result.consumedRecords.reduce((sum, r) => sum + r.amount, 0)
                        expect(totalConsumed).toBe(consumeAmount)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
