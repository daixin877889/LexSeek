/**
 * useOrderStatus 订单状态处理测试
 *
 * 测试订单状态文本、样式和时长格式化方法
 *
 * **Feature: order-status-composable**
 * **Validates: 订单状态显示功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 导入共享类型
const { OrderStatus, DurationUnit } = await import('#shared/types/payment')

// 导入待测试的 composable
const { useOrderStatus } = await import('~/composables/useOrderStatus')
const { getStatusText, getStatusClass, formatDuration } = useOrderStatus()

describe('useOrderStatus 订单状态文本测试', () => {
    describe('getStatusText - 状态文本映射', () => {
        it('应返回正确的待支付文本', () => {
            expect(getStatusText(OrderStatus.PENDING)).toBe('待支付')
        })

        it('应返回正确的已支付文本', () => {
            expect(getStatusText(OrderStatus.PAID)).toBe('已支付')
        })

        it('应返回正确的已取消文本', () => {
            expect(getStatusText(OrderStatus.CANCELLED)).toBe('已取消')
        })

        it('应返回正确的已退款文本', () => {
            expect(getStatusText(OrderStatus.REFUNDED)).toBe('已退款')
        })

        it('未知状态应返回"未知"', () => {
            // 测试一个不存在的状态值
            const unknownStatus = 999 as OrderStatus
            expect(getStatusText(unknownStatus)).toBe('未知')
        })

        it('属性测试：所有已知状态应返回非空文本', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        OrderStatus.PENDING,
                        OrderStatus.PAID,
                        OrderStatus.CANCELLED,
                        OrderStatus.REFUNDED
                    ),
                    (status) => {
                        const result = getStatusText(status)
                        expect(result).toBeTruthy()
                        expect(typeof result).toBe('string')
                        expect(result.length).toBeGreaterThan(0)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })
})

describe('useOrderStatus 订单状态样式测试', () => {
    describe('getStatusClass - 状态样式映射', () => {
        it('待支付应返回黄色样式', () => {
            expect(getStatusClass(OrderStatus.PENDING)).toContain('yellow')
        })

        it('已支付应返回绿色样式', () => {
            expect(getStatusClass(OrderStatus.PAID)).toContain('green')
        })

        it('已取消应返回灰色样式', () => {
            expect(getStatusClass(OrderStatus.CANCELLED)).toContain('gray')
        })

        it('已退款应返回蓝色样式', () => {
            expect(getStatusClass(OrderStatus.REFUNDED)).toContain('blue')
        })

        it('未知状态应返回空字符串', () => {
            const unknownStatus = 999 as OrderStatus
            expect(getStatusClass(unknownStatus)).toBe('')
        })

        it('样式类应包含必要的 Tailwind 类名', () => {
            expect(getStatusClass(OrderStatus.PENDING)).toMatch(/bg-yellow/)
            expect(getStatusClass(OrderStatus.PAID)).toMatch(/bg-green/)
            expect(getStatusClass(OrderStatus.CANCELLED)).toMatch(/bg-gray/)
            expect(getStatusClass(OrderStatus.REFUNDED)).toMatch(/bg-blue/)
        })
    })
})

describe('useOrderStatus 时长格式化测试', () => {
    describe('formatDuration - 时长格式化', () => {
        it('月单位应返回"X 个月"格式', () => {
            expect(formatDuration(1, DurationUnit.MONTH)).toBe('1 个月')
            expect(formatDuration(6, DurationUnit.MONTH)).toBe('6 个月')
            expect(formatDuration(12, DurationUnit.MONTH)).toBe('12 个月')
        })

        it('年单位应返回"X 年"格式', () => {
            expect(formatDuration(1, DurationUnit.YEAR)).toBe('1 年')
            expect(formatDuration(2, DurationUnit.YEAR)).toBe('2 年')
            expect(formatDuration(5, DurationUnit.YEAR)).toBe('5 年')
        })

        it('未知单位应返回原始数值', () => {
            // 测试一个不存在的单位值
            const unknownUnit = 999 as DurationUnit
            expect(formatDuration(3, unknownUnit)).toBe('3')
        })

        it('属性测试：月单位应返回正确的格式', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 120 }),
                    (duration) => {
                        const result = formatDuration(duration, DurationUnit.MONTH)
                        expect(result).toBe(`${duration} 个月`)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })

        it('属性测试：年单位应返回正确的格式', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    (duration) => {
                        const result = formatDuration(duration, DurationUnit.YEAR)
                        expect(result).toBe(`${duration} 年`)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })

        it('边界值测试', () => {
            expect(formatDuration(0, DurationUnit.MONTH)).toBe('0 个月')
            expect(formatDuration(0, DurationUnit.YEAR)).toBe('0 年')
            expect(formatDuration(999, DurationUnit.MONTH)).toBe('999 个月')
        })
    })
})

describe('useOrderStatus 边界情况测试', () => {
    it('零值时长应正确格式化', () => {
        expect(formatDuration(0, DurationUnit.MONTH)).toBe('0 个月')
        expect(formatDuration(0, DurationUnit.YEAR)).toBe('0 年')
    })

    it('大数值时长应正确格式化', () => {
        expect(formatDuration(999, DurationUnit.MONTH)).toBe('999 个月')
        expect(formatDuration(100, DurationUnit.YEAR)).toBe('100 年')
    })

    it('各状态返回的样式类应互不相同', () => {
        const pendingClass = getStatusClass(OrderStatus.PENDING)
        const paidClass = getStatusClass(OrderStatus.PAID)
        const cancelledClass = getStatusClass(OrderStatus.CANCELLED)
        const refundedClass = getStatusClass(OrderStatus.REFUNDED)

        // 各状态的样式应不同
        expect(new Set([pendingClass, paidClass, cancelledClass, refundedClass]).size).toBe(4)
    })
})
