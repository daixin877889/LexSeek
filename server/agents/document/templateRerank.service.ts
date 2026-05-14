/**
 * 文书模板 rerank Service
 *
 * 粗筛召回（templateRecommend.service）后由 LLM 基于【案件上下文 + 用户最新一句话】
 * 重新排序，返回 top N。失败 / 超时 / 编造 id / 输出空 全部 fallback 回粗筛顺序。
 *
 * 调用骨架（createChatModel + withStructuredOutput + Zod schema）参考：
 *   server/services/retrieval/intentClassifier.service.ts
 *
 * @see docs/superpowers/plans/2026-05-14-document-template-llm-rerank.md
 */

// ==================== 类型 ====================

export interface TemplateCandidate {
    id: number
    name: string
    category: string
    description: string | null
    /** 用户最近 30 天用过 */
    recentlyUsed: boolean
}

export interface RerankInput {
    userId: number
    /** 案件 ID，无案件场景（独立草稿）可缺省 */
    caseId?: number | null
    sessionId: string
    /** 用户最新一句话（rerank LLM 的核心信号） */
    userQuery: string
    /** LLM 在粗筛阶段抽出的意图（仅作上下文参考） */
    intent: string
    /** 待 rerank 的候选 */
    candidates: TemplateCandidate[]
    /** 最终输出条数（默认 5） */
    topN?: number
    /** rerank LLM 调用超时（默认 15000 ms） */
    timeoutMs?: number
}

export interface RerankPick {
    templateId: number
    /** LLM 给的简短理由（可选） */
    reason?: string
}

export type RerankFallbackReason =
    | 'timeout'
    | 'llm_error'
    | 'empty_output'
    | 'not_enough_valid_ids'

export interface RerankResult {
    picks: RerankPick[]
    /** 是否走了 fallback 路径（任意一种失败/降级） */
    fallback: boolean
    fallbackReason?: RerankFallbackReason
}

// ==================== 主入口 ====================

export async function rerankTemplatesService(input: RerankInput): Promise<RerankResult> {
    const { candidates, topN = 5 } = input

    // 1. 空候选 → 直接返回（不调 LLM）
    if (candidates.length === 0) {
        return { picks: [], fallback: false }
    }

    // 2. 候选数 ≤ topN → 全量返回（不需要 rerank）
    if (candidates.length <= topN) {
        return {
            picks: candidates.map(c => ({ templateId: c.id })),
            fallback: false,
        }
    }

    // 3. TODO（Task 3-5）：调 LLM rerank
    throw new Error('rerankTemplatesService: LLM rerank 未实现（Task 3-5 落地）')
}
