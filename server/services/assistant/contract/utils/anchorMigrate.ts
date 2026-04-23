import type { ClauseSnapshotItem } from '#shared/types/contract'
import { diff_match_patch } from 'diff-match-patch'

export interface AnchorMigrateResult {
    newClauseIndex: number
    newCharStart: number
    newCharEnd: number
    similarity: number
}

interface MigrateAnchorParams {
    oldAnchorQuote: string
    oldParagraphIndex: number
    newClauses: ClauseSnapshotItem[]
    similarityThreshold?: number
}

const dmp = new diff_match_patch()

// 计算两段字符串的相似度（Levenshtein）
function calcSimilarity(a: string, b: string): number {
    if (a === b) return 1
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) return 1
    const diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    const distance = dmp.diff_levenshtein(diffs)
    return 1 - distance / maxLen
}

// 在单条 clause 文本中滑动查找与 anchor 最相似的子串
// 窗口长度围绕 anchorLen 做 ±25% 扩展，兼顾增删字符的情况
function findBestSubstring(
    clauseText: string,
    anchor: string,
): { charStart: number; charEnd: number; similarity: number } | null {
    const anchorLen = anchor.length
    if (clauseText.length === 0 || anchorLen === 0) return null

    const delta = Math.max(1, Math.floor(anchorLen * 0.25))
    const minWin = Math.max(1, anchorLen - delta)
    const maxWin = Math.min(clauseText.length, anchorLen + delta)

    let bestSim = -1
    let bestStart = 0
    let bestEnd = 0

    for (let winLen = minWin; winLen <= maxWin; winLen++) {
        for (let i = 0; i <= clauseText.length - winLen; i++) {
            const window = clauseText.slice(i, i + winLen)
            const sim = calcSimilarity(anchor, window)
            if (sim > bestSim) {
                bestSim = sim
                bestStart = i
                bestEnd = i + winLen
            }
        }
    }

    if (bestSim < 0) return null
    return { charStart: bestStart, charEnd: bestEnd, similarity: bestSim }
}

export function migrateAnchor(params: MigrateAnchorParams): AnchorMigrateResult | null {
    const { oldAnchorQuote, oldParagraphIndex, newClauses, similarityThreshold = 0.6 } = params

    if (!oldAnchorQuote || newClauses.length === 0) return null

    // 先在同 index 的条款里查找
    const sameClause = newClauses[oldParagraphIndex]
    if (sameClause) {
        const match = findBestSubstring(sameClause.text, oldAnchorQuote)
        if (match && match.similarity >= similarityThreshold) {
            return {
                newClauseIndex: oldParagraphIndex,
                newCharStart: match.charStart,
                newCharEnd: match.charEnd,
                similarity: match.similarity,
            }
        }
    }

    // 全局扫描其余条款
    let globalBestSim = -1
    let globalBestResult: AnchorMigrateResult | null = null

    for (let i = 0; i < newClauses.length; i++) {
        if (i === oldParagraphIndex) continue
        const match = findBestSubstring(newClauses[i].text, oldAnchorQuote)
        if (match && match.similarity > globalBestSim) {
            globalBestSim = match.similarity
            globalBestResult = {
                newClauseIndex: i,
                newCharStart: match.charStart,
                newCharEnd: match.charEnd,
                similarity: match.similarity,
            }
        }
    }

    if (globalBestResult && globalBestSim >= similarityThreshold) {
        return globalBestResult
    }

    return null
}
