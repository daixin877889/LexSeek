/**
 * 单条合同条款的风险分析
 *
 * 给定一条 clauseText + 立场 + 合同上下文，调用 LLM 返回 0 或 1 条 Risk。
 * 本函数**不**进 state / checkpointer，是工具层一次性 invoke。
 *
 * 失败时抛错；调用方决定是否 swallow 为 progress.error。
 */
import { z } from 'zod'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { RISK_SHAPE } from './riskSchema.builder'
import type { Risk, Stance, ClauseSegment } from '#shared/types/contract'

/** 单条输出 schema：要么返回 risk，要么 skip */
const SingleClauseResponse = z.object({
    risk: RISK_SHAPE.nullable(),
    skip: z.boolean().default(false),
})

export interface AnalyzeClauseContext {
    clause: ClauseSegment
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
}

/** 返回 null 表示该条款无风险；返回 Risk 则已校验通过 */
export async function analyzeSingleClause(ctx: AnalyzeClauseContext): Promise<Risk | null> {
    const config = await getValidNodeConfig('contractReviewMain')
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error('contractReviewMain 节点无可用 API 密钥')

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0,
    })

    const prompt = buildPrompt(ctx)
    const response = await model.invoke(prompt)
    const content = typeof response.content === 'string' ? response.content : ''

    // 宽容解析：匹配第一个 {...}
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('LLM 未返回 JSON')
    const parsed = SingleClauseResponse.safeParse(JSON.parse(jsonMatch[0]))
    if (!parsed.success) throw new Error(`LLM 输出不符合 schema: ${parsed.error.issues[0]?.message}`)

    if (parsed.data.skip || !parsed.data.risk) return null
    return parsed.data.risk as Risk
}

function buildPrompt(ctx: AnalyzeClauseContext): string {
    return [
        `你正在审查合同（${ctx.contractType ?? '未知类型'}），站在${ctx.stance === 'partyA' ? '甲方' : ctx.stance === 'partyB' ? '乙方' : '中立第三方'}立场。`,
        `甲方：${ctx.partyA ?? '未知'}；乙方：${ctx.partyB ?? '未知'}。`,
        `当前条款（第 ${ctx.clause.index} 条，编号 ${ctx.clause.number ?? '无'}）：`,
        `"""`,
        ctx.clause.text,
        `"""`,
        `请判断该条款是否有风险。严格按 JSON 输出：`,
        `- 有风险：{"risk": {...}, "skip": false}，risk 字段结构见 RISK_SHAPE`,
        `- 无风险：{"risk": null, "skip": true}`,
        `只输出 JSON，不要任何解释。`,
    ].join('\n')
}
