/**
 * 验证器工具函数测试
 *
 * 测试 isEmpty, isNumber, isInteger, isPositive, isNonNegative,
 * isInRange, isValidDate, validateForm 函数
 */
import { describe, it, expect } from 'vitest'
import {
    isEmpty,
    isNumber,
    isInteger,
    isPositive,
    isNonNegative,
    isInRange,
    isValidDate,
    validateForm
} from '#shared/utils/tools/utils/validators'

describe('isEmpty', () => {
    it('null 和 undefined 应返回 true', () => {
        expect(isEmpty(null)).toBe(true)
        expect(isEmpty(undefined)).toBe(true)
    })

    it('空字符串应返回 true', () => {
        expect(isEmpty('')).toBe(true)
        expect(isEmpty('   ')).toBe(true)
    })

    it('空数组应返回 true', () => {
        expect(isEmpty([])).toBe(true)
    })

    it('空对象应返回 true', () => {
        expect(isEmpty({})).toBe(true)
    })

    it('非空值应返回 false', () => {
        expect(isEmpty('hello')).toBe(false)
        expect(isEmpty(0)).toBe(false)
        expect(isEmpty(false)).toBe(false)
        expect(isEmpty([1])).toBe(false)
        expect(isEmpty({ a: 1 })).toBe(false)
    })
})

describe('isNumber', () => {
    it('数字应返回 true', () => {
        expect(isNumber(0)).toBe(true)
        expect(isNumber(42)).toBe(true)
        expect(isNumber(-3.14)).toBe(true)
        expect(isNumber(1e5)).toBe(true)
    })

    it('数字字符串应返回 true', () => {
        expect(isNumber('42')).toBe(true)
        expect(isNumber('3.14')).toBe(true)
        expect(isNumber('-100')).toBe(true)
    })

    it('null 和 undefined 应返回 false', () => {
        expect(isNumber(null)).toBe(false)
        expect(isNumber(undefined)).toBe(false)
    })

    it('空字符串应返回 false', () => {
        expect(isNumber('')).toBe(false)
    })

    it('非数字字符串应返回 false', () => {
        expect(isNumber('hello')).toBe(false)
        expect(isNumber('42abc')).toBe(false)
    })

    it('NaN 和 Infinity 应返回 false', () => {
        expect(isNumber(NaN)).toBe(false)
        expect(isNumber(Infinity)).toBe(false)
    })
})

describe('isInteger', () => {
    it('整数应返回 true', () => {
        expect(isInteger(0)).toBe(true)
        expect(isInteger(42)).toBe(true)
        expect(isInteger(-100)).toBe(true)
    })

    it('整数字符串应返回 true', () => {
        expect(isInteger('42')).toBe(true)
        expect(isInteger('-100')).toBe(true)
    })

    it('小数应返回 false', () => {
        expect(isInteger(3.14)).toBe(false)
        expect(isInteger('3.14')).toBe(false)
    })

    it('非数字应返回 false', () => {
        expect(isInteger('hello')).toBe(false)
        expect(isInteger(null)).toBe(false)
    })
})

describe('isPositive', () => {
    it('正数应返回 true', () => {
        expect(isPositive(1)).toBe(true)
        expect(isPositive(0.001)).toBe(true)
        expect(isPositive('100')).toBe(true)
    })

    it('零和负数应返回 false', () => {
        expect(isPositive(0)).toBe(false)
        expect(isPositive(-1)).toBe(false)
        expect(isPositive(-100)).toBe(false)
    })

    it('非数字应返回 false', () => {
        expect(isPositive('hello')).toBe(false)
        expect(isPositive(null)).toBe(false)
    })
})

describe('isNonNegative', () => {
    it('非负数应返回 true', () => {
        expect(isNonNegative(0)).toBe(true)
        expect(isNonNegative(1)).toBe(true)
        expect(isNonNegative('100')).toBe(true)
    })

    it('负数应返回 false', () => {
        expect(isNonNegative(-1)).toBe(false)
        expect(isNonNegative(-0.001)).toBe(false)
    })
})

describe('isInRange', () => {
    it('在范围内的值应返回 true', () => {
        expect(isInRange(5, 1, 10)).toBe(true)
        expect(isInRange(1, 1, 10)).toBe(true)
        expect(isInRange(10, 1, 10)).toBe(true)
    })

    it('在范围外的值应返回 false', () => {
        expect(isInRange(0, 1, 10)).toBe(false)
        expect(isInRange(11, 1, 10)).toBe(false)
    })

    it('应只检查下限', () => {
        expect(isInRange(5, 1)).toBe(true)
        expect(isInRange(0, 1)).toBe(false)
    })

    it('应只检查上限', () => {
        expect(isInRange(5, undefined, 10)).toBe(true)
        expect(isInRange(15, undefined, 10)).toBe(false)
    })

    it('非数字应返回 false', () => {
        expect(isInRange('hello', 1, 10)).toBe(false)
    })
})

