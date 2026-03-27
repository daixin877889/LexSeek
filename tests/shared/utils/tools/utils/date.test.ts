/**
 * 日期工具函数测试
 *
 * 测试 formatDate, parseDate, daysBetween, isLeapYear, getDaysInYear,
 * addDays, addMonths, addYears, isWeekend, getWorkingDays 等函数
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    formatDate,
    parseDate,
    daysBetween,
    isLeapYear,
    getDaysInYear,
    addDays,
    addMonths,
    addYears,
    isWeekend,
    getWorkingDays,
    getCurrentDate,
    getFirstDayOfMonth,
    getLastDayOfMonth
} from '#shared/utils/tools/utils/date'

describe('formatDate', () => {
    it('应正确格式化 Date 对象', () => {
        expect(formatDate(new Date(2025, 0, 15))).toBe('2025-01-15')
        expect(formatDate(new Date(2025, 11, 31))).toBe('2025-12-31')
        expect(formatDate(new Date(2024, 1, 29))).toBe('2024-02-29')
    })

    it('应正确格式化日期字符串', () => {
        expect(formatDate('2025-06-20')).toBe('2025-06-20')
        expect(formatDate('2025-01-01')).toBe('2025-01-01')
    })

    it('null 和 undefined 应返回空字符串', () => {
        expect(formatDate(null)).toBe('')
        expect(formatDate(undefined)).toBe('')
    })

    it('无效日期应返回空字符串', () => {
        expect(formatDate('invalid-date' as any)).toBe('')
        expect(formatDate('not-a-date' as any)).toBe('')
    })

    it('应补齐月份和日期为两位数', () => {
        expect(formatDate(new Date(2025, 0, 5))).toBe('2025-01-05')
        expect(formatDate(new Date(2025, 8, 9))).toBe('2025-09-09')
    })
})

describe('parseDate', () => {
    it('应正确解析标准格式日期', () => {
        const result = parseDate('2025-06-20')
        expect(result).toBeInstanceOf(Date)
        expect(result?.getFullYear()).toBe(2025)
        expect(result?.getMonth()).toBe(5)
        expect(result?.getDate()).toBe(20)
    })

    it('null 和 undefined 应返回 null', () => {
        expect(parseDate(null)).toBeNull()
        expect(parseDate(undefined)).toBeNull()
    })

    it('空字符串应返回 null', () => {
        expect(parseDate('')).toBeNull()
    })

    it('无效格式应返回 null', () => {
        expect(parseDate('2025/06/20')).toBeNull()
        expect(parseDate('06-20-2025')).toBeNull()
        expect(parseDate('invalid')).toBeNull()
    })

    it('无效日期值应返回 null', () => {
        expect(parseDate('2025-02-30')).toBeNull()
        expect(parseDate('2025-13-01')).toBeNull()
        expect(parseDate('2025-00-15')).toBeNull()
    })

    it('闰年 2-29 应正确解析', () => {
        const result = parseDate('2024-02-29')
        expect(result).toBeInstanceOf(Date)
        expect(result?.getMonth()).toBe(1)
        expect(result?.getDate()).toBe(29)
    })

    it('非闰年 2-29 应返回 null', () => {
        expect(parseDate('2025-02-29')).toBeNull()
    })

    it('解析结果时间应设置为 00:00:00', () => {
        const result = parseDate('2025-06-20')
        expect(result?.getHours()).toBe(0)
        expect(result?.getMinutes()).toBe(0)
        expect(result?.getSeconds()).toBe(0)
    })
})

describe('daysBetween', () => {
    it('应正确计算同一年内的天数', () => {
        expect(daysBetween('2025-01-01', '2025-01-10')).toBe(9)
        expect(daysBetween('2025-01-01', '2025-12-31')).toBe(364)
    })

    it('应正确计算跨年的天数', () => {
        expect(daysBetween('2024-12-31', '2025-01-01')).toBe(1)
        expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366)
    })

    it('应正确计算 Date 对象的天数', () => {
        expect(daysBetween(new Date(2025, 0, 1), new Date(2025, 0, 11))).toBe(10)
    })

    it('顺序颠倒应返回正数', () => {
        expect(daysBetween('2025-01-10', '2025-01-01')).toBe(9)
    })

    it('相同日期应返回 0', () => {
        expect(daysBetween('2025-06-20', '2025-06-20')).toBe(0)
    })

    it('无效日期应返回 0', () => {
        expect(daysBetween('invalid', '2025-01-01')).toBe(0)
        expect(daysBetween('2025-01-01', 'invalid')).toBe(0)
    })

    it('应正确处理闰年', () => {
        expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
        expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1)
    })
})

describe('isLeapYear', () => {
    it('闰年应返回 true', () => {
        expect(isLeapYear(2024)).toBe(true)
        expect(isLeapYear(2020)).toBe(true)
        expect(isLeapYear(2000)).toBe(true)
        expect(isLeapYear(1600)).toBe(true)
    })

    it('非闰年应返回 false', () => {
        expect(isLeapYear(2025)).toBe(false)
        expect(isLeapYear(2023)).toBe(false)
        expect(isLeapYear(1900)).toBe(false)
        expect(isLeapYear(2100)).toBe(false)
    })

    it('负数年份应正确处理', () => {
        expect(isLeapYear(-4)).toBe(true)
        expect(isLeapYear(-1)).toBe(false)
    })

    it('零年份应正确处理', () => {
        // 公元 1 年不是闰年 (1 % 4 === 1)
        expect(isLeapYear(1)).toBe(false)
        // 公元 0 年是闰年 (0 % 400 === 0)
        expect(isLeapYear(0)).toBe(true)
    })
})

describe('getDaysInYear', () => {
    it('闰年应返回 366', () => {
        expect(getDaysInYear(2024)).toBe(366)
        expect(getDaysInYear(2000)).toBe(366)
    })

    it('非闰年应返回 365', () => {
        expect(getDaysInYear(2025)).toBe(365)
        expect(getDaysInYear(1900)).toBe(365)
    })
})

describe('addDays', () => {
    it('应正确加天数', () => {
        expect(addDays('2025-01-15', 10).toISOString().startsWith('2025-01-25')).toBe(true)
        expect(addDays('2025-01-15', 1).toISOString().startsWith('2025-01-16')).toBe(true)
    })

    it('应正确减天数', () => {
        expect(addDays('2025-01-15', -10).toISOString().startsWith('2025-01-05')).toBe(true)
    })

    it('跨月应正确处理', () => {
        expect(addDays('2025-01-31', 1).toISOString().startsWith('2025-02-01')).toBe(true)
    })

    it('跨年应正确处理', () => {
        expect(addDays('2025-12-31', 1).toISOString().startsWith('2026-01-01')).toBe(true)
    })

    it('应接受 Date 对象', () => {
        const result = addDays(new Date(2025, 0, 15), 5)
        expect(result.getDate()).toBe(20)
    })
})

describe('addMonths', () => {
    it('应正确加月数', () => {
        expect(addMonths('2025-01-15', 1).toISOString().startsWith('2025-02-')).toBe(true)
        expect(addMonths('2025-01-15', 12).toISOString().startsWith('2026-01-')).toBe(true)
    })

    it('应正确减月数', () => {
        expect(addMonths('2025-06-15', -1).toISOString().startsWith('2025-05-')).toBe(true)
    })

    it('跨年应正确处理', () => {
        expect(addMonths('2025-12-15', 1).toISOString().startsWith('2026-01-')).toBe(true)
    })

    it('月末日期应正确处理', () => {
        const result = addMonths('2025-01-31', 1)
        // setMonth 溢出: 1月31日 + 1月 → 2月溢出 → 3月3日
        expect(result.getMonth()).toBe(2)
        expect(result.getDate()).toBe(3)
    })
})

describe('addYears', () => {
    it('应正确加年数', () => {
        expect(addYears('2025-06-20', 1).getFullYear()).toBe(2026)
        expect(addYears('2025-06-20', 5).getFullYear()).toBe(2030)
    })

    it('应正确减年数', () => {
        expect(addYears('2025-06-20', -1).getFullYear()).toBe(2024)
    })

    it('闰年 2-29 应正确处理', () => {
        const result = addYears('2024-02-29', 1)
        // setFullYear 溢出: 2024-02-29 + 1年 → 2025-02-28溢出 → 2025-03-01
        expect(result.getMonth()).toBe(2)
        expect(result.getDate()).toBe(1)
    })
})

describe('isWeekend', () => {
    it('周六应返回 true', () => {
        expect(isWeekend('2025-01-04')).toBe(true)
        expect(isWeekend(new Date(2025, 0, 4))).toBe(true)
    })

    it('周日应返回 true', () => {
        expect(isWeekend('2025-01-05')).toBe(true)
        expect(isWeekend(new Date(2025, 0, 5))).toBe(true)
    })

    it('周一至周五应返回 false', () => {
        expect(isWeekend('2025-01-06')).toBe(false)
        expect(isWeekend('2025-01-07')).toBe(false)
        expect(isWeekend('2025-01-08')).toBe(false)
        expect(isWeekend('2025-01-09')).toBe(false)
        expect(isWeekend('2025-01-10')).toBe(false)
    })
})

describe('getWorkingDays', () => {
    it('应正确计算工作日天数', () => {
        const result = getWorkingDays('2025-01-06', '2025-01-10')
        expect(result).toBe(5)
    })

    it('应排除周末', () => {
        const result = getWorkingDays('2025-01-03', '2025-01-12')
        expect(result).toBe(6)
    })

    it('只包含周末应返回 0', () => {
        const result = getWorkingDays('2025-01-04', '2025-01-05')
        expect(result).toBe(0)
    })

    it('颠倒顺序应返回相同结果', () => {
        const r1 = getWorkingDays('2025-01-03', '2025-01-12')
        const r2 = getWorkingDays('2025-01-12', '2025-01-03')
        expect(r1).toBe(r2)
    })

    it('应接受 Date 对象', () => {
        const result = getWorkingDays(new Date(2025, 0, 6), new Date(2025, 0, 10))
        expect(result).toBe(5)
    })
})

describe('getCurrentDate', () => {
    it('应返回 YYYY-MM-DD 格式的当前日期', () => {
        const result = getCurrentDate()
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

describe('getFirstDayOfMonth', () => {
    it('应返回月份第一天', () => {
        const result = getFirstDayOfMonth('2025-06-20')
        expect(result.getDate()).toBe(1)
        expect(result.getMonth()).toBe(5)
    })

    it('应接受 Date 对象', () => {
        const result = getFirstDayOfMonth(new Date(2025, 5, 20))
        expect(result.getDate()).toBe(1)
    })
})

describe('getLastDayOfMonth', () => {
    it('应返回月份最后一天', () => {
        const result = getLastDayOfMonth('2025-01-20')
        expect(result.getDate()).toBe(31)
    })

    it('应正确处理 2 月', () => {
        expect(getLastDayOfMonth('2025-02-10').getDate()).toBe(28)
        expect(getLastDayOfMonth('2024-02-10').getDate()).toBe(29)
    })

    it('应正确处理 12 月', () => {
        const result = getLastDayOfMonth('2025-12-15')
        expect(result.getMonth()).toBe(11)
        expect(result.getDate()).toBe(31)
    })
})
