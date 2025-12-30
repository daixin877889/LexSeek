/**
 * useOrderStatus Composable 属性测试
 *
 * 使用 fast-check 进行属性测试，验证订单状态处理方法的正确性
 *
 * **Feature: order-status**
 * **Validates: Requirements 3.2, 3.3, 3.4**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { useOrderStatus } from '../../../app/composables/useOrderStatus'
import { OrderStatus, DurationUnit } from '../../../shared/types/payment'

describe('useOrderStatus', () => {
    const { getStatusText, getStatusClass, formatDuration } = useOrderStatus()

    describe('getStatusText - 订单状态文本', () => {
        it('Property 3.1: 所有 OrderStatus 枚举值应返回非空中文文本', () => {
            const allStatuses = [
                OrderStatus.PENDING,
                OrderStatus.PAID,
                OrderStatus.CANCELLED,
                OrderStatus.REFUNDED,
            ]

            allStatuses.forEach((status) => {
                const text = getStatusText(status)
                // 验证返回非空字符串
                expect(text).toBeTruthy()
                expect(typeof text).toBe('string')
                expect(text.length).toBeGreaterThan(0)
                // 验证不是 "未知"
                expect(text).not.toBe('未知')
            })
        })

        it('各状态应返回正确的中文文本', () => {
            expect(getStatusText(OrderStatus.PENDING)).toBe('待支付')
            expect(getStatusText(OrderStatus.PAID)).toBe('已支付')
            expect(getStatusText(OrderStatus.CANCELLED)).toBe('已取消')
            expect(getStatusText(OrderStatus.REFUNDED)).toBe('已退款')
        })

        it('未知状态应返回 "未知"', () => {
            expect(getStatusText(999 as OrderStatus)).toBe('未知')
        })
    })

    describe('getStatusClass - 订单状态样式', () => {
        it('Property 3.2: 所有 OrderStatus 枚举值应返回非空 CSS 类名', () => {
            const allStatuses = [
                OrderStatus.PENDING,
                OrderStatus.PAID,
                OrderStatus.CANCELLED,
                OrderStatus.REFUNDED,
            ]

            allStatuses.forEach((status) => {
                const className = getStatusClass(status)
                // 验证返回非空字符串
                expect(className).toBeTruthy()
                expect(typeof className).toBe('string')
                expect(className.length).toBeGreaterThan(0)
                // 验证包含 bg- 和 text- 类
                expect(className).toContain('bg-')
                expect(className).toContain('text-')
            })
        })

        it('各状态应返回正确的样式类', () => {
            expect(getStatusClass(OrderStatus.PENDING)).toContain('yellow')
            expect(getStatusClass(OrderStatus.PAID)).toContain('green')
            expect(getStatusClass(OrderStatus.CANCELLED)).toContain('gray')
            expect(getStatusClass(OrderStatus.REFUNDED)).toContain('blue')
        })

        it('未知状态应返回空字符串', () => {
            expect(getStatusClass(999 as OrderStatus)).toBe('')
        })
    })

    describe('formatDuration - 时长格式化', () => {
        it('Property 4: 正整数时长应返回包含数字和单位的中文描述', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    fc.constantFrom(DurationUnit.MONTH, DurationUnit.YEAR),
                    (duration, unit) => {
                        const result = formatDuration(duration, unit)
                        // 验证包含数字
                        expect(result).toContain(String(duration))
                        // 验证包含单位
                        if (unit === DurationUnit.MONTH) {
                            expect(result).toContain('个月')
                        } else if (unit === DurationUnit.YEAR) {
                            expect(result).toContain('年')
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('月份单位应返回 "X 个月"', () => {
            expect(formatDuration(1, DurationUnit.MONTH)).toBe('1 个月')
            expect(formatDuration(3, DurationUnit.MONTH)).toBe('3 个月')
            expect(formatDuration(12, DurationUnit.MONTH)).toBe('12 个月')
        })

        it('年份单位应返回 "X 年"', () => {
            expect(formatDuration(1, DurationUnit.YEAR)).toBe('1 年')
            expect(formatDuration(2, DurationUnit.YEAR)).toBe('2 年')
            expect(formatDuration(5, DurationUnit.YEAR)).toBe('5 年')
        })

        it('未知单位应只返回数字', () => {
            expect(formatDuration(10, 'unknown' as DurationUnit)).toBe('10')
        })
    })
})
