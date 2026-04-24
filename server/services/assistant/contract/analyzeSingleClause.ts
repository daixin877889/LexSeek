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
import { logger } from '#shared/utils/logger'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { renderContent } from '~~/server/services/node/prompt.service'
import { logContextOverflow } from '~~/server/services/workflow/context/contextErrorLogger'
import { RISK_SHAPE } from './riskSchema.builder'
import { extractFirstJsonObject, summarizeJsonShape } from './utils/llmJson'
import type { Risk, Stance, ClauseSegment, PlaybookSnapshot } from '#shared/types/contract'

/** 单条条款文本硬截断（字符），防止单条超大条款把整个 prompt 撑爆 */
const MAX_CLAUSE_CHARS = 20000

const NODE_NAME = 'contractReviewAnalyzeClause'

/**
 * 单条输出 schema：要么返回 risk，要么 skip。
 * 两个字段都 optional：
 *   - LLM 只返回 `{"skip": true}` → risk=undefined（下面 line 112 当 null 处理）
 *   - LLM 只返回 `{"risk": {...}}` → skip=false（default）
 *   - LLM 返回 `{"risk": null, "skip": false}` → 无风险条款
 */
const SingleClauseResponse = z.object({
    risk: RISK_SHAPE.nullable().optional(),
    skip: z.boolean().default(false),
})

export interface AnalyzeClauseContext {
    clause: ClauseSegment
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
    /** M7 Playbook 快照；null/undefined 表示无清单，prompt 里 {{playbookSection}} 渲染为空 */
    playbookSnapshot?: PlaybookSnapshot | null
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

    const jsonText = extractFirstJsonObject(content)
    if (!jsonText) {
        logger.warn('analyzeSingleClause: LLM 未返回 JSON', {
            clauseIndex: ctx.clause.index,
            rawContent: content.slice(0, 500),
        })
        throw new Error(`条款 #${ctx.clause.index} LLM 未返回 JSON`)
    }

    let rawJson: unknown
    try {
        rawJson = JSON.parse(jsonText)
    } catch (err) {
        logger.warn('analyzeSingleClause: JSON.parse 失败', {
            clauseIndex: ctx.clause.index,
            jsonText: jsonText.slice(0, 500),
            errMessage: err instanceof Error ? err.message : String(err),
        })
        throw new Error(`条款 #${ctx.clause.index} JSON 解析失败`)
    }

    const parsed = SingleClauseResponse.safeParse(rawJson)
    if (!parsed.success) {
        // 打出 rawJson 的完整形态 + 全部 issues（含 path），便于定位 LLM 输出哪里偏了
        const rawShape = summarizeJsonShape(rawJson)
        const issues = parsed.error.issues.slice(0, 5).map(i => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
            code: i.code,
        }))
        logger.warn('analyzeSingleClause: schema 校验失败', {
            clauseIndex: ctx.clause.index,
            rawShape,
            issues,
            rawJsonPreview: JSON.stringify(rawJson).slice(0, 500),
            rawContentPreview: content.slice(0, 300),
        })
        const firstIssue = parsed.error.issues[0]
        const pretty = firstIssue
            ? `${firstIssue.path.join('.') || '(root)'}: ${firstIssue.message}`
            : 'unknown'
        throw new Error(`条款 #${ctx.clause.index} LLM 输出不符合 schema: ${pretty}`)
    }

    if (parsed.data.skip || !parsed.data.risk) return null

    const rawRisk = parsed.data.risk
    let matchedPointCode: string | undefined = (rawRisk.matchedPointCode?.trim() || undefined)

    // 白名单校验：AI 返回的 code 必须在快照里存在；否则降级为清单外（警告）
    if (matchedPointCode && ctx.playbookSnapshot) {
        const validCodes = new Set(ctx.playbookSnapshot.points.map(p => p.code))
        if (!validCodes.has(matchedPointCode)) {
            logger.warn('analyzeSingleClause: AI 返回未知的 matchedPointCode，降级为清单外', {
                clauseIndex: ctx.clause.index,
                returnedCode: matchedPointCode,
                validCodeCount: validCodes.size,
            })
            matchedPointCode = undefined
        }
    }
    // snapshot 不存在时，AI 不应返回 matchedPointCode；如果返了，静默忽略（不 warn）
    if (matchedPointCode && !ctx.playbookSnapshot) {
        matchedPointCode = undefined
    }

    // 服务端强制覆盖 id：LLM 偶发对多条 risk 返回相同 UUID，导致前端 data-risk-id
    // 冲突（多张卡片/文档段被同一 focus/pin 联动）。用 randomUUID 保证唯一。
    return { ...rawRisk, id: randomUUID(), matchedPointCode } as Risk
}

/**
 * 渲染 DB 模板：替换 8 个占位符
 *  - stanceLabel 在代码侧把 partyA/partyB/neutral 映射为"甲方/乙方/中立第三方"
 *    （DB 模板只认字符串变量，不适合做条件分支）
 *  - clauseText 硬截断到 MAX_CLAUSE_CHARS 防 prompt 爆炸
 *  - playbookSection 由 renderPlaybookSection 生成；无快照时为空串
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
        playbookSection: renderPlaybookSection(ctx.playbookSnapshot),
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

/**
 * 把清单快照渲染成 prompt 里的"审查清单"段。snapshot 为空时返回空串。
 */
function renderPlaybookSection(snapshot: PlaybookSnapshot | null | undefined): string {
    if (!snapshot || !snapshot.points.length) return ''

    const lines: string[] = [`## 本合同审查清单（${snapshot.contractType}）`]
    for (const p of snapshot.points) {
        lines.push(`- code="${p.code}"  [${p.defaultLevel} · 立场:${p.stancePreference}]  ${p.title}`)
        lines.push(`    检查内容：${p.checkContent}`)
        if (p.legalBasis) lines.push(`    法律依据：${p.legalBasis}`)
        if (p.suggestion) lines.push(`    标准建议：${p.suggestion}`)
    }
    lines.push('')
    lines.push('请逐条审查合同条款。若违反上述某条要点，在输出风险时填 "matchedPointCode": "<对应 code>"（code 原样引用，不要编号）。若发现清单外的重大风险，照常输出，matchedPointCode 留空。')
    return lines.join('\n')
}
