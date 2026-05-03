/**
 * 合同审查专属 Zod schema
 *
 * - high/medium 级别 Risk 强制 suggestedClauseText（通过 refine）
 * - low 级别可省略（减少 token 消耗）
 * - schema 形状固定，不依赖模板
 *
 * **Feature: contract-review-m3**
 */
import { z } from 'zod'
import type { RiskLevel } from '#shared/types/contract'

const RISK_LEVEL = ['high', 'medium', 'low'] as const satisfies readonly RiskLevel[]

export const RISK_SHAPE = z.object({
    // id 定义为可选字符串而非 z.string().uuid()：
    //   - AI 输出路径：analyzeSingleClause 会用 randomUUID() 强制覆盖 LLM 返回的 id，
    //     LLM 返回任何格式都无意义；用 .uuid() 还会因为 LLM 偶发返回 "risk-1"、"" 这
    //     种非 UUID 字符串而让整条 risk 被拒（用户看到"第 N 条 LLM 输出不符合 schema"）
    //   - PATCH 路径：前端传的 id 来自之前 API 返回的已合法 UUID，不需要严格校验
    // YAGNI：id 校验对业务流程没有防护价值，放松后上游容错更强
    id: z.string().optional().describe('UUID，前端渲染 key；AI 路径会被服务端覆盖'),
    clauseIndex: z.number().int().nonnegative().describe('段落索引（0-based）'),
    clauseText: z.string().min(1).max(10000).describe('原文段落全文'),
    level: z.enum(RISK_LEVEL).describe('风险级别'),
    category: z.string().min(1).max(200).describe('付款 / 交付 / 违约 / 保密 / 知识产权 / 争议解决 / 其他'),
    problem: z.string().min(1).max(2000).describe('问题简述'),
    legalBasis: z.string().max(200).optional().describe('《民法典》第 XXX 条等'),
    analysis: z.string().min(1).max(2000).describe('条款分析'),
    risk: z.string().min(1).max(2000).describe('对当前立场方的法律风险'),
    suggestion: z.string().min(1).max(2000).describe('修改建议（文字描述）'),
    suggestedClauseText: z.string().max(10000).optional().describe('AI 重写后的完整条款（high/medium 必填）'),
    matchedPointCode: z.string().optional().describe('命中的审查清单要点 code（由 AI 填写，服务端白名单校验后透传）'),

    // 路线 2 精准锚点（spec §5.4）—— PR 3 起 LLM 输出，service 用于 resolveQuoteAnchor 解析
    problemSentenceIds: z.array(z.number().int().positive()).default([]).describe('LLM 选择的"产生风险的句子 ID"（1-based，对应 prompt 里的 [Sn] 编号）'),
    problematicQuote: z.string().max(2000).optional().describe('LLM 从 sentence 里逐字摘录的问题片段（fuzzy fallback 用）'),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供 suggestedClauseText', path: ['suggestedClauseText'] },
)

export function buildRiskSchema() {
    return z.object({
        risks: z.array(RISK_SHAPE).describe('风险点清单，按 clauseIndex 升序'),
        summary: z.string().describe('审查摘要 Markdown'),
    })
}
