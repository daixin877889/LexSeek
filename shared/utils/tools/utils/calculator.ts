/**
 * 格式化数字为货币格式
 * @param num 数字
 * @param decimals 小数位数
 * @param dec 小数点符号
 * @param thou 千分位符号
 * @returns 格式化后的字符串
 */
export function formatCurrency(num: number | null | undefined, decimals: number = 2, dec: string = '.', thou: string = ','): string {
    if (num === null || num === undefined || isNaN(num)) return '0'

    const numStr = parseFloat(String(num)).toFixed(decimals)

    const parts = numStr.split('.')
    if (parts[0]) {
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thou)
    }

    return parts.join(dec)
}

/**
 * 计算利息
 * @param principal 本金
 * @param rate 年利率(%)
 * @param days 天数
 * @param yearDays 一年天数(360或365)
 * @returns 利息
 */
export function calculateInterest(principal: number, rate: number, days: number, yearDays: number = 365): number {
    return (principal * rate / 100 / yearDays) * days
}

/**
 * 数字转中文大写金额
 * @param num 数字
 * @returns 中文大写金额
 */
export function numberToChinese(num: number | null | undefined): string {
    if (num === null || num === undefined || isNaN(num)) return '零元整'

    const fraction = ['角', '分']
    const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
    const unit: string[][] = [
        ['元', '万', '亿'],
        ['', '拾', '佰', '仟']
    ]

    const numStr = Math.abs(num).toFixed(2)
    let result = ''

    // 处理小数部分
    if (numStr.indexOf('.') > 0) {
        const decimalPart = numStr.split('.')[1] ?? ''
        if (decimalPart !== '00') {
            for (let i = 0; i < decimalPart.length; i++) {
                const n = parseInt(decimalPart.charAt(i))
                if (n !== 0) {
                    result += (digit[n] ?? '') + (fraction[i] ?? '')
                }
            }
        }
    }

    // 处理整数部分
    const intPart = parseInt(numStr).toString()
    if (intPart === '0') {
        result = '零元' + result
    } else {
        const intLength = intPart.length
        for (let i = 0; i < intLength; i++) {
            const n = parseInt(intPart.charAt(i))
            const p = intLength - i - 1
            const q = Math.floor(p / 4)
            const m = p % 4
            if (n === 0) {
                if (m !== 0 || (i > 0 && intPart.charAt(i - 1) !== '0')) {
                    result += digit[n] ?? ''
                }
            } else {
                result += (digit[n] ?? '') + (unit[1]?.[m] ?? '')
            }
            if (m === 0 && q > 0) {
                result += unit[0]?.[q] ?? ''
            }
        }
        result += '元' + (result.endsWith('元') || result.indexOf('角') >= 0 || result.indexOf('分') >= 0 ? '' : '整')
    }

    return result
}
