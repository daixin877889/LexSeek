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

const RISK_LEVEL = ['high', 'medium', 'low'] as const

export const RISK_SHAPE = z.object({
    id: z.string().describe('UUID，前端渲染 key'),
    clauseIndex: z.number().int().nonnegative().describe('段落索引（0-based）'),
    clauseText: z.string().describe('原文段落全文'),
    level: z.enum(RISK_LEVEL).describe('风险级别'),
    category: z.string().describe('付款 / 交付 / 违约 / 保密 / 知识产权 / 争议解决 / 其他'),
    problem: z.string().describe('问题简述'),
    legalBasis: z.string().optional().describe('《民法典》第 XXX 条等'),
    analysis: z.string().describe('条款分析'),
    risk: z.string().describe('对当前立场方的法律风险'),
    suggestion: z.string().describe('修改建议（文字描述）'),
    suggestedClauseText: z.string().optional().describe('AI 重写后的完整条款（high/medium 必填）'),
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