describe('isValidDate', () => {
    it('有效日期应返回 true', () => {
        expect(isValidDate('2025-01-01')).toBe(true)
        expect(isValidDate('2025-06-20')).toBe(true)
        expect(isValidDate('2024-02-29')).toBe(true)
    })

    it('无效格式应返回 false', () => {
        expect(isValidDate('2025/01/01')).toBe(false)
        expect(isValidDate('01-01-2025')).toBe(false)
        expect(isValidDate('2025-1-1')).toBe(false)
        expect(isValidDate('2025-01-1')).toBe(false)
    })

    it('无效日期值应返回 false', () => {
        expect(isValidDate('2025-02-30')).toBe(false)
        expect(isValidDate('2025-13-01')).toBe(false)
        expect(isValidDate('2025-00-15')).toBe(false)
        expect(isValidDate('2025-04-31')).toBe(false)
    })

    it('null 和 undefined 应返回 false', () => {
        expect(isValidDate(null)).toBe(false)
        expect(isValidDate(undefined)).toBe(false)
    })

    it('空字符串应返回 false', () => {
        expect(isValidDate('')).toBe(false)
    })

    it('非闰年 2-29 应返回 false', () => {
        expect(isValidDate('2025-02-29')).toBe(false)
    })
})

describe('validateForm', () => {
    it('空规则应返回 valid=true', () => {
        const result = validateForm({ name: 'test' }, {})
        expect(result.valid).toBe(true)
        expect(Object.keys(result.errors).length).toBe(0)
    })

    it('required 验证应正确工作', () => {
        const result = validateForm({}, { name: { required: true } })
        expect(result.valid).toBe(false)
        expect(result.errors.name).toBe('此项不能为空')
    })

    it('required 验证通过应返回 valid', () => {
        const result = validateForm({ name: 'test' }, { name: { required: true } })
        expect(result.valid).toBe(true)
    })

    it('type=number 验证应正确工作', () => {
        const result = validateForm({ age: 'abc' }, { age: { type: 'number' } })
        expect(result.valid).toBe(false)
        expect(result.errors.age).toBe('请输入有效的数字')
    })

    it('type=integer 验证应正确工作', () => {
        const result = validateForm({ count: '3.5' }, { count: { type: 'integer' } })
        expect(result.valid).toBe(false)
        expect(result.errors.count).toBe('请输入有效的整数')
    })

    it('type=positive 验证应正确工作', () => {
        const result = validateForm({ amount: '-5' }, { amount: { type: 'positive' } })
        expect(result.valid).toBe(false)
        expect(result.errors.amount).toBe('请输入大于0的数字')
    })

    it('type=nonNegative 验证应正确工作', () => {
        const result = validateForm({ amount: '-1' }, { amount: { type: 'nonNegative' } })
        expect(result.valid).toBe(false)
        expect(result.errors.amount).toBe('请输入大于或等于0的数字')
    })

    it('type=date 验证应正确工作', () => {
        const result = validateForm({ date: 'invalid' }, { date: { type: 'date' } })
        expect(result.valid).toBe(false)
        expect(result.errors.date).toBe('请输入有效的日期')
    })

    it('min/max 范围验证应正确工作', () => {
        const result1 = validateForm({ age: 5 }, { age: { min: 18 } })
        expect(result1.valid).toBe(false)

        const result2 = validateForm({ age: 100 }, { age: { max: 99 } })
        expect(result2.valid).toBe(false)

        const result3 = validateForm({ age: 50 }, { age: { min: 18, max: 99 } })
        expect(result3.valid).toBe(true)
    })

    it('应支持自定义错误消息', () => {
        const result = validateForm({}, { name: { required: true, message: '名字必填' } })
        expect(result.errors.name).toBe('名字必填')
    })

    it('多条规则应全部验证', () => {
        const result = validateForm(
            { name: '', age: 'abc' },
            {
                name: { required: true },
                age: { type: 'number' }
            }
        )
        expect(result.valid).toBe(false)
        expect(result.errors.name).toBeDefined()
        expect(result.errors.age).toBeDefined()
    })

    it('同时设置 min 和 max 应使用组合验证', () => {
        // 覆盖 line 148: 同时有 min 和 max 且值不在范围内
        const result = validateForm(
            { age: 150 },
            { age: { min: 18, max: 99 } }
        )
        expect(result.valid).toBe(false)
        expect(result.errors.age).toBe(`请输入18到99之间的数字`)
    })

    it('只有 min 且值小于 min 应返回错误', () => {
        // 覆盖 line 150: 只有 min 约束且值太小
        const result = validateForm(
            { age: 5 },
            { age: { min: 18 } }
        )
        expect(result.valid).toBe(false)
        expect(result.errors.age).toBe(`请输入不小于18的数字`)
    })

    it('只有 max 且值大于 max 应返回错误', () => {
        // 覆盖 line 153: 只有 max 约束且值太大
        const result = validateForm(
            { age: 150 },
            { age: { max: 99 } }
        )
        expect(result.valid).toBe(false)
        expect(result.errors.age).toBe(`请输入不大于99的数字`)
    })

    it('isNonNegative 应正确处理非数字值', () => {
        // 覆盖 line 52: isNumber 返回 false 时的 false 分支
        expect(isNonNegative(null)).toBe(false)
        expect(isNonNegative('hello')).toBe(false)
        expect(isNonNegative(NaN)).toBe(false)
    })

    it('validateForm 应正确处理 undefined 规则', () => {
        // 覆盖 line 121: rule 为 falsy 时的 continue 分支
        const result = validateForm(
            { name: 'test' },
            { name: undefined as any }
        )
        expect(result.valid).toBe(true)
    })
})
