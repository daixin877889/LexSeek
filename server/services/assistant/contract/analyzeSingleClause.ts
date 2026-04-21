/**
 * 单条合同条款的风险分析
 *
 * 给定一条 clauseText + 立场 + 合同上下文，调用 LLM 返回 0 或 1 条 Risk。
 * 本函数**不**进 state / checkpointer，是工具层一次性 invoke。
 *
 * 失败时抛错；调用方决定是否 swallow 为 progress.error。
 */
import { randomUUID } from 'node:crypto'
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

    // 宽容解析：仅取首个完整 JSON 块即可
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        logger.warn('analyzeSingleClause: LLM 未返回 JSON', {
            clauseIndex: ctx.clause.index,
            rawContent: content.slice(0, 200),
        })
        throw new Error(`条款 #${ctx.clause.index} LLM 未返回 JSON`)
    }

    let rawJson: unknown
    try {
        rawJson = JSON.parse(jsonMatch[0])
    } catch (err) {
        logger.warn('analyzeSingleClause: JSON.parse 失败', {
            clauseIndex: ctx.clause.index,
            raw: jsonMatch[0].slice(0, 200),
            err,
        })
        throw new Error(`条款 #${ctx.clause.index} JSON 解析失败`)
    }

    const parsed = SingleClauseResponse.safeParse(rawJson)
    if (!parsed.success) {
        logger.warn('analyzeSingleClause: schema 校验失败', {
            clauseIndex: ctx.clause.index,
            issue: parsed.error.issues[0]?.message,
        })
        throw new Error(`条款 #${ctx.clause.index} LLM 输出不符合 schema: ${parsed.error.issues[0]?.message}`)
    }

    if (parsed.data.skip || !parsed.data.risk) return null
    // 服务端强制覆盖 id：LLM 偶发对多条 risk 返回相同 UUID，导致前端 data-risk-id
    // 冲突（多张卡片/文档段被同一 focus/pin 联动）。用 randomUUID 保证唯一。
    return { ...parsed.data.risk, id: randomUUID() } as Risk
}

function buildPrompt(ctx: AnalyzeClauseContext): string {
    return [
        `你正在审查合同（${ctx.contractType ?? '未知类型'}），站在${ctx.stance === 'partyA' ? '甲方' : ctx.stance === 'partyB' ? '乙方' : '中立第三方'}立场。`,
        `甲方：${ctx.partyA ?? '未知'}；乙方：${ctx.partyB ?? '未知'}。`,
        `当前条款（第 ${ctx.clause.index} 条，编号 ${ctx.clause.number ?? '无'}）：`,
        `"""`,
        ctx.clause.text,
        `"""`,
        `请判断该条款是否有风险。严格按 JSON 输出，字段如下：`,
        ``,
        `- 有风险：`,
        `  {`,
        `    "risk": {`,
        `      "id": "<UUID v4>",`,
        `      "clauseIndex": ${ctx.clause.index},`,
        `      "clauseText": "<被分析的条款原文片段>",`,
        `      "level": "high" | "medium" | "low",`,
        `      "category": "<风险类别，如 '付款' / '违约' / '知识产权' 等>",`,
        `      "problem": "<简短问题描述>",`,
        `      "analysis": "<详细分析>",`,
        `      "risk": "<对己方的风险点>",`,
        `      "suggestion": "<改进建议>",`,
        `      "suggestedClauseText": "<可选，推荐改写后的条款>"`,
        `    },`,
        `    "skip": false`,
        `  }`,
        ``,
        `- 无风险：{ "risk": null, "skip": true }`,
        ``,
        `只输出 JSON，不要任何解释。`,
    ].join('\n')
}
