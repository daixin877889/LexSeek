import type { ClauseSnapshotItem } from '#shared/types/contract'
import { calcSimilarity, fuzzyLocateInText } from './textSimilarity'

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
 *   1. 先用 fuzzyLocateInText 模糊匹配快速锚定大致位置（O(N) 字符级 fingerprint）
 *   2. 仅在锚定位置 ±100 字符的小窗内做 Levenshtein 精算
 *   3. 锚定失败（fuzzyLocateInText 返回 null）才回落到原全扫
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

    // 性能 fast-path：用 fuzzyLocateInText（封装 dmp.match_main + 单例参数隔离 + 32 字符 Bitap 上限保护）
    // 锚定 anchor 在 clauseText 的近似位置。Match_Threshold/Distance 由 fuzzyLocateInText 内部托管。
    const probe = anchor.slice(0, Math.min(anchorLen, 100))
    const located = clauseText.length >= anchorLen
        ? fuzzyLocateInText(clauseText, probe)
        : null
    const matchLoc = located?.start ?? -1

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

    // fallback：fuzzyLocateInText 失败或精扫窗口为空，全文扫描兜底
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

/**
 * Phase B 锚点迁移 · 双锚点优先级（spec §9.2）
 *
 *  档 1（quote 优先）：用 oldProblematicQuote 在客户新 docx normalizedText 上做 dmp 模糊匹配。
 *      命中后回查 newClauses 找包含命中 offset 的 segment：
 *        - 找到 + quote 完全落在该 segment 内 → 写新 clauseText (= segment.text 全段) + 重摘 quote +
 *          quoteCharStart/End 重算（在新 clauseText 内的相对 offset）
 *        - 跨 segment 边界 → 视为档 1 失败，落入档 2
 *
 *  档 2（clause fallback）：复用既有 migrateAnchor 走 clauseText 模糊匹配（既有 fast-path + 全局扫）。
 *      命中后写新 clauseText (= segment.text 全段) + 清空 quote 字段。
 *
 *  档 3（orphaned）：两档都失败 → 返回 null（调用方置 orphaned=true）。
 *
 *  设计要点：
 *    - clauseText 写入用 segment.text 全段，不再像旧实现那样取 newCharStart..newCharEnd 切片
 *      （旧切片源自单锚点模型，会丢上下文；双锚点下层 1 完整、层 2 精确，clauseText 必须保完整）
 *    - clauseCharStart/End 用 segment.offsetStart/End（文档全文 normalizedText 内的 offset，符合
 *      schema 注释 "clause 在文档全文 normalizedText 里的 offset"）
 *    - quoteMatchSource 由调用方决定（档 1 沿用旧值 / 档 2 置 null），wrapper 不返回该字段
 *    - 短 quote (< 4 字符) 直接跳过档 1：fuzzy 在短串上误命中率高，不如直接走 clauseText
 *    - 长 quote (> 32 字) 命中后做相似度二次校验：dmp Match_MaxBits=32，fuzzyLocateInText 用前 32 字
 *      做 Bitap probe，hit.end = hit.start + pattern.length 是按原长度推算的——hit.end 之外的字符
 *      未参与匹配。生产合同 quote 普遍 30-100 字，必须用 calcSimilarity 把 segment 内切片与原 quote
 *      做 Levenshtein 比对，相似度 < SIMILARITY_THRESHOLD 视为档 1 假阳，落入档 2。
 */
export interface DualAnchorMigrateInput {
    /** 旧 risk 的完整条款原文（档 2 fallback 用） */
    oldClauseText: string
    /** 旧 risk 的精确问题片段（档 1 主路径用；null / 太短 时直接跳过档 1） */
    oldProblematicQuote: string | null
    /** clauseDiff 已识别出的"老条款 → 新条款"映射的 newIndex；无先验时 null */
    preferredNewClauseArrayIdx: number | null
    /** 客户回传 docx 重切的新条款数组（segmentClauses 产出） */
    newClauses: ClauseSnapshotItem[]
    /** 客户回传 docx 全文 normalizedText（档 1 在全文上 fuzzy） */
    newDocxText: string
}

