import type { ClauseSnapshotItem } from '#shared/types/contract'
import { calcSimilarity, getDmp } from './textSimilarity'

export interface AnchorMigrateResult {
    newClauseIndex: number
    newCharStart: number
    newCharEnd: number
    similarity: number
}

interface MigrateAnchorParams {
    oldAnchorQuote: string
    /**
     * fast-path 优先尝试的新条款数组下标（即 newClauses 中要先看的那一条）。
     *
     * **DOCX-C3 修复**：旧字段名 `oldParagraphIndex` 误把"段落序号"当成
     * newClauses 的数组下标用，造成索引空间错配。
     *   - 调用方有先验信息时（比如 clauseDiff 已经识别出这是 modified.newIndex
     *     条款的内容），传 `modified.newIndex`，让 fast-path 优先在那条条款里搜。
     *   - 调用方没有先验信息时（如纯按 anchorQuote 漂移搜索），传 null，
     *     直接走全局扫描。
     *
     * 不再接受"段落序号"作为输入。
     */
    preferredNewClauseArrayIdx: number | null
    newClauses: ClauseSnapshotItem[]
    similarityThreshold?: number
}

/**
 * 在单条 clause 文本中查找与 anchor 最相似的子串。
 *
 * DOCX-H1 性能优化：旧实现是双层循环 winLen × i 全扫，对长 clauseText（>2000 字）
 * × 长 anchor（>200 字）单条迁移可能跑分钟级。改为：
 *   1. 先用 dmp.match_main 用模糊匹配快速锚定大致位置（O(N) 字符级 fingerprint）
 *   2. 仅在锚定位置 ±100 字符的小窗内做 Levenshtein 精算
 *   3. 锚定失败（match_main 返回 -1）才回落到原全扫
 *
 * 容忍小幅修改（增删字符）+ 大幅截断（截断 < 50% anchor 长度）。
 */
function findBestSubstring(
    clauseText: string,
    anchor: string,
): { charStart: number; charEnd: number; similarity: number } | null {
    const anchorLen = anchor.length
    if (clauseText.length === 0 || anchorLen === 0) return null

    const delta = Math.max(1, Math.floor(anchorLen * 0.25))
    const minWin = Math.max(1, anchorLen - delta)
    const maxWin = Math.min(clauseText.length, anchorLen + delta)

    // 性能 fast-path：用 dmp.match_main 锚定 anchor 在 clauseText 的近似位置
    // Match_Threshold 越小匹配越严格；0.5 默认值已经足够宽容
    const dmp = getDmp()
    const matchLoc = clauseText.length >= anchorLen
        ? dmp.match_main(clauseText, anchor.slice(0, Math.min(anchorLen, 100)), 0)
        : -1

    let bestSim = -1
    let bestStart = 0
    let bestEnd = 0

    if (matchLoc >= 0) {
        // 在 matchLoc ± 100 字符的小窗内精扫
        const windowMargin = 100
        const startLo = Math.max(0, matchLoc - windowMargin)
        const startHi = Math.min(clauseText.length - minWin, matchLoc + windowMargin)
        for (let winLen = minWin; winLen <= maxWin; winLen++) {
            for (let i = startLo; i <= startHi; i++) {
                if (i + winLen > clauseText.length) break
                const window = clauseText.slice(i, i + winLen)
                const sim = calcSimilarity(anchor, window)
                if (sim > bestSim) {
                    bestSim = sim
                    bestStart = i
                    bestEnd = i + winLen
                }
            }
        }
        if (bestSim >= 0) {
            return { charStart: bestStart, charEnd: bestEnd, similarity: bestSim }
        }
    }

    // fallback：match_main 失败或精扫窗口为空，全文扫描兜底
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
    const { oldAnchorQuote, preferredNewClauseArrayIdx, newClauses, similarityThreshold = 0.6 } = params

    if (!oldAnchorQuote || newClauses.length === 0) return null

    // fast-path：调用方已知"这条 risk 应该落在新 clauses[preferredIdx] 上"时优先扫该条
    if (preferredNewClauseArrayIdx !== null) {
        const sameClause = newClauses[preferredNewClauseArrayIdx]
        if (sameClause) {
            const match = findBestSubstring(sameClause.text, oldAnchorQuote)
            if (match && match.similarity >= similarityThreshold) {
                return {
                    newClauseIndex: preferredNewClauseArrayIdx,
                    newCharStart: match.charStart,
                    newCharEnd: match.charEnd,
                    similarity: match.similarity,
                }
            }
        }
    }

    // 全局扫描所有条款（fast-path 未命中或调用方没有先验信息时）
    let globalBestSim = -1
    let globalBestResult: AnchorMigrateResult | null = null

    for (let i = 0; i < newClauses.length; i++) {
        if (i === preferredNewClauseArrayIdx) continue // 已在 fast-path 试过
        const clause = newClauses[i]
        if (!clause) continue
        const match = findBestSubstring(clause.text, oldAnchorQuote)
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
