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

import { z } from 'zod'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

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

// ==================== LLM 调用主路径 ====================

const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

const RerankOutputSchema = z.object({
    picks: z.array(z.object({
        templateId: z.number().int(),
        reason: z.string().optional(),
    })).max(10),
})

const SYSTEM_PROMPT = `你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书，
你需要根据【案件上下文】和【用户最新一句话】，从给定的候选模板中选出最合适的若干个模板。

判断维度（重要性递减）：
1. 模板是否切合用户最新一句话表达的文书起草需求
2. 模板适用的法律领域是否匹配案件类型（如劳动纠纷案件应优先劳动相关模板）
3. 模板是否适合当前案件所处阶段（起诉/答辩/上诉/执行）
4. 候选中标记 recentlyUsed=true 的模板说明用户最近用过，
   若与当前需求相关可适当优先；若需求明显切换则不应仅凭"用过"加权

严格按 JSON schema 输出，templateId 必须来自候选列表的 id，禁止编造。`

function buildUserMessage(input: RerankInput, caseContext: string): string {
    const candidatesForLLM = input.candidates.map(c => ({
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description ?? null,
        recentlyUsed: c.recentlyUsed,
    }))
    const sections: string[] = []
    if (caseContext.trim().length > 0) {
        sections.push(`## 案件信息\n${caseContext}`)
    }
    sections.push(`## 用户最新一句话\n${input.userQuery}`)
    if (input.intent && input.intent !== input.userQuery) {
        sections.push(`## 用户意图（粗筛阶段提取）\n${input.intent}`)
    }
    sections.push(`## 候选模板（共 ${candidatesForLLM.length} 条）\n\`\`\`json\n${JSON.stringify(candidatesForLLM)}\n\`\`\``)
    sections.push(`## 输出要求\n返回 picks 数组，按合适度从高到低排序，长度 ≤ ${input.topN ?? 5}。templateId 必须来自候选 id。reason 可选，一句话说明。`)
    return sections.join('\n\n')
}

async function callRerankLLM(input: RerankInput, caseContext: string): Promise<{ templateId: number; reason?: string }[]> {
    const nodeConfig = await getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent')
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${DOCUMENT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.1,
        streaming: false,
        maxTokens: Math.min(2000, nodeConfig.modelMaxOutputTokens ?? 2000),
    })

    const structured = (model as any).withStructuredOutput(RerankOutputSchema, { name: 'rerank_picks' })
    const messages = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(buildUserMessage(input, caseContext)),
    ]

    const timeoutMs = input.timeoutMs ?? 15000
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('rerank_timeout')), timeoutMs)

    try {
        const out = await structured.invoke(messages, { signal: ac.signal }) as z.infer<typeof RerankOutputSchema>
        return out.picks
    }
    finally {
        clearTimeout(timer)
    }
}

async function loadCaseContext(input: RerankInput): Promise<string> {
    if (input.caseId == null) return ''
    const segs = await buildContextSegments({
        caseId: input.caseId,
        agentName: DOCUMENT_MAIN_NODE_NAME,
        userQuery: input.userQuery,
    })
    return [segs.caseProfile, segs.moduleSummaries, segs.dynamicContext]
        .filter(s => s && s.trim().length > 0)
        .join('\n\n')
}

function fillFromCandidates(
    initial: RerankPick[],
    seen: Set<number>,
    candidates: TemplateCandidate[],
    topN: number,
    reason: RerankFallbackReason,
): RerankResult {
    const picks = [...initial]
    for (const c of candidates) {
        if (picks.length >= topN) break
        if (seen.has(c.id)) continue
        seen.add(c.id)
        picks.push({ templateId: c.id })
    }
    return { picks, fallback: true, fallbackReason: reason }
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

    // 3. 拉案件上下文（无 caseId 时返回空串）
    const caseContext = await loadCaseContext(input).catch(err => {
        logger.warn('[rerankTemplatesService] loadCaseContext 失败，按无案件继续', { err })
        return ''
    })

    // 4. 调 LLM rerank
    const llmPicks = await callRerankLLM(input, caseContext)

    // 5. 校验：templateId 必须在 candidates 集合内 + 去重
    const validIdSet = new Set(candidates.map(c => c.id))
    const seen = new Set<number>()
    const validPicks: RerankPick[] = []
    for (const p of llmPicks) {
        if (!validIdSet.has(p.templateId)) continue
        if (seen.has(p.templateId)) continue
        seen.add(p.templateId)
        validPicks.push({ templateId: p.templateId, reason: p.reason })
    }

    // 6. 截到 topN
    const finalPicks = validPicks.slice(0, topN)

    // 7. LLM 至少返回了 1 个有效 id → 尊重 LLM 判断，按 LLM 顺序返回
    if (finalPicks.length > 0) {
        return { picks: finalPicks, fallback: false }
    }

    // 8. LLM 返回的 id 全部编造（0 个有效）→ 用 candidates 顺序补足
    return fillFromCandidates(finalPicks, seen, candidates, topN, 'not_enough_valid_ids')
}
