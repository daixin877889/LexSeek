/**
 * 单条合同条款的风险分析
 *
 * 给定一条 clauseText + 立场 + 合同上下文，调用 LLM 返回 0 或 1 条 Risk。
 * 本函数**不**进 state / checkpointer，是工具层一次性 invoke。
 *
 * - 提示词从 DB 节点 `contractReviewAnalyzeClause` 的 system prompt 加载（运营可在后台热更新）
 * - 失败时抛错；调用方决定是否 swallow 为 progress.error
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { renderContent } from '~~/server/services/node/prompt.service'
import { logContextOverflow } from '~~/server/services/workflow/context/contextErrorLogger'
import { RISK_SHAPE } from './riskSchema.builder'
import type { Risk, Stance, ClauseSegment } from '#shared/types/contract'

/** 单条条款文本硬截断（字符），防止单条超大条款把整个 prompt 撑爆 */
const MAX_CLAUSE_CHARS = 20000

const NODE_NAME = 'contractReviewAnalyzeClause'

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
    const config = await getValidNodeConfig(NODE_NAME)
    const activeKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeKey) throw new Error(`${NODE_NAME}: 无可用 API 密钥`)

    // 从 DB 加载 system prompt 模板（运营可在 /admin/nodes/20 里热更）
    const template = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
    if (!template) {
        throw new Error(`${NODE_NAME}: DB 未配置 system 类型的启用态提示词`)
    }

    const model = createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: activeKey.apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0,
    })

    const prompt = renderPromptTemplate(template, ctx)
    let response
    try {
        response = await model.invoke(prompt)
    } catch (err) {
        logContextOverflow(err, {
            source: 'analyzeSingleClause',
            modelName: config.modelName,
            sdkType: config.modelSdkType,
            contextWindow: config.modelContextWindow,
            extra: {
                clauseIndex: ctx.clause.index,
                clauseLength: ctx.clause.text.length,
                promptLength: prompt.length,
            },
        })
        throw err
    }
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

/**
 * 渲染 DB 模板：替换 7 个占位符
 *  - stanceLabel 在代码侧把 partyA/partyB/neutral 映射为"甲方/乙方/中立第三方"
 *    （DB 模板只认字符串变量，不适合做条件分支）
 *  - clauseText 硬截断到 MAX_CLAUSE_CHARS 防 prompt 爆炸
 */
function renderPromptTemplate(template: string, ctx: AnalyzeClauseContext): string {
    const stanceLabel = ctx.stance === 'partyA'
        ? '甲方'
        : ctx.stance === 'partyB'
            ? '乙方'
            : '中立第三方'
    const clauseText = ctx.clause.text.length > MAX_CLAUSE_CHARS
        ? `${ctx.clause.text.slice(0, MAX_CLAUSE_CHARS)}…(已截断)`
        : ctx.clause.text

    const rendered = renderContent(template, {
        stanceLabel,
        contractType: ctx.contractType ?? '未知类型',
        partyA: ctx.partyA ?? '未知',
        partyB: ctx.partyB ?? '未知',
        clauseIndex: String(ctx.clause.index),
        clauseNumber: ctx.clause.number ?? '无',
        clauseText,
    })
    const unreplaced = rendered.match(/\{\{(\w+)\}\}/g)
    if (unreplaced) {
        logger.warn('analyzeSingleClause: 提示词存在未替换的模板变量', {
            clauseIndex: ctx.clause.index,
            unreplacedVars: unreplaced,
        })
    }
    return rendered
}
