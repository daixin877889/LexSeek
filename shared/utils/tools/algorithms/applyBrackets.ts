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
    for (const b of brackets) {
        if (amount <= b.upper) {
            if (b.fixed !== undefined) return b.fixed
            return b.base + (amount - b.start) * b.rate
        }
    }
    // 数组定义不完整（缺 Infinity 档）— 不应发生
    throw new Error('applyBrackets: brackets 数组不完整')
}
