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
import { splitSentences } from './utils/splitSentences'
import type { Risk, Stance, ClauseSegment, PlaybookSnapshot } from '#shared/types/contract'

/** 单条条款文本硬截断（字符），防止单条超大条款把整个 prompt 撑爆 */
const MAX_CLAUSE_CHARS = 20000

const NODE_NAME = 'contractReviewAnalyzeClause'

/**
 * 单条款输出 schema：返回 risks 数组。每个独立违法点（playbook 要点）一条 risk。
 *
 * 设计理由（升级自旧 `risk: Risk | null` 单值）：同一条款可能违反多个 playbook 要点
 * （如劳动合同"试用期 6 个月（超长）+ 单方延长（违法）+ 工资 50%（低于 80% 底线）"），
 * 旧单值 schema 让 LLM 把多个违法点合并成一条 risk，只能挑一个 matchedPointCode，
 * 导致 playbook 命中率天花板低。
 *
 * 字段语义：
 *   - risks: 数组，每个元素是独立 risk；空数组等同于"无风险"
 *   - skip: 兼容字段；旧 LLM 可能输出 `{skip: true}` 表示无风险；与 risks 空数组等价
 *
 * 旧 LLM 输出兜底：preprocess 把单值 `{risk: ...}` 透明升级到 `{risks: [...]}`，prompt
 * 改造后这层兜底主要应对未热更 prompt 缓存的边角，最终可移除。
 */
const SingleClauseResponse = z.preprocess(
    (val: unknown) => {
        if (val && typeof val === 'object') {
            const obj = val as Record<string, unknown>
            // 兼容旧 LLM 输出：risk 单值 → 升级到 risks 数组
            if (obj.risk !== undefined && obj.risks === undefined) {
                return { ...obj, risks: obj.risk == null ? [] : [obj.risk], risk: undefined }
            }
        }
        return val
    },
    z.object({
        risks: z.array(RISK_SHAPE).default([]),
        skip: z.boolean().default(false),
    }),
)

export interface AnalyzeClauseContext {
    clause: ClauseSegment
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
    /** M7 Playbook 快照；null/undefined 表示无清单，prompt 里 {{playbookSection}} 渲染为空 */
    playbookSnapshot?: PlaybookSnapshot | null
    /** M11：透传取消信号到底层 LLM 调用，逐条分析阶段可被用户取消 / 超时中断 */
    signal?: AbortSignal
}

/** 返回风险数组；空数组表示该条款无风险 */
export async function analyzeSingleClause(ctx: AnalyzeClauseContext): Promise<Risk[]> {
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
        signal: ctx.signal,
    })

    if (data.skip || data.risks.length === 0) return []

    const validCodes: Set<string> | null = ctx.playbookSnapshot
        ? new Set(ctx.playbookSnapshot.points.map(p => p.code))
        : null

    return data.risks.map((rawRisk) => {
        let matchedPointCode: string | undefined = (rawRisk.matchedPointCode?.trim() || undefined)

        if (matchedPointCode) {
            if (!validCodes) {
                // snapshot 不存在时，AI 不应返回 matchedPointCode；如果返了，静默忽略（不 warn）
                matchedPointCode = undefined
            }
            else if (!validCodes.has(matchedPointCode)) {
                // 白名单校验失败：降级为清单外，warn 让运维排查 prompt/playbook 漂移
                logger.warn('analyzeSingleClause: AI 返回未知的 matchedPointCode，降级为清单外', {
                    clauseIndex: ctx.clause.index,
                    returnedCode: matchedPointCode,
                    validCodeCount: validCodes.size,
                })
                matchedPointCode = undefined
            }
        }

        // 服务端强制覆盖 id：LLM 偶发对多条 risk 返回相同 UUID，导致前端 data-risk-id
        // 冲突（多张卡片/文档段被同一 focus/pin 联动）。用 randomUUID 保证唯一。
        //
        // M9：clauseIndex 同样强制覆盖为当前正在分析的 ctx.clause.index。本函数每次只
        // 分析一条条款，LLM 回填的 clauseIndex 没有任何信息价值，却会因 LLM 回错值（含
        // 越界值）导致下游取到错条款、clauseParagraphIndex 落 null、批注静默挂错位置。
        return { ...rawRisk, id: randomUUID(), clauseIndex: ctx.clause.index, matchedPointCode } as Risk
    })
}

/**
 * 渲染 DB 模板（PR 3 升级到双视图）：
 *  - {{sentencesNumbered}}：切句后的 [S1] xxx [S2] yyy 视图（替换原 {{clauseText}}），
 *    给 LLM 选 problemSentenceIds 用
 *  - {{clauseTextRaw}}：完整原文（截断后）保留兜底回溯，避免 LLM 在 sentence 视角下丢失整体上下文
 *  - 其他占位符（stanceLabel / contractType / partyA / partyB / clauseIndex / clauseNumber / playbookSection）保留
 *  - clauseTextRaw 硬截断到 MAX_CLAUSE_CHARS 防 prompt 爆炸
 */
function renderPromptTemplate(template: string, ctx: AnalyzeClauseContext): string {
    const stanceLabel = ctx.stance === 'partyA'
        ? '甲方'
        : ctx.stance === 'partyB'
            ? '乙方'
            : '中立第三方'
    const truncate = (s: string) => s.length > MAX_CLAUSE_CHARS
        ? `${s.slice(0, MAX_CLAUSE_CHARS)}…(已截断)`
        : s
    // {{clauseTextRaw}}：完整原文（含编号字符），截断后保留作兜底回溯上下文
    const clauseTextRaw = truncate(ctx.clause.text)

    // 切句给 LLM 的 [Sn] 编号视图（1-based，与 problemSentenceIds 输出对齐）。
    // M10：必须用 textWithoutNumber（去编号文本）切句——落库 persistAiRisksAsContractRows
    // 解析 problemSentenceIds 时也用 splitSentences(textWithoutNumber)，两边切句基准必须
    // 一致。否则条款编号单独占首行时（正式合同常见），两个 sentence 数组错位一位，每条
    // 风险的 problematicQuote / quoteCharStart/End 全部偏移一句。textWithoutNumber 缺失
    // （历史 snapshot 数据 / 无编号散段）时回退到 text。
    const sentenceSource = truncate(ctx.clause.textWithoutNumber ?? ctx.clause.text)
    const sentences = splitSentences(sentenceSource)
    const sentencesNumbered = sentences.length > 0
        ? sentences.map(s => `[S${s.id}] ${s.text}`).join('\n')
        : sentenceSource // 切不出句子的极端兜底（理论上 splitSentences 至少产出 1 个）

    const rendered = renderContent(template, {
        stanceLabel,
        contractType: ctx.contractType ?? '未知类型',
        partyA: ctx.partyA ?? '未知',
        partyB: ctx.partyB ?? '未知',
        clauseIndex: String(ctx.clause.index),
        clauseNumber: ctx.clause.number ?? '无',
        sentencesNumbered,
        clauseTextRaw,
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
