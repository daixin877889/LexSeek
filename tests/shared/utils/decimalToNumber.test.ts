/**
 * decimalToNumber 工具函数测试
 *
 * 测试 Prisma Decimal 转换逻辑
 *
 * **Feature: decimal-conversion**
 * **Validates: Prisma Decimal 类型转换功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { decimalToNumberUtils } from '../../../shared/utils/decimalToNumber'

describe('decimalToNumberUtils 空值处理', () => {
    it('null 应返回 0', () => {
        expect(decimalToNumberUtils(null)).toBe(0)
    })

    it('undefined 应返回 0', () => {
        expect(decimalToNumberUtils(undefined)).toBe(0)
    })
})

describe('decimalToNumberUtils 原始类型处理', () => {
    it('数字应直接返回', () => {
        expect(decimalToNumberUtils(0)).toBe(0)
        expect(decimalToNumberUtils(42)).toBe(42)
        expect(decimalToNumberUtils(3.14159)).toBe(3.14159)
        expect(decimalToNumberUtils(-10)).toBe(-10)
    })

    it('字符串数字应正确解析', () => {
        expect(decimalToNumberUtils('123')).toBe(123)
        expect(decimalToNumberUtils('0')).toBe(0)
        expect(decimalToNumberUtils('-99.5')).toBe(-99.5)
    })

    it('无效字符串应返回 0', () => {
        expect(decimalToNumberUtils('')).toBe(0)
        expect(decimalToNumberUtils('abc')).toBe(0)
        expect(decimalToNumberUtils('not a number')).toBe(0)
    })
})

describe('decimalToNumberUtils toNumber 方法', () => {
    it('有 toNumber 方法的对象应调用该方法', () => {
        const mockDecimal = {
            toNumber: () => 42.5,
        }
        expect(decimalToNumberUtils(mockDecimal as any)).toBe(42.5)
    })

    it('toNumber 返回 0 应返回 0', () => {
        const mockDecimal = {
            toNumber: () => 0,
        }
        expect(decimalToNumberUtils(mockDecimal as any)).toBe(0)
    })
})

describe('decimalToNumberUtils Decimal 内部结构 {s, e, d} 处理', () => {
    it('有 toNumber 方法的对象应调用该方法', () => {
        const mockDecimal = {
            toNumber: () => 42.5,
        }
        expect(decimalToNumberUtils(mockDecimal as any)).toBe(42.5)
    })

    it('toNumber 返回 0 应返回 0', () => {
        const mockDecimal = {
            toNumber: () => 0,
        }
        expect(decimalToNumberUtils(mockDecimal as any)).toBe(0)
    })

    it('空 d 数组应返回 0', () => {
        const result = decimalToNumberUtils({ s: 1, e: 0, d: [] } as any)
        expect(result).toBe(0)
    })

    it('单个数字应正确处理', () => {
        // { s: 1, e: 2, d: [123] } → numStr = '123', integerDigits = 3
        // 3 >= 3 → 不插入小数点，直接返回 numStr = '123'
        const result = decimalToNumberUtils({ s: 1, e: 2, d: [123] } as any)
        expect(result).toBe(123)
    })

    it('多个数字应正确拼接（decimal.js 格式）', () => {
        // { s: 1, e: 1, d: [1, 2345678] } → "1" + "2345678" = "12345678"
        // integerDigits = 2, 截取 "12" + "." + "345678" = 12.345678
        const result = decimalToNumberUtils({ s: 1, e: 1, d: [1, 2345678] } as any)
        expect(result).toBeCloseTo(12.345678, 5)
    })

    it('带小数部分的数字应正确插入小数点', () => {
        // { s: 1, e: 0, d: [12345] } → 整数部分有 e+1=1 位: "1" + "." + "2345" = 1.2345
        const result = decimalToNumberUtils({ s: 1, e: 0, d: [12345] } as any)
        expect(result).toBeCloseTo(1.2345, 4)
    })

    it('整数部分长度等于数字长度时不应插入小数点', () => {
        // { s: 1, e: 2, d: [1] } → 整数部分有 e+1=3 位, 数字只有 1 位
        // numStr = "1", integerDigits = 3, 需要补零: "100"
        const result = decimalToNumberUtils({ s: 1, e: 2, d: [1] } as any)
        expect(result).toBe(100)
    })

    it('负数应正确处理', () => {
        // { s: -1, e: 3, d: [5000] } → "5000", integerDigits = 4
        // 4 >= 4 → 不插入小数点: "5000" → -5000
        const result = decimalToNumberUtils({ s: -1, e: 3, d: [5000] } as any)
        expect(result).toBe(-5000)
    })

    it('全小数部分（e < 0）应正确处理', () => {
        // { s: 1, e: -3, d: [5] } → 整数部分有 e+1=-2 位, 全为小数
        // 0.00 + "5" = 0.005
        const result = decimalToNumberUtils({ s: 1, e: -3, d: [5] } as any)
        expect(result).toBeCloseTo(0.005, 5)
    })

    it('d 数组含 undefined 元素应跳过', () => {
        // { s: 1, e: 1, d: [42, undefined, 7] } → "42" + "0000007" = "420000007"
        // integerDigits = 2, 截取 "42" + "." + "0000007" = 42.0000007
        const result = decimalToNumberUtils({ s: 1, e: 1, d: [42, undefined as any, 7] } as any)
        expect(result).toBeCloseTo(42.0000007, 6)
    })

    it('s 字段缺失应默认为正数', () => {
        // { e: 1, d: [100] } → numStr = '100', integerDigits = 2
        // 3 >= 2 → 截取 "10" + "." + "0" = 10.0
        const result = decimalToNumberUtils({ e: 1, d: [100] } as any)
        expect(result).toBe(10.0)
    })

    it('e 字段缺失应默认为 0', () => {
        // { s: 1, d: [42] } → numStr = '42', integerDigits = 1
        // 2 >= 1 → 截取 "4" + "." + "2" = 4.2
        const result = decimalToNumberUtils({ s: 1, d: [42] } as any)
        expect(result).toBe(4.2)
    })

    it('d 字段不是数组应返回 0', () => {
        const result = decimalToNumberUtils({ s: 1, e: 1, d: 'not-an-array' } as any)
        expect(result).toBe(0)
    })

    it('兜底 Number 转换应处理未知结构', () => {
        const result = decimalToNumberUtils({ unknown: 'structure' } as any)
        expect(result).toBe(0)
    })
})

describe('decimalToNumberUtils 属性测试', () => {
    it('Property: 正整数转换应正确', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 999999 }),
                (value) => {
                    // 使用 toNumber 方法的 mock
                    const mockDecimal = {
                        toNumber: () => value,
                    }
                    const result = decimalToNumberUtils(mockDecimal as any)
                    expect(result).toBeCloseTo(value, 0)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })

    it('Property: 零应返回 0', () => {
        expect(decimalToNumberUtils(0)).toBe(0)
        expect(decimalToNumberUtils('')).toBe(0)
    })

    it('Property: 负数应正确处理', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -999999, max: -1 }),
                (value) => {
                    expect(decimalToNumberUtils(value)).toBeCloseTo(value, 0)
                }
            ),
            { numRuns: 50, seed: 12345 }
        )
    })
})
