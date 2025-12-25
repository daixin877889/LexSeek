import { Prisma } from "#shared/types/prisma"

/**
 * 将 Prisma Decimal 转换为数字
 * Prisma 返回的 Decimal 是一个特殊对象
 * 
 * Decimal.js 内部结构:
 * - s: 符号 (1 或 -1)
 * - e: 指数 (10的幂次)
 * - d: 数字数组，每个元素最多7位数字
 */
export function decimalToNumberUtils(decimal: Prisma.Decimal | null | undefined): number {
    // 处理空值
    if (decimal === null || decimal === undefined) {
        return 0
    }

    // 如果有 toNumber 方法，直接调用
    if (typeof (decimal as any).toNumber === 'function') {
        return (decimal as any).toNumber()
    }

    // 如果已经是数字，直接返回
    if (typeof decimal === 'number') {
        return decimal
    }

    // 如果是字符串，尝试解析
    if (typeof decimal === 'string') {
        return parseFloat(decimal) || 0
    }

    // 如果是 Decimal 内部结构 {s, e, d}，手动计算
    const decimalObj = decimal as { s?: number; e?: number; d?: number[] }
    if (decimalObj.d && Array.isArray(decimalObj.d)) {
        const sign = decimalObj.s ?? 1
        const exponent = decimalObj.e ?? 0
        const digits = decimalObj.d

        // Decimal.js 的 d 数组每个元素最多存储 7 位数字
        // 例如: 67072 存储为 { s: 1, e: 4, d: [67072] }
        // 表示 6.7072 * 10^4 = 67072

        // 将数字数组转换为字符串
        let numStr = ''
        for (let i = 0; i < digits.length; i++) {
            const digit = digits[i]
            if (digit === undefined) continue
            const digitStr = digit.toString()
            // 第一个数字不需要补零，后续数字需要补足7位
            if (i === 0) {
                numStr += digitStr
            } else {
                numStr += digitStr.padStart(7, '0')
            }
        }

        // 计算小数点位置
        // e 表示第一个有效数字后面有多少位整数部分
        // 例如 e=4 表示 xxxxx.xxx 形式，整数部分有 e+1=5 位
        const integerDigits = exponent + 1

        if (integerDigits >= numStr.length) {
            // 全是整数部分，可能需要补零
            numStr = numStr + '0'.repeat(integerDigits - numStr.length)
        } else if (integerDigits > 0) {
            // 有整数和小数部分
            numStr = numStr.slice(0, integerDigits) + '.' + numStr.slice(integerDigits)
        } else {
            // 全是小数部分，需要在前面补零
            numStr = '0.' + '0'.repeat(-integerDigits) + numStr
        }

        return sign * parseFloat(numStr)
    }

    // 兜底：尝试 Number 转换
    return Number(decimal) || 0
}