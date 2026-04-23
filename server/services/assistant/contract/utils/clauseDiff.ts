import type { ClauseSnapshotItem } from '#shared/types/contract'
import { diff_match_patch } from 'diff-match-patch'

export interface ClauseDiffResult {
    modified: Array<{ oldIndex: number; newIndex: number; similarity: number }>
    added: number[]
    removed: number[]
    unchanged: Array<{ oldIndex: number; newIndex: number }>
}

// 计算两段文本的字符相似度（基于 Levenshtein 距离）
function calcSimilarity(a: string, b: string): number {
    if (a === b) return 1
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) return 1
    const dmp = new diff_match_patch()
    const diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    const distance = dmp.diff_levenshtein(diffs)
    return 1 - distance / maxLen
}

export function diffClauses(
    oldClauses: ClauseSnapshotItem[],
    newClauses: ClauseSnapshotItem[],
    options?: { modifiedThreshold?: number },
): ClauseDiffResult {
    const threshold = options?.modifiedThreshold ?? 0.6
    const result: ClauseDiffResult = { modified: [], added: [], removed: [], unchanged: [] }

    // 记录每个 oldClause 是否被匹配
    const matchedOldIndices = new Set<number>()

    for (let ni = 0; ni < newClauses.length; ni++) {
        const newClause = newClauses[ni]
        if (!newClause) continue
        const newText = newClause.text
        let bestSimilarity = -1
        let bestOldIndex = -1

        for (let oi = 0; oi < oldClauses.length; oi++) {
            // 已被匹配的 old 不再参与竞争
            if (matchedOldIndices.has(oi)) continue
            const oldClause = oldClauses[oi]
            if (!oldClause) continue
            const sim = calcSimilarity(oldClause.text, newText)
            if (sim > bestSimilarity) {
                bestSimilarity = sim
                bestOldIndex = oi
            }
        }

        if (bestOldIndex === -1 || bestSimilarity < threshold) {
            result.added.push(ni)
        } else if (bestSimilarity === 1) {
            result.unchanged.push({ oldIndex: bestOldIndex, newIndex: ni })
            matchedOldIndices.add(bestOldIndex)
        } else {
            result.modified.push({ oldIndex: bestOldIndex, newIndex: ni, similarity: bestSimilarity })
            matchedOldIndices.add(bestOldIndex)
        }
    }

    // 未被匹配的旧条款视为 removed
    for (let oi = 0; oi < oldClauses.length; oi++) {
        if (!matchedOldIndices.has(oi)) {
            result.removed.push(oi)
        }
    }

    return result
}
