/**
 * RiskDetailPanel 单元测试
 *
 * 焦点：抽屉头上一条/下一条导航边界、关闭、只读禁用、处置 emit、孤立态分支。
 *
 * **Feature: contract-review-detail-page-redesign**
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import RiskDetailPanel from '~/components/assistant/contract/RiskDetailPanel.vue'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

// 透明 stub：保留 slot 与 attrs（含 onClick / disabled）
const passthrough = (name: string) => defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
        return () => h('div', { 'data-stub': name, ...attrs }, slots.default?.())
    },
})

const stubs = {
    Button: passthrough('Button'),
    TooltipProvider: passthrough('TooltipProvider'),
    Tooltip: passthrough('Tooltip'),
    TooltipTrigger: passthrough('TooltipTrigger'),
    TooltipContent: passthrough('TooltipContent'),
    AssistantContractAnnotationBubble: passthrough('AnnotationBubble'),
    AssistantContractRiskClauseDiff: passthrough('RiskClauseDiff'),
}

function makeRisk(over: Partial<RiskDisplayPhaseB> = {}): RiskDisplayPhaseB {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '原条款文本',
        level: 'high',
        category: '违约责任',
        problem: '违约金比例过高',
        analysis: '条款分析内容',
        risk: '法律风险说明',
        suggestion: '修改建议说明',
        legalBasis: null,
        matchedPointCode: null,
        suggestedClauseText: '建议改写文本',
        ...over,
    } as RiskDisplayPhaseB
}

function mountPanel(props: Partial<{
    risk: RiskDisplayPhaseB
    annotations: unknown[]
    index: number
    total: number
    readOnly: boolean
    isCompleted: boolean
    editable: boolean
    currentUserId: number | null
    isPinned: boolean
    playbookSnapshot: unknown
    layout: 'stacked' | 'inline-diff'
}> = {}) {
    return mount(RiskDetailPanel, {
        props: {
            risk: makeRisk(),
            annotations: [],
            index: 1,
            total: 3,
            readOnly: false,
            isCompleted: true,
            editable: true,
            isPinned: false,
            layout: 'stacked',
            ...props,
        } as Record<string, unknown>,
        global: { stubs },
    })
}

describe('RiskDetailPanel · 渲染', () => {
    it('渲染风险类别 / 问题概述 / 条款分析 / 法律风险 / 修改建议', () => {
        const w = mountPanel()
        const text = w.text()
        expect(text).toContain('违约责任')
        expect(text).toContain('违约金比例过高')
        expect(text).toContain('条款分析内容')
        expect(text).toContain('法律风险说明')
        expect(text).toContain('修改建议说明')
    })

    it('渲染当前下标 / 总数', () => {
        const w = mountPanel({ index: 1, total: 3 })
        expect(w.text()).toContain('2 / 3')
    })
})

describe('RiskDetailPanel · 上一条 / 下一条导航', () => {
    it('index=0 时上一条按钮禁用', () => {
        const w = mountPanel({ index: 0, total: 3 })
        const prev = w.find('button[aria-label="上一条风险"]').element as HTMLButtonElement
        expect(prev.disabled).toBe(true)
    })

    it('index=total-1 时下一条按钮禁用', () => {
        const w = mountPanel({ index: 2, total: 3 })
        const next = w.find('button[aria-label="下一条风险"]').element as HTMLButtonElement
        expect(next.disabled).toBe(true)
    })

    it('居中下标点上一条 / 下一条分别 emit prev / next', async () => {
        const w = mountPanel({ index: 1, total: 3 })
        await w.find('button[aria-label="上一条风险"]').trigger('click')
        expect(w.emitted('prev')).toBeTruthy()
        await w.find('button[aria-label="下一条风险"]').trigger('click')
        expect(w.emitted('next')).toBeTruthy()
    })
})

describe('RiskDetailPanel · 关闭 / 处置', () => {
    it('点关闭按钮 emit close', async () => {
        const w = mountPanel()
        await w.find('button[aria-label="关闭详情"]').trigger('click')
        expect(w.emitted('close')).toBeTruthy()
    })

    it('点"标记已处理" emit archive(risk.id, handled)', async () => {
        const w = mountPanel()
        const btn = w.findAll('[data-stub="Button"]').find(b => b.text().includes('标记已处理'))
        expect(btn).toBeTruthy()
        await btn!.trigger('click')
        expect(w.emitted('archive')).toEqual([['risk-1', 'handled']])
    })
})

describe('RiskDetailPanel · 只读模式', () => {
    it('readOnly=true 时不渲染批注回复框，显示只读提示', () => {
        const w = mountPanel({ readOnly: true })
        expect(w.find('textarea').exists()).toBe(false)
        expect(w.text()).toContain('只读模式，无法添加批注')
    })
})

describe('RiskDetailPanel · 孤立态', () => {
    it('orphaned=true 时不渲染分段/对照段控，底部显示"查看原始语境"', () => {
        const w = mountPanel({ risk: makeRisk({ orphaned: true, originalClauseText: '原始条款引文' }) })
        expect(w.text()).toContain('查看原始语境')
        expect(w.text()).not.toContain('分段')
        expect(w.text()).not.toContain('对照')
    })
})