export interface DualAnchorMigrateResult {
    /** 命中档位 */
    matchType: 'quote' | 'clause'
    /** 在 newClauses 数组里的下标（0-based） */
    newClauseArrayIdx: number
    /** 新 clauseText（segment.text 全段，不切片） */
    newClauseText: string
    /** 新 clauseText 在文档全文 normalizedText 内的 offset */
    newClauseCharStart: number
    newClauseCharEnd: number
    /** 仅档 1 有值；档 2 为 null */
    newProblematicQuote: string | null
    /** 在新 clauseText 内的相对 offset；档 2 为 null */
    newQuoteCharStart: number | null
    newQuoteCharEnd: number | null
}

/** quote 字符数太短时跳过档 1 的最小阈值（与 resolveQuoteAnchor 档 2 同口径） */
const MIN_QUOTE_LEN_FOR_TIER1 = 4
/** 档 1 命中后相似度二次校验阈值（与 migrateAnchor 默认 similarityThreshold=0.6 同口径） */
const TIER1_SIMILARITY_THRESHOLD = 0.6

export function migrateRiskWithDualAnchor(input: DualAnchorMigrateInput): DualAnchorMigrateResult | null {
    const { oldClauseText, oldProblematicQuote, preferredNewClauseArrayIdx, newClauses, newDocxText } = input

    if (newClauses.length === 0) return null

    // ===== 档 1：quote 优先 =====
    const quote = oldProblematicQuote?.trim() ?? ''
    if (quote.length >= MIN_QUOTE_LEN_FOR_TIER1 && newDocxText.length > 0) {
        const hit = fuzzyLocateInText(newDocxText, quote)
        if (hit) {
            // 找包含 hit.start 的 segment
            const segIdx = newClauses.findIndex(s => s.offsetStart <= hit.start && hit.start < s.offsetEnd)
            if (segIdx !== -1) {
                const segment = newClauses[segIdx]!
                // 严格校验 quote 完全落在该 segment 内（不跨段）
                if (hit.end <= segment.offsetEnd) {
                    const quoteStartInSegment = hit.start - segment.offsetStart
                    const quoteEndInSegment = hit.end - segment.offsetStart
                    const candidate = segment.text.slice(quoteStartInSegment, quoteEndInSegment)
                    // 长 quote 假阳保护：dmp Match_MaxBits=32，>32 字 quote 用前 32 字 probe，
                    // hit.end 是按原 length 推算（>32 字部分未参与匹配）→ 必须做相似度二次校验。
                    // 短 quote (<=32) 也走这一步是保险（calcSimilarity 单字符比对成本极低）。
                    if (calcSimilarity(quote, candidate) >= TIER1_SIMILARITY_THRESHOLD) {
                        return {
                            matchType: 'quote',
                            newClauseArrayIdx: segIdx,
                            newClauseText: segment.text,
                            newClauseCharStart: segment.offsetStart,
                            newClauseCharEnd: segment.offsetEnd,
                            newProblematicQuote: candidate,
                            newQuoteCharStart: quoteStartInSegment,
                            newQuoteCharEnd: quoteEndInSegment,
                        }
                    }
                    // 相似度未达阈值 → 档 1 假阳，落档 2
                }
            }
        }
    }

    // ===== 档 2：clause fallback（复用 migrateAnchor）=====
    const clauseResult = migrateAnchor({
        oldAnchorQuote: oldClauseText,
        preferredNewClauseArrayIdx,
        newClauses,
    })
    if (clauseResult) {
        const segment = newClauses[clauseResult.newClauseIndex]!
        return {
            matchType: 'clause',
            newClauseArrayIdx: clauseResult.newClauseIndex,
            // 注意：用 segment.text 全段，不用 slice(newCharStart..newCharEnd)
            // ——双锚点模型下 clauseText 是层 1 完整条款，必须保完整上下文
            newClauseText: segment.text,
            newClauseCharStart: segment.offsetStart,
            newClauseCharEnd: segment.offsetEnd,
            newProblematicQuote: null,
            newQuoteCharStart: null,
            newQuoteCharEnd: null,
        }
    }

    // ===== 档 3：orphaned =====
    return null
}
