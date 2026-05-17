/**
 * "条款序号 → 非空段落序号" 映射工具。
 *
 * 历史 anchor 空间错配 bug 根因：
 * - 写入端（agent / uploadClientVersion Step 4）一直把 segmentClauses 产出的
 *   `clauseIndex`（条款数组下标）当作 `anchorParagraphIndex` 写入 DB。
 * - 导出端（commentInjector / parseWordComments / rebuildDocxService）期望的是
 *   "非空段落序号"——即 mammoth 解析出的 paragraphs 数组下标。
 * 两个空间不同（含表格 / 标题的合同里 paragraphs.length ≫ segments.length），
 * 结果所有批注挂错段。
 *
 * 此模块统一映射逻辑：写入端在落库前把 clauseIndex 映射到段落空间。
 * contractReviewMainAgent.persistRisksAndCreateV1Snapshot / uploadClientVersion
 * 的 Step 4 都必须复用此函数，避免再次复发。
 *
 * 规则：`fullText = paragraphs.join('\n')`；每段落 i 在 fullText 里的起始偏移
 * = Σ(paragraphs[0..i-1].length) + i（i 个 '\n' 分隔符）。
 * segment.offsetStart 落在 [start_i, end_i] 内 → 条款归属第 i 段。
 *
 * 越界（offset >= 全文长度）兜底到 paragraphs.length-1，避免
 * anchorParagraphIndex 为 null 让批注丢失。
 */
import type { ClauseSegment, ClauseSnapshotItem } from '#shared/types/contract'

export function buildClauseToParagraphMap(
    segments: ReadonlyArray<ClauseSegment | ClauseSnapshotItem>,
    paragraphs: string[],
): Map<number, number> {
    const map = new Map<number, number>()
    if (segments.length === 0 || paragraphs.length === 0) return map

    // 预计算每段起始偏移；fullTextLen 标记最后一段 end 之外的越界阈值
    const paragraphStarts: number[] = []
    let cursor = 0
    for (const p of paragraphs) {
        paragraphStarts.push(cursor)
        cursor += p.length + 1 // +1 for '\n'
    }
    const fullTextLen = cursor
    const lastIndex = paragraphs.length - 1

    for (const seg of segments) {
        const offset = seg.offsetStart
        // 越界检测：offset 超过最后一段 end → 兜底到最后段
        if (offset >= fullTextLen) {
            map.set(seg.index, lastIndex)
            continue
        }
        // 二分找最大的 paragraphStarts[i] <= offset
        let lo = 0
        let hi = paragraphStarts.length - 1
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2)
            if (paragraphStarts[mid]! <= offset) lo = mid
            else hi = mid - 1
        }
        map.set(seg.index, lo)
    }
    return map
}

/**
 * M8：把条款序号映射到「批注注入口径」的 body 直接段落序号。
 *
 * buildClauseToParagraphMap 产出的是「分析口径」段落序号（递归含表格内段落），而
 * commentInjector / parseWordComments 期望的是 collectNonEmptyParagraphs 口径（仅
 * body 直接子 <w:p>）。两口径在含表格合同上不一致——本函数经 parseContractDocx 产出的
 * `bodyParagraphIndex` 把分析口径序号换算成注入口径序号。
 *
 * 条款落在表格等容器内时映射为 `null`：这类条款的批注无法注入 docx（与 global_review
 * 风险同口径，rebuildDocx 注入时按 null 过滤），但风险本身仍在工作区清单中展示。
 *
 * 首次审查（contractReviewMainAgent）与回传增量审查（uploadClientVersion）均须复用
 * 本函数写 `clauseParagraphIndex`，保证两条链路落库口径一致。
 */
export function buildClauseToBodyParagraphMap(
    segments: ReadonlyArray<ClauseSegment | ClauseSnapshotItem>,
    paragraphs: string[],
    bodyParagraphIndex: ReadonlyArray<number | null>,
): Map<number, number | null> {
    const analysisMap = buildClauseToParagraphMap(segments, paragraphs)
    const result = new Map<number, number | null>()
    for (const [segIndex, recursiveIdx] of analysisMap) {
        result.set(segIndex, bodyParagraphIndex[recursiveIdx] ?? null)
    }
    return result
}
