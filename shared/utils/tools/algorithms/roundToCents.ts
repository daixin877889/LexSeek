import Decimal from 'decimal.js'

/**
 * 把任意数四舍五入到分（2 位小数），用 Decimal.js 避免浮点误差。
 */
export function roundToCents(value: number | string): number {
    return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}
