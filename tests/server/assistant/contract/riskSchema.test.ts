/**
 * 合同审查 Risk Zod schema 单元测试
 *
 * **Feature: contract-review-m3**
 * **Validates: Plan Task 2.1**
 */
import { describe, it, expect } from 'vitest'
import { buildRiskSchema, RISK_SHAPE } from '~~/server/services/assistant/contract/riskSchema.builder'

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
            id: 'r1',
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
            id: 'r2', clauseIndex: 1, clauseText: '原文', level: 'medium',
            category: '付款', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        })
        expect(parsed.success).toBe(false)
    })

    it('low 级别无 suggestedClauseText 校验通过', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: 'r3', clauseIndex: 2, clauseText: '原文', level: 'low',
            category: '其他', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        })
        expect(parsed.success).toBe(true)
    })

    it('high + suggestedClauseText 齐全校验通过', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: 'r4', clauseIndex: 3, clauseText: '原文', level: 'high',
            category: '违约', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
            suggestedClauseText: '重写后的条款',
        })
        expect(parsed.success).toBe(true)
    })
})
