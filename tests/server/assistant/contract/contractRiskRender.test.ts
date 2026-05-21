/**
 * renderRiskAsAnnotationText 测试
 *
 * 覆盖 M12：AI 生成的「立场专属法律风险」（risk 字段）需在批注文本里单独成段；
 * 同时不破坏 legacy JSON（分析字段叫 risk、无 analysis）的渲染。
 */
import { describe, it, expect } from 'vitest'
import { renderRiskAsAnnotationText } from '~~/server/agents/contract/contractRiskRender'

describe('renderRiskAsAnnotationText', () => {
    it('M12：新格式风险（analysis 与 risk 并存）→ 法律风险单独成段', () => {
        const text = renderRiskAsAnnotationText({
            level: 'high', category: '试用期', problem: '试用期超长',
            legalBasis: '《劳动合同法》第19条',
            analysis: '超过法定最长 6 个月',
            risk: '可能被认定违法并需赔偿',
            suggestion: '调整为不超过 6 个月',
        })
        expect(text).toContain('分析：超过法定最长 6 个月')
        expect(text).toContain('法律风险：可能被认定违法并需赔偿')
        expect(text).toContain('建议：调整为不超过 6 个月')
    })

    it('legacy JSON（分析字段叫 risk、无 analysis）→ risk 仍当分析渲染，不重复成段', () => {
        const text = renderRiskAsAnnotationText({
            level: 'medium', category: '付款', problem: '付款期限过短',
            risk: '这是 legacy 数据里的分析内容',
            suggestion: '延长付款期',
        })
        expect(text).toContain('分析：这是 legacy 数据里的分析内容')
        expect(text).not.toContain('法律风险：')
    })

    it('只有 analysis 无 risk 时不渲染法律风险段', () => {
        const text = renderRiskAsAnnotationText({
            level: 'low', category: '其他', problem: 'p', analysis: '仅分析', suggestion: 's',
        })
        expect(text).toContain('分析：仅分析')
        expect(text).not.toContain('法律风险：')
    })
})
