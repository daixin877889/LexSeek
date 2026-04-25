import type { ClauseSnapshotItem } from '#shared/types/contract'
import { calcSimilarity } from './textSimilarity'

export interface ClauseDiffResult {
    modified: Array<{ oldIndex: number; newIndex: number; similarity: number }>
    added: number[]
    removed: number[]
    unchanged: Array<{ oldIndex: number; newIndex: number }>
}

/**
 * 条款级 diff（DOCX-H2 全局排序版）。
 *
 * 旧实现按 newIndex 顺序贪心：每个新条款独占当前最相似的旧条款，
 * 一旦旧条款被低相似度先抢走，后续高相似度的真正配对就无法成立。
 * 典型踩坑：删第 1 条 + 改第 3 条时，新第 2 条可能 0.65 相似度抢走旧第 1 条，
 * 让旧第 3 条变成 removed、新第 3 条变成 added，触发 anchorMigrate 全局漂移。
 *
 * 全局排序版：
 *   1. 计算所有 (oi, ni) 配对的相似度矩阵（仅当 ≥ threshold 时入候选）
 *   2. 按相似度降序排序，贪心配对（最优先的对优先锁），双方各只配一次
 *   3. 剩余未匹配的旧/新分别归 removed / added
 *
 * 不是完美 Hungarian 但已能极大改善"先到先匹配"的错误。complexity O(N*M log NM)。
 *
 * DOCX-R3：calcSimilarity 已抽到 utils/textSimilarity.ts 共享 dmp 实例。
 */
export function diffClauses(
    oldClauses: ClauseSnapshotItem[],
    newClauses: ClauseSnapshotItem[],
    options?: { modifiedThreshold?: number },
): ClauseDiffResult {
    const threshold = options?.modifiedThreshold ?? 0.6
    const result: ClauseDiffResult = { modified: [], added: [], removed: [], unchanged: [] }

    // 收集 ≥ threshold 的所有 (oi, ni, sim) 候选
    const candidates: Array<{ oi: number; ni: number; sim: number }> = []
    for (let oi = 0; oi < oldClauses.length; oi++) {
        const oldClause = oldClauses[oi]
        if (!oldClause) continue
        for (let ni = 0; ni < newClauses.length; ni++) {
            const newClause = newClauses[ni]
            if (!newClause) continue
            const sim = calcSimilarity(oldClause.text, newClause.text)
            if (sim >= threshold) candidates.push({ oi, ni, sim })
        }
    }

    // 按相似度降序贪心配对
    candidates.sort((a, b) => b.sim - a.sim)
    const matchedOld = new Set<number>()
    const matchedNew = new Set<number>()
    for (const c of candidates) {
        if (matchedOld.has(c.oi) || matchedNew.has(c.ni)) continue
        matchedOld.add(c.oi)
        matchedNew.add(c.ni)
        if (c.sim === 1) {
            result.unchanged.push({ oldIndex: c.oi, newIndex: c.ni })
        } else {
            result.modified.push({ oldIndex: c.oi, newIndex: c.ni, similarity: c.sim })
        }
    }

    // 未匹配的旧条款 → removed；未匹配的新条款 → added
    for (let oi = 0; oi < oldClauses.length; oi++) {
        if (!matchedOld.has(oi)) result.removed.push(oi)
    }
    for (let ni = 0; ni < newClauses.length; ni++) {
        if (!matchedNew.has(ni)) result.added.push(ni)
    }

    return result
}
