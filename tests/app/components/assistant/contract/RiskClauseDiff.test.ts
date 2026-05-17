/**
 * RiskClauseDiff 双布局单元测试（PR 4）
 *
 * **Feature: contract-review-risk-card-layout**
 *
 * stacked（Layout A）：四段式渲染、quote 字符级高亮、问题片段降级、段落徽章
 * inline-diff（Layout C）：行内 diff 渲染、quote=null 严格降级、双向防御 null 输入
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RiskClauseDiff from '~/components/assistant/contract/RiskClauseDiff.vue'

function mountStacked(props: {
    clauseText?: string
    suggestedClauseText?: string
    problematicQuote?: string | null
    quoteCharStart?: number | null
    quoteCharEnd?: number | null
    clauseParagraphIndex?: number | null
} = {}) {
    return mount(RiskClauseDiff, {
        props: { mode: 'stacked', ...props },
    })
}

function mountInline(props: {
    clauseText?: string
    suggestedClauseText?: string
    problematicQuote?: string | null
} = {}) {
    return mount(RiskClauseDiff, {
        props: { mode: 'inline-diff', ...props },
    })
}

describe('RiskClauseDiff · stacked（Layout A）', () => {
    it('渲染四段标签：条款标题 / 完整原文 / 建议改写（quote=null 时无问题片段）', () => {
        const w = mountStacked({
            clauseText: '第三条 工资支付\n工资按月支付。',
            suggestedClauseText: '工资按月底前最后一个工作日结算。',
        })
        const text = w.text()
        expect(text).toContain('条款标题')
        expect(text).toContain('第三条 工资支付')
        expect(text).toContain('完整原文')
        expect(text).toContain('建议改写')
        expect(text).not.toContain('问题片段')
    })

    it('clauseParagraphIndex 非空 → 标题旁渲染"（第 N 段）"徽章（spec § 6.1 mockup）', () => {
        const w = mountStacked({
            clauseText: '第三条 工资支付\n工资按月支付。',
            clauseParagraphIndex: 4,
        })
        // 0-based 转 1-based 显示
        expect(w.text()).toContain('（第 5 段）')
    })

    it('clauseParagraphIndex 为 null → 不渲染段落徽章', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            clauseParagraphIndex: null,
        })
        expect(w.text()).not.toContain('（第')
    })

    it('quote 字符段命中时渲染深黄高亮 <mark>', () => {
        // clauseText="工资按月支付。逾期付款滞纳金 0.05%。"，quote 落在 "0.05%"
        const clause = '工资按月支付。逾期付款滞纳金 0.05%。'
        const start = clause.indexOf('0.05%')
        const w = mountStacked({
            clauseText: clause,
            suggestedClauseText: '工资按月底前最后一个工作日结算。',
            problematicQuote: '0.05%',
            quoteCharStart: start,
            quoteCharEnd: start + '0.05%'.length,
        })
        const mark = w.find('mark')
        expect(mark.exists()).toBe(true)
        expect(mark.text()).toBe('0.05%')
    })

    it('quoteCharStart/End 任一为 null → 不渲染 <mark>', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            suggestedClauseText: '工资按月底前结算。',
            problematicQuote: null,
            quoteCharStart: null,
            quoteCharEnd: null,
        })
        expect(w.find('mark').exists()).toBe(false)
    })

    it('quoteCharStart 越界（start < 0 或 end > clauseText.length）→ 整段平铺，不抛错', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            quoteCharStart: 100,
            quoteCharEnd: 105,
        })
        expect(w.find('mark').exists()).toBe(false)
        expect(w.text()).toContain('工资按月支付')
    })

    it('problematicQuote 非空 → 渲染问题片段框', () => {
        const w = mountStacked({
            clauseText: '工资按月支付。',
            problematicQuote: '工资按月支付',
        })
        expect(w.text()).toContain('问题片段')
        expect(w.text()).toContain('工资按月支付')
    })

    it('suggestedClauseText 为空 → 显示"无建议改写"', () => {
        const w = mountStacked({ clauseText: '工资按月支付。' })
        expect(w.text()).toContain('无建议改写')
    })

    it('clauseText 为 undefined → 不抛错', () => {
        const w = mountStacked({})
        expect(() => w.text()).not.toThrow()
    })
})

describe('RiskClauseDiff · inline-diff（Layout C）', () => {
    it('clauseText + suggestedClauseText + problematicQuote 都非空 → 渲染 dmp diff 段', () => {
        const w = mountInline({
            // 选取真正含 insert+delete 的差异：'三日' → '五个工作日'（既删又增）
            clauseText: '甲方应于三日内支付定金',
            suggestedClauseText: '甲方应于五个工作日内支付预付款',
            problematicQuote: '三日',
        })
        // 至少应有 line-through（删除段）和 bg-emerald-600/15（新增段）class 出现
        const html = w.html()
        expect(html).toContain('line-through')
        expect(html).toContain('bg-emerald-600/15')
    })

    it('problematicQuote=null（quote 锚点解析失败）→ 严格降级显示纯 clauseText（spec § 6.4）', () => {
        const w = mountInline({
            clauseText: '逾期按 0.05% 加收滞纳金',
            suggestedClauseText: '逾期按 0.5% 加收滞纳金',
            problematicQuote: null,
        })
        // 不应有 diff 视觉 class
        const html = w.html()
        expect(html).not.toContain('line-through')
        expect(html).not.toContain('bg-emerald-600/15')
        expect(w.text()).toContain('逾期按 0.05% 加收滞纳金')
    })

    it('suggestedClauseText 为空 → 降级显示 clauseText 不抛错', () => {
        const w = mountInline({ clauseText: '工资按月支付。', problematicQuote: '工资按月支付' })
        expect(w.text()).toContain('工资按月支付。')
    })

    it('clauseText 为 undefined → 不抛错（不调用 dmp.diff_main）', () => {
        const w = mountInline({ suggestedClauseText: '工资按月底前结算。' })
        expect(() => w.text()).not.toThrow()
    })

    it('两侧都 undefined → 渲染空，不抛错', () => {
        const w = mountInline({})
        expect(() => w.text()).not.toThrow()
    })

    it('clauseText === suggestedClauseText（无变更）+ problematicQuote 非空 → 渲染无 diff class', () => {
        // dmp.diff_main 对完全相同文本返回全 equal segments，不应渲染 line-through / font-medium
        const same = '甲方应支付定金 10 万元'
        const w = mountInline({
            clauseText: same,
            suggestedClauseText: same,
            problematicQuote: '甲方应支付定金',
        })
        const html = w.html()
        expect(html).not.toContain('line-through')
        expect(html).not.toContain('bg-emerald-600/15')
        expect(w.text()).toContain(same)
    })
})
