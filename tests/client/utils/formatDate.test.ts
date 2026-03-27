/**
 * formatDate 日期格式化工具测试
 *
 * 测试日期格式化功能
 *
 * **Feature: date-format-utils**
 * **Validates: 日期格式化功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatDate } from '~/utils/formatDate'

describe('formatDate 日期格式化', () => {
    it('应正确格式化 Date 对象', () => {
        const date = new Date('2024-03-15T10:30:45')
        expect(formatDate(date, 'YYYY-MM-DD')).toBe('2024-03-15')
        expect(formatDate(date, 'YYYY/MM/DD')).toBe('2024/03/15')
    })

    it('应正确格式化日期字符串', () => {
        expect(formatDate('2024-06-20', 'YYYY-MM-DD')).toBe('2024-06-20')
        expect(formatDate('2024-12-31T23:59:59', 'YYYY-MM-DD')).toBe('2024-12-31')
    })

    it('应正确格式化时间戳', () => {
        // 2024-03-15T10:30:45 UTC -> timestamp
        const date = new Date('2024-03-15T10:30:45')
        const ts = date.getTime()
        expect(formatDate(ts, 'YYYY-MM-DD')).toBe('2024-03-15')
    })

    it('应正确处理单个数字的月份和日期', () => {
        const date = new Date('2024-01-05T08:03:07')
        expect(formatDate(date, 'YYYY-MM-DD')).toBe('2024-01-05')
        expect(formatDate(date, 'HH:mm:ss')).toBe('08:03:07')
    })

    it('应正确处理双位数月份和日期', () => {
        const date = new Date('2024-12-25T14:30:00')
        expect(formatDate(date, 'YYYY-MM-DD')).toBe('2024-12-25')
        expect(formatDate(date, 'HH:mm:ss')).toBe('14:30:00')
    })

    it('应使用默认格式 YYYY-MM-DD HH:mm:ss', () => {
        const date = new Date('2024-03-15T10:30:45')
        expect(formatDate(date)).toBe('2024-03-15 10:30:45')
    })

    it('应只替换格式字符串中存在的占位符', () => {
        const date = new Date('2024-03-15T10:30:45')
        expect(formatDate(date, 'YYYY年MM月DD日')).toBe('2024年03月15日')
        expect(formatDate(date, 'MM/DD/YYYY')).toBe('03/15/2024')
        expect(formatDate(date, 'HH点mm分')).toBe('10点30分')
    })

    it('无效日期应返回包含 NaN 的字符串', () => {
        // 无效日期的 getFullYear() 返回 NaN，格式化后显示为 NaN
        const result = formatDate('not-a-date', 'YYYY-MM-DD')
        expect(result).toContain('NaN')
    })

    it('Property: 任意日期格式化后年份应为 4 位数', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('1900-01-01'), max: new Date('2100-01-01') }),
                (d) => {
                    const result = formatDate(d, 'YYYY-MM-DD')
                    const year = result.split('-')[0]
                    expect(year.length).toBe(4)
                    expect(parseInt(year, 10)).toBeGreaterThanOrEqual(1900)
                    expect(parseInt(year, 10)).toBeLessThanOrEqual(2100)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })

    it('Property: 格式化后月份和日期应在有效范围内', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
                (d) => {
                    const result = formatDate(d, 'YYYY-MM-DD')
                    const [, month, day] = result.split('-').map(Number)
                    expect(month).toBeGreaterThanOrEqual(1)
                    expect(month).toBeLessThanOrEqual(12)
                    expect(day).toBeGreaterThanOrEqual(1)
                    expect(day).toBeLessThanOrEqual(31)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })

    it('Property: 格式化后小时、分钟、秒应在有效范围内', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
                (d) => {
                    const result = formatDate(d, 'HH:mm:ss')
                    const [h, m, s] = result.split(':').map(Number)
                    expect(h).toBeGreaterThanOrEqual(0)
                    expect(h).toBeLessThanOrEqual(23)
                    expect(m).toBeGreaterThanOrEqual(0)
                    expect(m).toBeLessThanOrEqual(59)
                    expect(s).toBeGreaterThanOrEqual(0)
                    expect(s).toBeLessThanOrEqual(59)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })

    it('Property: 同一天不同时刻格式化后应保持日期一致', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 23 }),
                fc.integer({ min: 0, max: 59 }),
                (hour, minute) => {
                    const d = new Date(2024, 0, 15, hour, minute, 30)
                    const dateStr = formatDate(d, 'YYYY-MM-DD')
                    expect(dateStr).toBe('2024-01-15')
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })
})
