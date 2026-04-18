import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RiskClauseDiff from '~/components/assistant/contract/RiskClauseDiff.vue'

/**
 * RiskClauseDiff 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 组件职责（M4 MVP）：
 * - 上下并排展示 clauseText 与 suggestedClauseText（纯文本）
 * - suggestedClauseText 为空时展示"无建议改写"
 * - 不做段落级字符 diff 着色（diff-match-patch 是 M5 任务）
 */
describe('RiskClauseDiff', () => {
    it('渲染 clauseText 原文', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '甲方应于合同签订之日起三日内支付定金。',
                suggestedClauseText: '甲方应于合同签订之日起五日内支付定金。',
            },
        })

        expect(w.text()).toContain('原文条款')
        expect(w.text()).toContain('甲方应于合同签订之日起三日内支付定金。')
    })

    it('渲染 suggestedClauseText 建议改写', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '甲方应于合同签订之日起三日内支付定金。',
                suggestedClauseText: '甲方应于合同签订之日起五日内支付定金。',
            },
        })

        expect(w.text()).toContain('建议改写')
        expect(w.text()).toContain('甲方应于合同签订之日起五日内支付定金。')
        expect(w.text()).not.toContain('无建议改写')
    })

    it('suggestedClauseText 为 undefined 时显示"无建议改写"', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '任何一方违约应承担违约责任。',
            },
        })

        expect(w.text()).toContain('任何一方违约应承担违约责任。')
        expect(w.text()).toContain('无建议改写')
    })

    it('suggestedClauseText 为空字符串（low 风险）时显示"无建议改写"', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '本合同自双方签字盖章之日起生效。',
                suggestedClauseText: '',
            },
        })

        expect(w.text()).toContain('本合同自双方签字盖章之日起生效。')
        expect(w.text()).toContain('无建议改写')
    })
})
