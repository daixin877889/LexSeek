import type { FormValidationRule, FormValidationRules, FormValidationResult } from '@/types/tools'

/**
 * 验证是否为空
 * @param value 需要验证的值
 * @returns 是否为空
 */
export function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string' && value.trim() === '') return true
    if (Array.isArray(value) && value.length === 0) return true
    if (typeof value === 'object' && Object.keys(value as object).length === 0) return true
    return false
}

/**
 * 验证是否为数字(可以是字符串形式的数字)
 * @param value 需要验证的值
 * @returns 是否为数字
 */
export function isNumber(value: unknown): boolean {
    if (isEmpty(value)) return false
    return !isNaN(parseFloat(String(value))) && isFinite(Number(value))
}

/**
 * 验证是否为整数
 * @param value 需要验证的值
 * @returns 是否为整数
 */
export function isInteger(value: unknown): boolean {
    if (!isNumber(value)) return false
    return Number.isInteger(Number(value))
}

/**
 * 验证是否为正数
 * @param value 需要验证的值
 * @returns 是否为正数
 */
export function isPositive(value: unknown): boolean {
    if (!isNumber(value)) return false
    return Number(value) > 0
}

/**
 * 验证是否为非负数
 * @param value 需要验证的值
 * @returns 是否为非负数
 */
export function isNonNegative(value: unknown): boolean {
    if (!isNumber(value)) return false
    return Number(value) >= 0
}

/**
 * 验证是否在最小值和最大值之间
 * @param value 需要验证的值
 * @param min 最小值
 * @param max 最大值
 * @returns 是否在范围内
 */
export function isInRange(value: unknown, min?: number, max?: number): boolean {
    if (!isNumber(value)) return false
    const num = Number(value)
    if (min !== undefined && isNumber(min) && num < min) return false
    if (max !== undefined && isNumber(max) && num > max) return false
    return true
}

/**
 * 验证日期格式是否正确(YYYY-MM-DD)
 * @param value 需要验证的日期字符串
 * @returns 是否为有效日期
 */
export function isValidDate(value: unknown): boolean {
    if (isEmpty(value)) return false

    const strValue = String(value)

    // 检查格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(strValue)) return false

    // 检查日期有效性
    const date = new Date(strValue)
    if (isNaN(date.getTime())) return false

    // 检查月份和日期的范围
    const [year, month, day] = strValue.split('-').map(Number)

    if (month < 1 || month > 12) return false

    const lastDayOfMonth = new Date(year, month, 0).getDate()
    if (day < 1 || day > lastDayOfMonth) return false

    return true
}

/**
 * 表单验证结果
 * @param form 表单对象
 * @param rules 验证规则
 * @returns 验证结果: {valid: 是否全部通过, errors: 错误信息}
 */
export function validateForm(form: Record<string, unknown>, rules: FormValidationRules): FormValidationResult {
    const errors: Record<string, string> = {}
    let valid = true

    for (const key in rules) {
        const value = form[key]
        const rule = rules[key]

        if (rule.required && isEmpty(value)) {
            errors[key] = rule.message || '此项不能为空'
            valid = false
            continue
        }

        if (!isEmpty(value)) {
            if (rule.type === 'number' && !isNumber(value)) {
                errors[key] = rule.message || '请输入有效的数字'
                valid = false
            } else if (rule.type === 'integer' && !isInteger(value)) {
                errors[key] = rule.message || '请输入有效的整数'
                valid = false
            } else if (rule.type === 'positive' && !isPositive(value)) {
                errors[key] = rule.message || '请输入大于0的数字'
                valid = false
            } else if (rule.type === 'nonNegative' && !isNonNegative(value)) {
                errors[key] = rule.message || '请输入大于或等于0的数字'
                valid = false
            } else if (rule.type === 'date' && !isValidDate(value)) {
                errors[key] = rule.message || '请输入有效的日期'
                valid = false
            }

            if (rule.min !== undefined && rule.max !== undefined && !isInRange(value, rule.min, rule.max)) {
                errors[key] = rule.message || `请输入${rule.min}到${rule.max}之间的数字`
                valid = false
            } else if (rule.min !== undefined && Number(value) < rule.min) {
                errors[key] = rule.message || `请输入不小于${rule.min}的数字`
                valid = false
            } else if (rule.max !== undefined && Number(value) > rule.max) {
                errors[key] = rule.message || `请输入不大于${rule.max}的数字`
                valid = false
            }
        }
    }

    return { valid, errors }
}
