/**
 * useFormatters 通用格式化工具测试
 *
 * 测试日期、金额等格式化方法
 *
 * **Feature: formatters-composable**
 * **Validates: 通用格式化工具**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

// 配置 dayjs
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

// 导入待测试的格式化函数
const { useFormatters } = await import('~/composables/useFormatters')
const { formatDate, formatDateOnly, formatDateChinese, formatDateRelative, formatAmount, formatNumber } = useFormatters()

describe('useFormatters 日期格式化测试', () => {
    describe('formatDate - 标准格式', () => {
        it('应正确格式化有效的日期字符串', () => {
            expect(formatDate('2024-01-15 10:30:00')).toBe('2024-01-15 10:30')
            expect(formatDate('2024-12-25 23:59:59')).toBe('2024-12-25 23:59')
        })

        it('null 应返回默认占位符', () => {
            expect(formatDate(null)).toBe('—')
        })

        it('undefined 应返回默认占位符', () => {
            expect(formatDate(undefined)).toBe('—')
        })

        it('空字符串应返回默认占位符', () => {
            expect(formatDate('')).toBe('—')
        })

        it('无效日期应返回默认占位符', () => {
            expect(formatDate('invalid-date')).toBe('—')
            expect(formatDate('not-a-date')).toBe('—')
        })

        it('dayjs 会修正无效日期（如月份超范围），应返回修正后的日期', () => {
            // dayjs 会修正超出范围的日期，如 99 月会变成未来的日期
            const result = formatDate('2024-99-99')
            // dayjs 将 2024-99-99 修正为 2032-06-07（99 月 = 第99个月 = 8年3个月后）
            expect(result).toBe('2032-06-07 00:00')
        })

        it('应支持自定义格式字符串', () => {
            expect(formatDate('2024-01-15 10:30:00', 'YYYY-MM-DD')).toBe('2024-01-15')
            expect(formatDate('2024-01-15 10:30:00', 'YYYY/MM/DD')).toBe('2024/01/15')
            expect(formatDate('2024-01-15 10:30:00', 'HH:mm:ss')).toBe('10:30:00')
            expect(formatDate('2024-01-15 10:30:00', 'YYYY年MM月DD日')).toBe('2024年01月15日')
        })

        it('无效日期配合自定义格式应返回默认占位符', () => {
            expect(formatDate('invalid', 'YYYY-MM-DD')).toBe('—')
        })

        it('应支持 ISO 格式日期', () => {
            expect(formatDate('2024-01-15T10:30:00+08:00')).toBe('2024-01-15 10:30')
            // UTC 时间会被转换为本地时区 (CST = UTC+8)
            expect(formatDate('2024-01-15T02:30:00Z')).toBe('2024-01-15 10:30')
        })
    })

    describe('formatDateOnly - 仅日期', () => {
        it('应正确格式化日期为简短格式', () => {
            expect(formatDateOnly('2024-01-15')).toBe('24/01/15')
            expect(formatDateOnly('2024-12-25')).toBe('24/12/25')
        })

        it('null 应返回默认占位符', () => {
            expect(formatDateOnly(null)).toBe('—')
        })

        it('undefined 应返回默认占位符', () => {
            expect(formatDateOnly(undefined)).toBe('—')
        })

        it('空字符串应返回默认占位符', () => {
            expect(formatDateOnly('')).toBe('—')
        })

        it('无效日期应返回默认占位符', () => {
            expect(formatDateOnly('invalid')).toBe('—')
            expect(formatDateOnly('not-a-date')).toBe('—')
        })

        it('应支持 ISO 格式日期', () => {
            expect(formatDateOnly('2024-01-15T10:30:00')).toBe('24/01/15')
        })
    })

    describe('formatDateChinese - 中文格式', () => {
        it('应正确格式化日期为中文格式', () => {
            expect(formatDateChinese('2024-01-15 10:30:00')).toBe('2024年01月15日 10:30')
            expect(formatDateChinese('2024-12-25 23:59:59')).toBe('2024年12月25日 23:59')
        })

        it('null 应返回默认占位符', () => {
            expect(formatDateChinese(null)).toBe('—')
        })

        it('undefined 应返回默认占位符', () => {
            expect(formatDateChinese(undefined)).toBe('—')
        })

        it('空字符串应返回默认占位符', () => {
            expect(formatDateChinese('')).toBe('—')
        })

        it('无效日期应返回默认占位符', () => {
            expect(formatDateChinese('invalid')).toBe('—')
            expect(formatDateChinese('not-a-date')).toBe('—')
        })
    })

    describe('formatDateRelative - 相对时间', () => {
        it('今天的日期应返回"今天"', () => {
            const now = dayjs()
            expect(formatDateRelative(now.format('YYYY-MM-DD HH:mm:ss'))).toBe('今天')
        })

        it('昨天的日期应返回"昨天"', () => {
            const yesterday = dayjs().subtract(1, 'day')
            expect(formatDateRelative(yesterday.format('YYYY-MM-DD HH:mm:ss'))).toBe('昨天')
        })

        it('7 天内的日期应返回"X 天前"', () => {
            // 2 天前
            const twoDaysAgo = dayjs().subtract(2, 'day')
            expect(formatDateRelative(twoDaysAgo.format('YYYY-MM-DD HH:mm:ss'))).toBe('2 天前')

            // 6 天前
            const sixDaysAgo = dayjs().subtract(6, 'day')
            expect(formatDateRelative(sixDaysAgo.format('YYYY-MM-DD HH:mm:ss'))).toBe('6 天前')
        })

        it('7 天前的日期应返回标准格式', () => {
            const sevenDaysAgo = dayjs().subtract(7, 'day')
            const result = formatDateRelative(sevenDaysAgo.format('YYYY-MM-DD HH:mm:ss'))
            // 7 天前应该返回 YYYY-MM-DD 格式
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        })

        it('null 应返回默认占位符', () => {
            expect(formatDateRelative(null)).toBe('—')
        })

        it('undefined 应返回默认占位符', () => {
            expect(formatDateRelative(undefined)).toBe('—')
        })

        it('空字符串应返回默认占位符', () => {
            expect(formatDateRelative('')).toBe('—')
        })

        it('无效日期应返回默认占位符', () => {
            expect(formatDateRelative('invalid')).toBe('—')
            expect(formatDateRelative('not-a-date')).toBe('—')
        })

        // 属性测试：验证 2-6 天前应返回正确的相对时间格式
        it('属性测试：2-6 天前应返回正确的相对时间格式', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2, max: 6 }),
                    (daysAgo) => {
                        const date = dayjs().subtract(daysAgo, 'day').startOf('day')
                        const result = formatDateRelative(date.format('YYYY-MM-DD HH:mm:ss'))
                        expect(result).toBe(`${daysAgo} 天前`)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })
})

describe('useFormatters 金额和数字格式化测试', () => {
    describe('formatAmount - 金额格式化', () => {
        it('应正确格式化正数金额', () => {
            expect(formatAmount(100)).toBe('100.00')
            expect(formatAmount(1234.56)).toBe('1234.56')
            expect(formatAmount(0)).toBe('0.00')
            expect(formatAmount(0.1)).toBe('0.10')
            expect(formatAmount(0.99)).toBe('0.99')
            expect(formatAmount(999999.99)).toBe('999999.99')
        })

        it('应正确格式化负数金额', () => {
            expect(formatAmount(-100)).toBe('-100.00')
            expect(formatAmount(-1234.56)).toBe('-1234.56')
        })

        it('应正确处理小数精度', () => {
            expect(formatAmount(1.005)).toBe('1.00') // 银行家舍入
            expect(formatAmount(1.234)).toBe('1.23')
            expect(formatAmount(1.999)).toBe('2.00')
        })

        it('null 应返回默认值', () => {
            expect(formatAmount(null)).toBe('0.00')
        })

        it('undefined 应返回默认值', () => {
            expect(formatAmount(undefined)).toBe('0.00')
        })

        it('NaN 应返回默认值', () => {
            expect(formatAmount(NaN)).toBe('0.00')
        })

        it('应正确处理大数', () => {
            expect(formatAmount(1000000)).toBe('1000000.00')
            expect(formatAmount(999999999.99)).toBe('999999999.99')
        })

        it('应正确处理浮点数精度问题', () => {
            // 0.1 + 0.2 !== 0.3
            expect(formatAmount(0.1 + 0.2)).toBe('0.30')
        })

        // 属性测试
        it('属性测试：金额格式化应保持两位小数', () => {
            fc.assert(
                fc.property(
                    fc.double({ noNaN: true, min: -1e10, max: 1e10 }),
                    (value) => {
                        const result = formatAmount(value)
                        // 验证格式：可选负号 + 数字(可选逗号) + . + 两位小数
                        expect(result).toMatch(/^-?[\d,]*\.\d{2}$/)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })

    describe('formatNumber - 千分位数字格式化', () => {
        it('应正确格式化整数', () => {
            expect(formatNumber(1000)).toBe('1,000')
            expect(formatNumber(1000000)).toBe('1,000,000')
            expect(formatNumber(123456789)).toBe('123,456,789')
        })

        it('应正确格式化小数', () => {
            expect(formatNumber(1234.56)).toBe('1,234.56')
            expect(formatNumber(1000.5)).toBe('1,000.5')
        })

        it('应正确格式化零', () => {
            expect(formatNumber(0)).toBe('0')
        })

        it('null 应返回默认值', () => {
            expect(formatNumber(null)).toBe('0')
        })

        it('undefined 应返回默认值', () => {
            expect(formatNumber(undefined)).toBe('0')
        })

        it('NaN 应返回默认值', () => {
            expect(formatNumber(NaN)).toBe('0')
        })

        it('应正确处理大数', () => {
            expect(formatNumber(10000000)).toBe('10,000,000')
            expect(formatNumber(999999999999)).toBe('999,999,999,999')
        })

        it('应正确处理负数', () => {
            expect(formatNumber(-1234)).toBe('-1,234')
            expect(formatNumber(-1234567.89)).toBe('-1,234,567.89')
        })

        // 属性测试
        it('属性测试：数字格式化结果应包含正确的千分位分隔符', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1000000000 }),
                    (value) => {
                        const result = formatNumber(value)
                        // 验证结果是非空的字符串
                        expect(result.length).toBeGreaterThan(0)
                        // 验证结果是有效的数字格式
                        expect(result).toMatch(/^-?\d{1,3}(,\d{3})*(\.\d+)?$/)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })

        it('属性测试：小数格式化应保持原始精度', () => {
            fc.assert(
                fc.property(
                    fc.float({ min: 0, max: 1000000, noNaN: true, noDefaultInfinity: true }),
                    (value) => {
                        const result = formatNumber(value)
                        // 验证结果是字符串
                        expect(typeof result).toBe('string')
                        // 验证格式正确（包含千分位逗号）
                        expect(result).toMatch(/^-?[\d,]+(\.\d+)?$/)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        })
    })
})

describe('useFormatters 边界情况测试', () => {
    describe('日期格式边界', () => {
        it('应处理闰年日期', () => {
            expect(formatDate('2024-02-29 10:00:00')).toBe('2024-02-29 10:00') // 2024 是闰年
        })

        it('应处理年份边界', () => {
            expect(formatDate('2023-12-31 23:59:59')).toBe('2023-12-31 23:59')
            expect(formatDate('2024-01-01 00:00:00')).toBe('2024-01-01 00:00')
        })

        it('应处理月份边界', () => {
            expect(formatDate('2024-01-31 12:00:00')).toBe('2024-01-31 12:00')
            expect(formatDate('2024-02-29 12:00:00')).toBe('2024-02-29 12:00') // 闰年
        })

        it('应处理时间边界', () => {
            expect(formatDate('2024-01-15 00:00:00')).toBe('2024-01-15 00:00')
            expect(formatDate('2024-01-15 23:59:59')).toBe('2024-01-15 23:59')
        })
    })

    describe('金额格式边界', () => {
        it('应处理极大金额', () => {
            expect(formatAmount(999999999999999)).toBe('999999999999999.00')
        })

        it('应处理极小金额', () => {
            expect(formatAmount(0.01)).toBe('0.01')
            expect(formatAmount(0.001)).toBe('0.00') // 舍入到两位小数
        })

        it('应处理科学计数法边缘值', () => {
            expect(formatAmount(1e10)).toBe('10000000000.00')
            expect(formatAmount(1e-5)).toBe('0.00')
        })
    })

    describe('数字格式边界', () => {
        it('应处理临界值', () => {
            expect(formatNumber(999)).toBe('999')
            expect(formatNumber(1000)).toBe('1,000')
            expect(formatNumber(999999)).toBe('999,999')
            expect(formatNumber(1000000)).toBe('1,000,000')
        })

        it('应处理小数位数', () => {
            expect(formatNumber(1.1)).toBe('1.1')
            expect(formatNumber(1.12)).toBe('1.12')
            expect(formatNumber(1.123)).toBe('1.123')
        })
    })
})
