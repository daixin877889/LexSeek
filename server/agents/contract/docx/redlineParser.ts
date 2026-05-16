/**
 * 修订标记回传解析与处置判定（spec §6）。
 *
 * - parseRedlineMarks（Task 9）：从回传 docx 读 redlineRefs.xml + 存活 ins/del id + 按非空段落的正文语料。
 * - resolveCorpusForRef（Task 9）：按 redlineRefs 的 paraIdxs 取该风险所属段落的语料。
 * - classifyRedlineDecision：双层算法判定单条修订被客户接受/拒绝/未处理/需确认。
 */
import { normalizeForMatch } from '../utils/textSimilarity'
import { ClientRedlineDecision } from '#shared/types/contract'

/** redlineRefs.xml 里一条 <ref> 的解析结果 */
export interface RedlineRefEntry {
    riskId: number
    delIds: number[]
    insId: number
    /** 该修订所跨非空段落序号（回传识别据此把比对限定在风险所属段落，spec §6.2） */
    paraIdxs: number[]
}

export interface ClassifyRedlineInput {
    ref: RedlineRefEntry
    /** 回传 docx 仍存活的 <w:ins> w:id */
    survivingInsIds: Set<number>
    /** 回传 docx 仍存活的 <w:del> w:id */
    survivingDelIds: Set<number>
    /** 该风险所属段落的 <w:t> 语料，已 normalizeForMatch 归一化（见 resolveCorpusForRef） */
    corpusT: string
    /** 该风险所属段落的 <w:delText> 语料，已 normalizeForMatch 归一化 */
    corpusDel: string
    /** 风险 DB 字段（原始值，函数内部归一化） */
    problematicQuote: string
    suggestedClauseText: string
}

/**
 * 双层判定（spec §6.2）。
 * Layer 1（w:id）：全部存活→未处理；部分存活→需确认；全不存活→转 Layer 2。
 * Layer 2（正文）：corpusDel 含原文→未处理；否则按 old/new 子串包含关系选判别字段定接受/拒绝。
 */
export function classifyRedlineDecision(input: ClassifyRedlineInput): ClientRedlineDecision {
    const { ref, survivingInsIds, survivingDelIds, corpusT, corpusDel } = input
    const oldText = normalizeForMatch(input.problematicQuote)
    const newText = normalizeForMatch(input.suggestedClauseText)
    // 防御：redlineRefs 风险理论上 old/new 必非空且不等
    if (!oldText || !newText || oldText === newText) return ClientRedlineDecision.AMBIGUOUS

    // ===== Layer 1：w:id 精确层 =====
    const delAllAlive = ref.delIds.length > 0 && ref.delIds.every(id => survivingDelIds.has(id))
    const delNoneAlive = ref.delIds.every(id => !survivingDelIds.has(id))
    const insAlive = survivingInsIds.has(ref.insId)
    if (delAllAlive && insAlive) return ClientRedlineDecision.UNTOUCHED
    if (!(delNoneAlive && !insAlive)) return ClientRedlineDecision.AMBIGUOUS // 部分存活

    // ===== Layer 2：正文比对层 =====
    if (corpusDel.includes(oldText)) return ClientRedlineDecision.UNTOUCHED

    const newInT = corpusT.includes(newText)
    const oldInT = corpusT.includes(oldText)

    if (newText.includes(oldText)) {
        // new 含 old（扩写）
        if (newInT) return ClientRedlineDecision.ACCEPTED
        if (oldInT) return ClientRedlineDecision.REJECTED
        return ClientRedlineDecision.AMBIGUOUS
    }
    if (oldText.includes(newText)) {
        // old 含 new（删减）
        if (oldInT) return ClientRedlineDecision.REJECTED
        if (newInT) return ClientRedlineDecision.ACCEPTED
        return ClientRedlineDecision.AMBIGUOUS
    }
    // 互不包含（实质重写）
    if (newInT && !oldInT) return ClientRedlineDecision.ACCEPTED
    if (oldInT && !newInT) return ClientRedlineDecision.REJECTED
    return ClientRedlineDecision.AMBIGUOUS
}
