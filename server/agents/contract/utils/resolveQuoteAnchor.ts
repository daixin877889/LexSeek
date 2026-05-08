/**
 * 路线 2 服务端解析（spec §5.3.2）：把 LLM 输出的 problemSentenceIds + problematicQuote
 * 解析为在 clauseText 内的相对 (charStart, charEnd) + 命中来源。
 *
 * 三档 fallback：
 *  - 档 1：sentence_id 主路径（deterministic）。validIds 为空时 fall through
 *  - 档 2：fuzzy match（dmp Bitap）。problematicQuote.length < 4 时跳过（误命中风险高）
 *  - 档 3：全失败降级。`problematicQuote: null` UI 退回到 clauseText 段落级显示
 */
import { fuzzyLocateInText } from './textSimilarity'
import type { SentenceSpan } from './splitSentences'

export interface QuoteAnchorResult {
    /** 精确问题片段；null = 三档全失败降级 */
    problematicQuote: string | null
    /** 在 clauseText 内的相对 offset（不是文档全文 offset）；null 时 quote 也为 null */
    charStart: number | null
    charEnd: number | null
    /** 命中来源（运维 quote_match_source 字段对齐） */
    matchSource: 'sentence_id' | 'fuzzy' | 'fallback'
}

export interface ResolveQuoteAnchorInput {
    /** 完整条款原文（segmentClauses 产出的 segment.text） */
    clauseText: string
    /** splitSentences(clauseText) 的产物，1-based id */
    sentences: SentenceSpan[]
    /** LLM 输出（RISK_SHAPE 提取的两个 quote 相关字段） */
    aiOutput: {
        problemSentenceIds?: number[]
        problematicQuote?: string
    }
}

const MIN_FUZZY_QUOTE_LENGTH = 4

export function resolveQuoteAnchor(input: ResolveQuoteAnchorInput): QuoteAnchorResult {
    // 档 1：sentence_id 主路径（deterministic）
    const ids = input.aiOutput.problemSentenceIds
    if (ids && ids.length > 0) {
        const validIds = ids.filter(id => id >= 1 && id <= input.sentences.length)
        if (validIds.length > 0) {
            const minId = Math.min(...validIds)
            const maxId = Math.max(...validIds)
            const startSentence = input.sentences[minId - 1]!
            const endSentence = input.sentences[maxId - 1]!
            const charStart = startSentence.charStart
            const charEnd = endSentence.charEnd
            const quote = input.clauseText.slice(charStart, charEnd).trim()
            return { problematicQuote: quote, charStart, charEnd, matchSource: 'sentence_id' }
        }
    }

    // 档 2：fuzzy match fallback（不归一化；offset 直接对齐原文）
    const quote = input.aiOutput.problematicQuote?.trim()
    if (quote && quote.length >= MIN_FUZZY_QUOTE_LENGTH) {
        const offset = fuzzyLocateInText(input.clauseText, quote)
        if (offset !== null) {
            return {
                problematicQuote: input.clauseText.slice(offset.start, offset.end),
                charStart: offset.start,
                charEnd: offset.end,
                matchSource: 'fuzzy',
            }
        }
    }

    // 档 3：全失败降级（UI 退回到 clauseText 段落级显示，与现状视觉一致）
    return { problematicQuote: null, charStart: null, charEnd: null, matchSource: 'fallback' }
}
