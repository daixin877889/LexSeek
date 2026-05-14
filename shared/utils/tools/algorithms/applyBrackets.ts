/**
 * 通用阶梯累进公式
 *
 * 用于：诉讼费 / 律师费 / 仲裁费 等"按金额分段累进收费"场景。
 */

export interface Bracket {
    /** 档位上限（含），最后一档传 Infinity */
    upper: number
    /** 本档费率（百分比小数） */
    rate: number
    /** 本档起点（与上一档 upper 衔接），首档传 0 */
    start: number
    /** 累加基数（前面所有档位算到 start 时的金额） */
    base: number
    /** 定额费（如有 fixed，会忽略 base+rate，直接返回 fixed） */
    fixed?: number
}

export function applyBrackets(amount: number, brackets: readonly Bracket[]): number {
    if (amount <= 0) return 0
    // brackets 数组契约：末档 upper=Infinity，保证 find 必有命中
    const matched = brackets.find(b => amount <= b.upper)!
    if (matched.fixed !== undefined) return matched.fixed
    return matched.base + (amount - matched.start) * matched.rate
}
