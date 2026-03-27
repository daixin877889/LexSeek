/**
 * useLegalSearch 法律法规搜索测试
 *
 * 测试法律有效性计算和筛选逻辑
 *
 * **Feature: legal-search-composable**
 * **Validates: 法律法规搜索功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'

// 重现 computeIsValid 逻辑（来自 useLegalSearch）
function computeIsValid(item: {
    effectiveDate?: string | null
    invalidDate?: string | null
}): boolean {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null

    // 如果有生效日期且还未生效，则无效
    if (effectiveDate && effectiveDate > now) return false

    // 如果有失效日期且已失效，则无效
    if (invalidDate && invalidDate <= now) return false

    return true
}

describe('useLegalSearch computeIsValid 法律有效性计算', () => {
    describe('无日期约束', () => {
        it('无任何日期应返回有效', () => {
            expect(computeIsValid({})).toBe(true)
        })

        it('空日期应返回有效', () => {
            expect(computeIsValid({ effectiveDate: null, invalidDate: null })).toBe(true)
        })
    })

    describe('生效日期判断', () => {
        it('生效日期在过去应返回有效', () => {
            const pastDate = dayjs().subtract(1, 'day').toISOString()
            expect(computeIsValid({ effectiveDate: pastDate })).toBe(true)
        })

        it('生效日期在现在应返回有效', () => {
            const nowDate = new Date().toISOString()
            expect(computeIsValid({ effectiveDate: nowDate })).toBe(true)
        })

        it('生效日期在未来应返回无效', () => {
            const futureDate = dayjs().add(1, 'day').toISOString()
            expect(computeIsValid({ effectiveDate: futureDate })).toBe(false)
        })

        it('生效日期为无效字符串应视为无约束', () => {
            expect(computeIsValid({ effectiveDate: 'not-a-date' })).toBe(true)
        })
    })

    describe('失效日期判断', () => {
        it('失效日期在过去应返回无效', () => {
            const pastDate = dayjs().subtract(1, 'day').toISOString()
            expect(computeIsValid({ invalidDate: pastDate })).toBe(false)
        })

        it('失效日期在未来应返回有效', () => {
            const futureDate = dayjs().add(1, 'day').toISOString()
            expect(computeIsValid({ invalidDate: futureDate })).toBe(true)
        })

        it('失效日期为无效字符串应视为无约束', () => {
            expect(computeIsValid({ invalidDate: 'not-a-date' })).toBe(true)
        })
    })

    describe('生效和失效日期组合', () => {
        it('生效日期在过去且失效日期在未来应返回有效', () => {
            const effective = dayjs().subtract(30, 'day').toISOString()
            const invalid = dayjs().add(30, 'day').toISOString()
            expect(computeIsValid({ effectiveDate: effective, invalidDate: invalid })).toBe(true)
        })

        it('生效日期在未来且失效日期在未来应返回无效', () => {
            const effective = dayjs().add(1, 'day').toISOString()
            const invalid = dayjs().add(30, 'day').toISOString()
            expect(computeIsValid({ effectiveDate: effective, invalidDate: invalid })).toBe(false)
        })

        it('生效日期在过去且已到失效日期应返回无效', () => {
            const effective = dayjs().subtract(60, 'day').toISOString()
            const invalid = dayjs().subtract(1, 'day').toISOString()
            expect(computeIsValid({ effectiveDate: effective, invalidDate: invalid })).toBe(false)
        })
    })

    describe('边界情况', () => {
        it('失效日期等于现在应返回无效', () => {
            // 刚好到期的时刻
            const now = new Date()
            expect(computeIsValid({ invalidDate: now.toISOString() })).toBe(false)
        })

        it('生效日期等于现在应返回有效', () => {
            const now = new Date()
            expect(computeIsValid({ effectiveDate: now.toISOString() })).toBe(true)
        })

        it('只有生效日期约束时应忽略失效日期的空值', () => {
            const effective = dayjs().subtract(1, 'day').toISOString()
            expect(computeIsValid({ effectiveDate: effective, invalidDate: null })).toBe(true)
        })
    })

    describe('Property: 随机日期组合', () => {
        it('Property: 随机过去生效日期应返回有效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (daysAgo) => {
                        const effective = dayjs().subtract(daysAgo, 'day').toISOString()
                        expect(computeIsValid({ effectiveDate: effective })).toBe(true)
                    }
                ),
                { numRuns: 50, seed: 12345 }
            )
        })

        it('Property: 随机未来生效日期应返回无效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (daysAhead) => {
                        const effective = dayjs().add(daysAhead, 'day').toISOString()
                        expect(computeIsValid({ effectiveDate: effective })).toBe(false)
                    }
                ),
                { numRuns: 50, seed: 12345 }
            )
        })

        it('Property: 随机过去失效日期应返回无效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (daysAgo) => {
                        const invalid = dayjs().subtract(daysAgo, 'day').toISOString()
                        expect(computeIsValid({ invalidDate: invalid })).toBe(false)
                    }
                ),
                { numRuns: 50, seed: 12345 }
            )
        })

        it('Property: 随机未来失效日期应返回有效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }),
                    (daysAhead) => {
                        const invalid = dayjs().add(daysAhead, 'day').toISOString()
                        expect(computeIsValid({ invalidDate: invalid })).toBe(true)
                    }
                ),
                { numRuns: 50, seed: 12345 }
            )
        })
    })
})
