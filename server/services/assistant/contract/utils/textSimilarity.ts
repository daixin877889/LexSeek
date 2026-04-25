/**
 * 文本相似度共享工具。
 *
 * clauseDiff / anchorMigrate 之前各自 new diff_match_patch() 计算 Levenshtein，
 * 此处统一一份共享 dmp 实例（fxp 风格的"全局单例 + 纯函数 API"），避免重复造轮子。
 *
 * 注意：dmp 的 diff_main 不是无副作用的（内部用 Match_Threshold / Match_Distance 等
 * 实例属性），但本模块只读不改这些参数，多调用方共享一个实例是安全的。
 */
import { diff_match_patch } from 'diff-match-patch'

const dmp = new diff_match_patch()

export function getDmp(): diff_match_patch {
    return dmp
}

/**
 * 基于 Levenshtein 距离计算两段文本的相似度（0~1）。
 *  - 完全相同返回 1
 *  - 都为空返回 1（无内容差异）
 *  - 否则 1 - distance / maxLen
 */
export function calcSimilarity(a: string, b: string): number {
    if (a === b) return 1
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) return 1
    const diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    const distance = dmp.diff_levenshtein(diffs)
    return 1 - distance / maxLen
}
