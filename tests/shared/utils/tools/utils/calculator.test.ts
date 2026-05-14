/**
 * 计算器工具函数测试
 *
 * 测试 formatCurrency, calculateInterest, numberToChinese 函数
 */
import { describe, it, expect } from 'vitest'
import {
    formatCurrency,
    calculateInterest,
    numberToChinese,
    formatRMB,
} from '#shared/utils/tools/utils/calculator'

describe('formatCurrency', () => {
    it('应正确格式化整数', () => {
        expect(formatCurrency(1000)).toBe('1,000.00')
        expect(formatCurrency(1000000)).toBe('1,000,000.00')
        expect(formatCurrency(0)).toBe('0.00')
    })

    it('应正确格式化小数', () => {
        expect(formatCurrency(1234.56)).toBe('1,234.56')
        expect(formatCurrency(999.99)).toBe('999.99')
    })

    it('应正确格式化负数', () => {
        expect(formatCurrency(-1000)).toBe('-1,000.00')
        expect(formatCurrency(-1234.56)).toBe('-1,234.56')
    })

    it('null 和 undefined 应返回 0', () => {
        expect(formatCurrency(null)).toBe('0')
        expect(formatCurrency(undefined)).toBe('0')
    })

    it('NaN 应返回 0', () => {
        expect(formatCurrency(NaN)).toBe('0')
    })

    it('应支持自定义小数位数', () => {
        expect(formatCurrency(1000.5, 0)).toBe('1,001')
        expect(formatCurrency(1000.555, 3)).toBe('1,000.555')
    })

    it('应支持自定义分隔符', () => {
        expect(formatCurrency(1000.5, 2, '.', ' ')).toBe('1 000.50')
    })
})

describe('calculateInterest', () => {
    it('应正确计算利息', () => {
        const result = calculateInterest(10000, 5, 365, 365)
        expect(result).toBe(500)
    })

    it('应正确处理部分年份', () => {
        const result = calculateInterest(10000, 5, 182.5, 365)
        expect(result).toBeCloseTo(250, 2)
    })

    it('零利率应返回 0', () => {
        expect(calculateInterest(10000, 0, 365, 365)).toBe(0)
    })

    it('零本金应返回 0', () => {
        expect(calculateInterest(0, 5, 365, 365)).toBe(0)
    })

    it('零天数应返回 0', () => {
        expect(calculateInterest(10000, 5, 0, 365)).toBe(0)
    })

    it('应使用 360 天计算', () => {
        const result365 = calculateInterest(10000, 5, 360, 365)
        const result360 = calculateInterest(10000, 5, 360, 360)
        expect(result365).toBeCloseTo(result360 * (360 / 365), 2)
    })
})

describe('numberToChinese', () => {
    it('应正确转换整数', () => {
        expect(numberToChinese(0)).toBe('零元')
        expect(numberToChinese(1)).toBe('壹元整')
        expect(numberToChinese(10)).toBe('壹拾零元整')
        expect(numberToChinese(100)).toBe('壹佰零元整')
    })

    it('应正确转换带小数的金额', () => {
        expect(numberToChinese(1.5)).toBe('伍角壹元')
        expect(numberToChinese(1.05)).toBe('伍分壹元')
        expect(numberToChinese(1.55)).toBe('伍角伍分壹元')
    })

    it('null 和 undefined 应返回零元整', () => {
        expect(numberToChinese(null)).toBe('零元整')
        expect(numberToChinese(undefined)).toBe('零元整')
    })

    it('NaN 应返回零元整', () => {
        expect(numberToChinese(NaN)).toBe('零元整')
    })

    it('应正确处理大金额', () => {
        expect(numberToChinese(10000)).toBe('壹万零零零元整')
        expect(numberToChinese(100000000)).toBe('壹亿零零零万零零零元整')
    })

    it('应正确处理带零的金额', () => {
        expect(numberToChinese(101)).toBe('壹佰零壹元整')
        expect(numberToChinese(1001)).toBe('壹仟零零壹元整')
    })

    it('负数应取绝对值', () => {
        expect(numberToChinese(-100)).toBe('壹佰零元整')
    })

    it('小数位为00时应正确处理（不输出角分）', () => {
        // decimalPart === '00' 时不进入小数处理分支
        expect(numberToChinese(100.00)).toBe('壹佰零元整')
        expect(numberToChinese(1.00)).toBe('壹元整')
    })

    it('应正确处理多位小数金额', () => {
        // 触发 digit[n] 的 ?? 分支和 fraction[i] 的 ?? 分支
        expect(numberToChinese(1.01)).toBe('壹分壹元')
    })
})

describe('formatRMB（人民币千分位 zh-CN 格式）', () => {
    it('null 应返回 0', () => {
        expect(formatRMB(null)).toBe('0')
    })

    it('undefined 应返回 0', () => {
        expect(formatRMB(undefined)).toBe('0')
    })

    it('NaN 应返回 0（数字直接传入）', () => {
        expect(formatRMB(NaN)).toBe('0')
    })

    it('无法解析的字符串应返回 0', () => {
        expect(formatRMB('abc')).toBe('0')
    })

    it('应格式化整数千分位（默认不强制小数位）', () => {
        expect(formatRMB(1000)).toBe('1,000')
        expect(formatRMB(1234567)).toBe('1,234,567')
    })

    it('应正确格式化字符串数字', () => {
        expect(formatRMB('1234.56')).toBe('1,234.56')
    })

    it('指定 decimals=2 应强制两位小数', () => {
        expect(formatRMB(1234, 2)).toBe('1,234.00')
        expect(formatRMB(1234.5, 2)).toBe('1,234.50')
        expect(formatRMB(1234.567, 2)).toBe('1,234.57')
    })

    it('指定 decimals=0 应不显示小数位', () => {
        expect(formatRMB(1234.56, 0)).toBe('1,235')
    })
})

describe('calculateInterest 默认参数', () => {
    it('省略 yearDays 应使用默认 365', () => {
        // 覆盖 line 51 default-arg
        const interest = calculateInterest(10000, 5, 365)
        expect(interest).toBeCloseTo(500, 0)
    })
})

describe('formatCurrency 边界：整数部分为空（小数位较多）', () => {
    it('numStr 整数部分为 "0" 应正常处理', () => {
        // 覆盖 line 15 if (parts[0]) true 分支（"0" 是 truthy）
        expect(formatCurrency(0.5)).toBe('0.50')
    })
})
