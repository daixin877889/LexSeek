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

/**
 * M5 升级测试：字符级 diff 着色（diff-match-patch）
 *
 * - 删除片段：bg-red-100 + line-through
 * - 新增片段：bg-emerald-100 + font-medium
 * - 建议为空时 fallback 到 M4 的"无建议改写"纯文本行为
 */
describe('RiskClauseDiff (M5 diff-match-patch 升级)', () => {
    it('原文与建议完全相同 → 无 diff 标记（全 equal）', () => {
        const same = '甲方应于合同签订之日起三日内支付定金。'
        const w = mount(RiskClauseDiff, {
            props: { clauseText: same, suggestedClauseText: same },
        })

        const html = w.html()
        expect(html).not.toContain('bg-red-100')
        expect(html).not.toContain('bg-emerald-100')
        expect(w.text()).toContain(same)
    })

    it('建议增加了 "不少于 30 日" → 新增片段用 emerald bg 高亮', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '甲方应提前通知乙方。',
                suggestedClauseText: '甲方应提前不少于 30 日通知乙方。',
            },
        })

        const html = w.html()
        // 新增片段高亮
        expect(html).toContain('bg-emerald-100')
        // 原文栏没有被删除的内容
        expect(html).not.toContain('bg-red-100')
    })

    it('原文 "60 日" 建议 "30 日" → 原文栏 60 红色删除线，建议栏 30 绿色', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '争议应在 60 日内协商解决。',
                suggestedClauseText: '争议应在 30 日内协商解决。',
            },
        })

        const html = w.html()
        expect(html).toContain('bg-red-100')
        expect(html).toContain('line-through')
        expect(html).toContain('bg-emerald-100')
        expect(html).toContain('font-medium')
    })

    it('suggestedClauseText 为空 → fallback 到"无建议改写"（保留 M4 行为）', () => {
        const w = mount(RiskClauseDiff, {
            props: {
                clauseText: '本合同自双方签字盖章之日起生效。',
                suggestedClauseText: '',
            },
        })

        const html = w.html()
        expect(html).not.toContain('bg-red-100')
        expect(html).not.toContain('bg-emerald-100')
        expect(w.text()).toContain('无建议改写')
    })
})
