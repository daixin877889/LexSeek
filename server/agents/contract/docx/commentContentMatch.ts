/**
 * 把回传 docx 的批注按正文内容匹配到系统库的批注。
 *
 * 为什么不靠批注编号：Microsoft Word 重存 docx 会重排批注 w:id，导出时写入
 * 身份证的 wId 与回传 docx 实际编号对不上。批注正文内容 Word 不改（除非用户
 * 手动编辑），据此匹配最稳（spec §5）。
 */
import { normalizeForMatch, calcSimilarity } from '../utils/textSimilarity'

/** 参与匹配的回传批注（最小字段） */
export interface CommentForMatch {
    wId: number
    content: string
}

/** 参与匹配的系统批注（最小字段） */
export interface AnnotationForMatch {
    id: number
    content: string
}

/** 模糊匹配相似度阈值：低于此值不认定匹配 */
export const CONTENT_MATCH_FUZZY_THRESHOLD = 0.85
/** 模糊匹配时最高分与次高分的最小差距：拉不开则视为歧义，不匹配 */
export const CONTENT_MATCH_MIN_GAP = 0.05

/**
 * 把每条回传批注匹配到一条系统批注。
 *
 * 匹配口径（spec §5）：
 *  - 一级 exact：normalizeForMatch 归一化后完全相等（消除 Word 把换行压成空格等差异）。
 *  - 二级 fuzzy：无 exact 命中时，calcSimilarity 取最高分；分数 ≥ 阈值、且与次高分
 *    拉开 ≥ CONTENT_MATCH_MIN_GAP 才认定；否则视为歧义不匹配。
 *  - 用完整 content 比对（AI 批注通常数百字，唯一性强）。
 *
 * @returns Map<回传批注 wId, 命中的系统批注 id>；未命中的批注不在 Map 中。
 *          允许多条回传批注命中同一系统批注（由上层 collided 逻辑处理）。
 */
export function matchCommentsToAnnotations(
    comments: CommentForMatch[],
    annotations: AnnotationForMatch[],
): Map<number, number> {
    const annNorm = annotations.map(a => ({ id: a.id, norm: normalizeForMatch(a.content) }))
    const result = new Map<number, number>()
    for (const c of comments) {
        const cNorm = normalizeForMatch(c.content)
        if (!cNorm) continue
        // 一级：exact
        const exact = annNorm.filter(a => a.norm === cNorm)
        if (exact.length === 1) { result.set(c.wId, exact[0]!.id); continue }
        if (exact.length > 1) continue // 多条系统批注内容完全相同，无法区分
        // 二级：fuzzy
        let bestId = -1
        let bestScore = 0
        let runnerUp = 0
        for (const a of annNorm) {
            const s = calcSimilarity(cNorm, a.norm)
            if (s > bestScore) { runnerUp = bestScore; bestScore = s; bestId = a.id }
            else if (s > runnerUp) { runnerUp = s }
        }
        if (bestId !== -1 && bestScore >= CONTENT_MATCH_FUZZY_THRESHOLD
            && bestScore - runnerUp >= CONTENT_MATCH_MIN_GAP) {
            result.set(c.wId, bestId)
        }
    }
    return result
}
