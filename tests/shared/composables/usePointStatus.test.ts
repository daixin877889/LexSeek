/**
 * usePointStatus Composable 属性测试
 *
 * 使用 fast-check 进行属性测试，验证积分状态处理方法的正确性
 *
 * **Feature: point-status**
 * **Validates: Requirements 5.2, 5.3**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { usePointStatus, type PointRecord } from '../../../app/composables/usePointStatus'

describe('usePointStatus', () => {
    const { isAvailable, isNotEffective } = usePointStatus()

    describe('isAvailable - 积分可用性判断', () => {
        it('Property 7: 当前时间在 effectiveAt 和 expiredAt 之间时应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: -365, max: -1 }), // effectiveAt 相对于今天的天数偏移（过去）
                    fc.integer({ min: 1, max: 365 }),   // expiredAt 相对于今天的天数偏移（未来）
                    (effectiveDaysOffset, expiredDaysOffset) => {
                        const now = new Date()
                        const effectiveAt = new Date(now.getTime() + effectiveDaysOffset * 24 * 60 * 60 * 1000)
                        const expiredAt = new Date(now.getTime() + expiredDaysOffset * 24 * 60 * 60 * 1000)

                        const record: PointRecord = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }

                        // effectiveAt 在过去，expiredAt 在未来，应该可用
                        expect(isAvailable(record)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('effectiveAt 在未来时应返回 false', () => {
            const now = new Date()
            const effectiveAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7天后
            const expiredAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // 30天后

            const record: PointRecord = {
                effectiveAt: effectiveAt.toISOString(),
                expiredAt: expiredAt.toISOString(),
            }

            expect(isAvailable(record)).toBe(false)
        })

        it('expiredAt 在过去时应返回 false', () => {
            const now = new Date()
            const effectiveAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30天前
            const expiredAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)    // 7天前

            const record: PointRecord = {
                effectiveAt: effectiveAt.toISOString(),
                expiredAt: expiredAt.toISOString(),
            }

            expect(isAvailable(record)).toBe(false)
        })

        it('无效日期应返回 false', () => {
            const record: PointRecord = {
                effectiveAt: 'invalid-date',
                expiredAt: 'invalid-date',
            }

            expect(isAvailable(record)).toBe(false)
        })
    })

    describe('isNotEffective - 积分未生效判断', () => {
        it('Property 8: effectiveAt 在未来时应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }), // effectiveAt 相对于今天的天数偏移（未来）
                    (daysOffset) => {
                        const now = new Date()
                        const effectiveAt = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000)
                        const expiredAt = new Date(now.getTime() + (daysOffset + 30) * 24 * 60 * 60 * 1000)

                        const record: PointRecord = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }

                        // effectiveAt 在未来，应该未生效
                        expect(isNotEffective(record)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('effectiveAt 在过去时应返回 false', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: -365, max: -1 }), // effectiveAt 相对于今天的天数偏移（过去）
                    (daysOffset) => {
                        const now = new Date()
                        const effectiveAt = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000)
                        const expiredAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

                        const record: PointRecord = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }

                        // effectiveAt 在过去，应该已生效
                        expect(isNotEffective(record)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('无效日期应返回 false', () => {
            const record: PointRecord = {
                effectiveAt: 'invalid-date',
                expiredAt: 'invalid-date',
            }

            expect(isNotEffective(record)).toBe(false)
        })
    })

    describe('isAvailable 和 isNotEffective 的互斥性', () => {
        it('未生效的记录不应该可用', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 365 }), // effectiveAt 在未来
                    (daysOffset) => {
                        const now = new Date()
                        const effectiveAt = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000)
                        const expiredAt = new Date(now.getTime() + (daysOffset + 30) * 24 * 60 * 60 * 1000)

                        const record: PointRecord = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }

                        // 如果未生效，则不应该可用
                        if (isNotEffective(record)) {
                            expect(isAvailable(record)).toBe(false)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('可用的记录不应该未生效', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: -365, max: -1 }), // effectiveAt 在过去
                    fc.integer({ min: 1, max: 365 }),   // expiredAt 在未来
                    (effectiveDaysOffset, expiredDaysOffset) => {
                        const now = new Date()
                        const effectiveAt = new Date(now.getTime() + effectiveDaysOffset * 24 * 60 * 60 * 1000)
                        const expiredAt = new Date(now.getTime() + expiredDaysOffset * 24 * 60 * 60 * 1000)

                        const record: PointRecord = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }

                        // 如果可用，则不应该未生效
                        if (isAvailable(record)) {
                            expect(isNotEffective(record)).toBe(false)
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
