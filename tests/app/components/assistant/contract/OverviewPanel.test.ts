import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, computed, type Ref } from 'vue'

/**
 * OverviewPanel 单元测试
 *
 * **Feature: contract-review-m6-1**
 * **Validates: Task 3.3 - 分档总览区组件**
 *
 * 覆盖 4 个用例：
 * 1. 完整渲染（仪表盘 + 三色计数 + 每档要点 + 总评）
 * 2. summary.highlights 为 null 时只渲染仪表盘 + 三色计数 + overall
 * 3. 点击要点 emit focusRisk(riskId)
 * 4. 三色计数卡为纯展示不可点（tagName !== 'button'）
 */

import type { Risk, ContractOverview } from '#shared/types/contract'

// mock useContractPlaybookMatch，避免依赖实际实现
vi.mock('~/composables/useContractPlaybookMatch', () => ({
    useContractPlaybookMatch: () => ({
        enabled: computed(() => false),
        total: computed(() => 0),
        hitCount: computed(() => 0),
        hits: computed(() => []),
        misses: computed(() => []),
        extras: computed(() => []),
    }),
}))

// mock useContractOverview，避免依赖 Nuxt 自动导入上下文
vi.mock('~/composables/useContractOverview', () => ({
    useContractOverview: (risks: Ref<Risk[] | null>) => {
        const counts = computed(() => {
            const list = risks.value ?? []
            return {
                high: list.filter(r => r.level === 'high').length,
                medium: list.filter(r => r.level === 'medium').length,
                low: list.filter(r => r.level === 'low').length,
            }
        })
        const score = computed(() => {
            const c = counts.value
            return Math.min(100, Math.round(3 * c.high + 1.5 * c.medium + 0.5 * c.low))
        })
        const scoreLabel = computed(() => {
            const s = score.value
            if (s >= 70) return '极高风险'
            if (s >= 50) return '风险偏高，建议谈判'
            if (s >= 30) return '风险可控'
            return '低风险'
        })
        return { counts, score, scoreLabel }
    },
}))

// mock lucide-vue-next 图标（测试环境无需真实渲染 SVG）
vi.mock('lucide-vue-next', () => ({
    TriangleAlert: defineComponent({
        name: 'TriangleAlert',
        setup: () => () => h('i', { 'data-stub': 'TriangleAlert' }),
    }),
    Info: defineComponent({
        name: 'Info',
        setup: () => () => h('i', { 'data-stub': 'Info' }),
    }),
    ClipboardList: defineComponent({
        name: 'ClipboardList',
        setup: () => () => h('i', { 'data-stub': 'ClipboardList' }),
    }),
    ChevronDown: defineComponent({
        name: 'ChevronDown',
        setup: () => () => h('i', { 'data-stub': 'ChevronDown' }),
    }),
}))

const OverviewPanel = (await import('~/components/assistant/contract/OverviewPanel.vue')).default

function makeRisk(over: Partial<Risk> = {}): Risk {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '原条款文本',
        level: 'high',
        category: '违约责任',
        problem: '违约金比例过高',
        analysis: '分析内容',
        risk: '法律风险说明',
        suggestion: '修改建议说明',
        suggestedClauseText: '建议改写文本',
        ...over,
    }
}

function makeSummary(over: Partial<ContractOverview> = {}): ContractOverview {
    return {
        highlights: {
            high: [{ text: '高风险要点文字', riskId: 'risk-h1' }],
            medium: [{ text: '中风险要点文字', riskId: 'risk-m1' }],
            low: [{ text: '低风险要点文字', riskId: 'risk-l1' }],
        },
        overall: '合同整体风险偏高，建议谈判核心条款。',
        ...over,
    }
}

describe('OverviewPanel', () => {
    it('完整渲染：仪表盘 + 三色计数 + 每档要点 + 总评', () => {
        const risks = [
            makeRisk({ id: 'h1', level: 'high' }),
            makeRisk({ id: 'm1', level: 'medium' }),
            makeRisk({ id: 'l1', level: 'low' }),
        ]
        const summary = makeSummary()
        const w = mount(OverviewPanel, { props: { risks, summary, playbookSnapshot: null } })

        // 仪表盘：risk score 存在（3*1 + 1.5*1 + 0.5*1 = 5）
        expect(w.html()).toContain('合同风险分')

        // 三色计数
        expect(w.find('[data-count="high"]').exists()).toBe(true)
        expect(w.find('[data-count="medium"]').exists()).toBe(true)
        expect(w.find('[data-count="low"]').exists()).toBe(true)

        // 要点（highlights 非空）
        expect(w.text()).toContain('高风险要点文字')
        expect(w.text()).toContain('中风险要点文字')
        expect(w.text()).toContain('低风险要点文字')

        // 总评
        expect(w.text()).toContain('合同整体风险偏高，建议谈判核心条款。')
    })

    it('summary.highlights 为 null 时只渲染仪表盘 + 三色计数 + overall，不渲染要点', () => {
        const summary: ContractOverview = {
            highlights: null,
            overall: '总评内容，highlights 缺失降级显示。',
        }
        const w = mount(OverviewPanel, { props: { risks: [], summary, playbookSnapshot: null } })

        // 仪表盘 + 计数仍渲染
        expect(w.find('[data-count="high"]').exists()).toBe(true)
        expect(w.find('[data-count="medium"]').exists()).toBe(true)
        expect(w.find('[data-count="low"]').exists()).toBe(true)

        // overall 显示
        expect(w.text()).toContain('总评内容，highlights 缺失降级显示。')

        // 要点不渲染
        expect(w.find('button[data-highlight]').exists()).toBe(false)
    })

    it('点击某条要点 emit focusRisk(riskId)', async () => {
        const summary = makeSummary()
        const w = mount(OverviewPanel, { props: { risks: [], summary, playbookSnapshot: null } })

        // 找高风险要点按钮（data-riskid="risk-h1"）
        const btn = w.find('[data-riskid="risk-h1"]')
        expect(btn.exists()).toBe(true)
        await btn.trigger('click')

        expect(w.emitted('focusRisk')).toBeTruthy()
        expect(w.emitted('focusRisk')![0]).toEqual(['risk-h1'])
    })

    it('三色计数卡为纯展示不可点，tagName !== button', () => {
        const w = mount(OverviewPanel, { props: { risks: [], summary: null, playbookSnapshot: null } })

        const highCard = w.find('[data-count="high"]')
        const medCard = w.find('[data-count="medium"]')
        const lowCard = w.find('[data-count="low"]')

        expect(highCard.element.tagName.toLowerCase()).not.toBe('button')
        expect(medCard.element.tagName.toLowerCase()).not.toBe('button')
        expect(lowCard.element.tagName.toLowerCase()).not.toBe('button')
    })
})
