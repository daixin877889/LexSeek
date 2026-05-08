/**
 * 合同审查 Risk Zod schema 单元测试
 *
 * **Feature: contract-review-m3**
 * **Validates: Plan Task 2.1**
 */
import { describe, it, expect } from 'vitest'
import { buildRiskSchema, RISK_SHAPE } from '~~/server/agents/contract/riskSchema.builder'

describe('buildRiskSchema', () => {
    it('返回 z.object，含 risks 数组 + summary 字符串', () => {
        const schema = buildRiskSchema()
        const parsed = schema.safeParse({
            risks: [],
            summary: '合同整体风险可控',
        })
        expect(parsed.success).toBe(true)
    })

    it('high 级别无 suggestedClauseText 校验失败', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: '11111111-1111-4111-8111-111111111111',
            clauseIndex: 0,
            clauseText: '原文',
            level: 'high',
            category: '付款',
            problem: '逾期未约定',
            analysis: '...',
            risk: '...',
            suggestion: '...',
        })
        expect(parsed.success).toBe(false)
        if (!parsed.success) {
            expect(parsed.error.issues[0].message).toContain('suggestedClauseText')
        }
    })

    it('medium 级别无 suggestedClauseText 校验失败', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: '22222222-2222-4222-8222-222222222222', clauseIndex: 1, clauseText: '原文', level: 'medium',
            category: '付款', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        })
        expect(parsed.success).toBe(false)
    })

    it('low 级别无 suggestedClauseText 校验通过', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: '33333333-3333-4333-8333-333333333333', clauseIndex: 2, clauseText: '原文', level: 'low',
            category: '其他', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        })
        expect(parsed.success).toBe(true)
    })

    it('high + suggestedClauseText 齐全校验通过', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: '44444444-4444-4444-8444-444444444444', clauseIndex: 3, clauseText: '原文', level: 'high',
            category: '违约', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
            suggestedClauseText: '重写后的条款',
        })
        expect(parsed.success).toBe(true)
    })
})

describe('RISK_SHAPE.suggestedClauseText 换行约束（PR6 §8.3.3）', () => {
    const baseRisk = {
        id: 'r1',
        clauseIndex: 0,
        clauseText: '原文',
        level: 'high' as const,
        category: '违约',
        problem: 'p',
        analysis: 'a',
        risk: 'r',
        suggestion: 's',
    }

    it('含 LF 的 suggestedClauseText 被 schema reject', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            suggestedClauseText: '第一行\n第二行',
        })
        expect(result.success).toBe(false)
        if (!result.success) {
            const hit = result.error.issues.some(i =>
                i.path.includes('suggestedClauseText') && /换行/.test(i.message))
            expect(hit).toBe(true)
        }
    })

    it('含 CRLF 的 suggestedClauseText 也被 reject', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            suggestedClauseText: '第一行\r\n第二行',
        })
        expect(result.success).toBe(false)
    })

    it('单段连续文字通过', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            suggestedClauseText: '一段连续文字，含中英文标点 and English.',
        })
        expect(result.success).toBe(true)
    })

    it('low 级别仍允许省略 suggestedClauseText', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            level: 'low',
        })
        expect(result.success).toBe(true)
    })
})
