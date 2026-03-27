/**
 * usePointStatus 积分状态处理测试
 *
 * 测试积分记录可用性和生效状态判断方法
 *
 * **Feature: point-status-composable**
 * **Validates: 积分状态判断功能**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'

// 导入待测试的 composable
const { usePointStatus } = await import('~/composables/usePointStatus')
const { isAvailable, isNotEffective } = usePointStatus()

describe('usePointStatus 积分可用性测试', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })
    describe('isAvailable - 积分记录是否可用', () => {
        it('当前时间在有效期内时应返回 true', () => {
            const now = new Date()
            const record = {
                effectiveAt: new Date(now.getTime() - 86400000).toISOString(), // 昨天
                expiredAt: new Date(now.getTime() + 86400000).toISOString(), // 明天
            }

            expect(isAvailable(record)).toBe(true)
        })

        it('当前时间正好等于生效时间时应返回 false', () => {
            const now = new Date()
            const record = {
                effectiveAt: now.toISOString(), // 现在
                expiredAt: new Date(now.getTime() + 86400000).toISOString(), // 明天
            }

            // effectiveAt < now 条件不满足
            expect(isAvailable(record)).toBe(false)
        })

        it('当前时间正好等于过期时间时应返回 false', () => {
            const now = new Date()
            const record = {
                effectiveAt: new Date(now.getTime() - 86400000).toISOString(), // 昨天
                expiredAt: now.toISOString(), // 现在
            }

            // expiredAt > now 条件不满足
            expect(isAvailable(record)).toBe(false)
        })

        it('当前时间在生效时间之前时应返回 false', () => {
            const now = new Date()
            const record = {
                effectiveAt: new Date(now.getTime() + 86400000).toISOString(), // 明天
                expiredAt: new Date(now.getTime() + 172800000).toISOString(), // 后天
            }

            expect(isAvailable(record)).toBe(false)
        })

        it('当前时间在过期时间之后时应返回 false', () => {
            const now = new Date()
            const record = {
                effectiveAt: new Date(now.getTime() - 172800000).toISOString(), // 前天
                expiredAt: new Date(now.getTime() - 86400000).toISOString(), // 昨天
            }

            expect(isAvailable(record)).toBe(false)
        })

        it('无效的生效时间应返回 false', () => {
            const record = {
                effectiveAt: 'not-a-date',
                expiredAt: new Date(Date.now() + 86400000).toISOString(),
            }

            expect(isAvailable(record)).toBe(false)
        })

        it('无效的过期时间应返回 false', () => {
            const record = {
                effectiveAt: new Date(Date.now() - 86400000).toISOString(),
                expiredAt: 'not-a-date',
            }

            expect(isAvailable(record)).toBe(false)
        })

        it('属性测试：有效期内的积分记录应返回 true', () => {
            const now = new Date('2025-06-15T12:00:00.000Z')
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2020-01-01'), max: now }).filter(d => d < now),
                    fc.date({ min: now, max: new Date('2030-01-01') }).filter(d => d > now),
                    (effectiveAt, expiredAt) => {
                        const record = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }
                        expect(isAvailable(record)).toBe(true)
                        return true
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })
})

describe('usePointStatus 积分未生效测试', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('isNotEffective - 积分记录是否未生效', () => {
        it('生效时间在当前时间之后时应返回 true', () => {
            const now = new Date()
            const record = {
                effectiveAt: new Date(now.getTime() + 86400000).toISOString(), // 明天
                expiredAt: new Date(now.getTime() + 172800000).toISOString(), // 后天
            }

            expect(isNotEffective(record)).toBe(true)
        })

        it('生效时间在当前时间之前时应返回 false', () => {
            const now = new Date()
            const record = {
                effectiveAt: new Date(now.getTime() - 86400000).toISOString(), // 昨天
                expiredAt: new Date(now.getTime() + 86400000).toISOString(), // 明天
            }

            expect(isNotEffective(record)).toBe(false)
        })

        it('当前时间正好等于生效时间时应返回 false', () => {
            const now = new Date()
            const record = {
                effectiveAt: now.toISOString(), // 现在
                expiredAt: new Date(now.getTime() + 86400000).toISOString(), // 明天
            }

            expect(isNotEffective(record)).toBe(false)
        })

        it('无效的生效时间应返回 false', () => {
            const record = {
                effectiveAt: 'not-a-date',
                expiredAt: new Date(Date.now() + 86400000).toISOString(),
            }

            expect(isNotEffective(record)).toBe(false)
        })

        it('属性测试：未来生效的积分记录应返回 true', () => {
            const now = new Date('2025-06-15T12:00:00.000Z')
            fc.assert(
                fc.property(
                    fc.date({ min: now, max: new Date('2030-01-01') }).filter(d => d > now),
                    fc.date({ min: new Date('2030-01-01'), max: new Date('2040-01-01') }),
                    (effectiveAt, expiredAt) => {
                        if (effectiveAt >= expiredAt) return true
                        const record = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }
                        expect(isNotEffective(record)).toBe(true)
                        return true
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })

        it('属性测试：过去生效的积分记录应返回 false', () => {
            const now = new Date('2025-06-15T12:00:00.000Z')
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2020-01-01'), max: now }).filter(d => d < now),
                    fc.date({ min: now, max: new Date('2030-01-01') }),
                    (effectiveAt, expiredAt) => {
                        if (effectiveAt >= expiredAt) return true
                        const record = {
                            effectiveAt: effectiveAt.toISOString(),
                            expiredAt: expiredAt.toISOString(),
                        }
                        expect(isNotEffective(record)).toBe(false)
                        return true
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })
})

describe('usePointStatus 边界情况测试', () => {
    it('长有效期应正确判断', () => {
        const now = new Date()
        const record = {
            effectiveAt: new Date(now.getTime() - 365 * 86400000).toISOString(), // 1年前
            expiredAt: new Date(now.getTime() + 365 * 86400000).toISOString(), // 1年后
        }

        expect(isAvailable(record)).toBe(true)
        expect(isNotEffective(record)).toBe(false)
    })

    it('短有效期应正确判断', () => {
        const now = new Date()
        const record = {
            effectiveAt: new Date(now.getTime() - 1000).toISOString(), // 1秒前
            expiredAt: new Date(now.getTime() + 1000).toISOString(), // 1秒后
        }

        expect(isAvailable(record)).toBe(true)
        expect(isNotEffective(record)).toBe(false)
    })
})
