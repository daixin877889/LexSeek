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
import { renderContent } from '~~/server/services/node/prompt.service'
import { RISK_SHAPE } from './riskSchema.builder'
import { invokeNodeJson, warnUnreplacedTemplateVars } from './utils/llmInvokeJson'
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
    const data = await invokeNodeJson({
        nodeName: NODE_NAME,
        temperature: 0,
        schema: SingleClauseResponse,
        buildPrompt: (template) => renderPromptTemplate(template, ctx),
        errorPrefix: `条款 #${ctx.clause.index}`,
        logContext: {
            clauseIndex: ctx.clause.index,
            clauseLength: ctx.clause.text.length,
        },
    })

    if (data.skip || !data.risk) return null

    const rawRisk = data.risk
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
    warnUnreplacedTemplateVars(rendered, 'analyzeSingleClause', { clauseIndex: ctx.clause.index })
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
