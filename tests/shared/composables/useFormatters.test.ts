/**
 * useFormatters Composable 属性测试
 *
 * 使用 fast-check 进行属性测试，验证格式化方法的正确性
 *
 * **Feature: formatters**
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import { useFormatters } from '../../../app/composables/useFormatters'

describe('useFormatters', () => {
    const { formatDate, formatDateOnly, formatDateChinese, formatAmount } = useFormatters()

    describe('formatDate - 标准日期格式化', () => {
        it('Property 1.1: 有效日期应返回 YYYY-MM-DD HH:mm 格式', () => {
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
                        .filter(d => !isNaN(d.getTime())),
                    (date) => {
                        const result = formatDate(date.toISOString())
                        // 验证格式：YYYY-MM-DD HH:mm
                        expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
                        // 验证内容正确
                        expect(result).toBe(dayjs(date).format('YYYY-MM-DD HH:mm'))
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空值应返回 —', () => {
            expect(formatDate(null)).toBe('—')
            expect(formatDate(undefined)).toBe('—')
            expect(formatDate('')).toBe('—')
        })

        it('无效日期应返回 —', () => {
            expect(formatDate('invalid-date')).toBe('—')
            expect(formatDate('not a date')).toBe('—')
        })
    })

    describe('formatDateOnly - 简短日期格式化', () => {
        it('Property 1.2: 有效日期应返回 YY/MM/DD 格式', () => {
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
                        .filter(d => !isNaN(d.getTime())),
                    (date) => {
                        const result = formatDateOnly(date.toISOString())
                        // 验证格式：YY/MM/DD
                        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/)
                        // 验证内容正确
                        expect(result).toBe(dayjs(date).format('YY/MM/DD'))
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空值应返回 —', () => {
            expect(formatDateOnly(null)).toBe('—')
            expect(formatDateOnly(undefined)).toBe('—')
            expect(formatDateOnly('')).toBe('—')
        })
    })

    describe('formatDateChinese - 中文日期格式化', () => {
        it('Property 1.3: 有效日期应返回 YYYY年MM月DD日 HH:mm 格式', () => {
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
                        .filter(d => !isNaN(d.getTime())),
                    (date) => {
                        const result = formatDateChinese(date.toISOString())
                        // 验证格式：YYYY年MM月DD日 HH:mm
                        expect(result).toMatch(/^\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$/)
                        // 验证内容正确
                        expect(result).toBe(dayjs(date).format('YYYY年MM月DD日 HH:mm'))
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空值应返回 —', () => {
            expect(formatDateChinese(null)).toBe('—')
            expect(formatDateChinese(undefined)).toBe('—')
            expect(formatDateChinese('')).toBe('—')
        })
    })

    describe('formatAmount - 金额格式化', () => {
        it('Property 2: 任意数字应返回两位小数字符串', () => {
            fc.assert(
                fc.property(
                    fc.double({ min: -1000000, max: 1000000, noNaN: true }),
                    (amount) => {
                        const result = formatAmount(amount)
                        // 验证格式：数字带两位小数
                        expect(result).toMatch(/^-?\d+\.\d{2}$/)
                        // 验证精度
                        expect(parseFloat(result)).toBeCloseTo(amount, 2)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('空值应返回 0.00', () => {
            expect(formatAmount(null)).toBe('0.00')
            expect(formatAmount(undefined)).toBe('0.00')
        })

        it('NaN 应返回 0.00', () => {
            expect(formatAmount(NaN)).toBe('0.00')
        })

        it('整数应返回两位小数', () => {
            expect(formatAmount(100)).toBe('100.00')
            expect(formatAmount(0)).toBe('0.00')
            expect(formatAmount(-50)).toBe('-50.00')
        })
    })
})
