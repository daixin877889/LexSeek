/**
 * RiskCard 单元测试（从 RiskListPanel.test.ts 拆出来的子组件直测）
 *
 * 焦点：UI 视觉状态属性 → DOM 渲染（"未定位"标签 / 焦点 / 钉住 / hover / 已处置 等）。
 *
 * **Feature: contract-review-risk-card**
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import RiskCard from '~/components/assistant/contract/RiskCard.vue'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

// 透明 stub：保留 slot
const passthrough = (name: string) => defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
        return () => h('div', { 'data-stub': name, ...attrs }, slots.default?.())
    },
})

const stubs = {
    Card: passthrough('Card'),
    CardHeader: passthrough('CardHeader'),
    CardContent: passthrough('CardContent'),
    Badge: passthrough('Badge'),
    Button: passthrough('Button'),
    Textarea: passthrough('Textarea'),
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

function mountCard(props: Partial<{
    risk: RiskDisplayPhaseB
    expanded: boolean
    annotations: any[]
    readOnly: boolean
    isCompleted: boolean
    editable: boolean
    currentUserId: number | null
    isFocused: boolean
    isPinned: boolean
    isHovered: boolean
    isJustAdded: boolean
    isOrphaned: boolean
    archivedStatus: any
    notLocated: boolean
    playbookSnapshot: any
}> = {}) {
    return mount(RiskCard, {
        props: {
            risk: makeRisk(),
            expanded: false,
            annotations: [],
            readOnly: false,
            isCompleted: true,
            editable: true,
            ...props,
        } as any,
        global: { stubs },
    })
}

describe('RiskCard · 未定位标签（M6.1 Task 4.6.1）', () => {
    it('notLocated=true 时渲染 "未定位" 文字 + TriangleAlert 图标', () => {
        const w = mountCard({ notLocated: true })
        expect(w.text()).toContain('未定位')
        expect(w.find('.lucide-triangle-alert').exists()).toBe(true)
    })

    it('notLocated=false 时不渲染未定位标签', () => {
        const w = mountCard({ notLocated: false })
        expect(w.text()).not.toContain('未定位')
    })

    it('notLocated 未传时（默认 undefined）不渲染未定位标签', () => {
        const w = mountCard({})
        expect(w.text()).not.toContain('未定位')
    })
})

describe('RiskCard · 等级徽章', () => {
    it('high 等级渲染"高"', () => {
        const w = mountCard({ risk: makeRisk({ level: 'high' }) })
        expect(w.text()).toContain('高')
    })

    it('medium 等级渲染"中"', () => {
        const w = mountCard({ risk: makeRisk({ level: 'medium' }) })
        expect(w.text()).toContain('中')
    })

    it('low 等级渲染"低"', () => {
        const w = mountCard({ risk: makeRisk({ level: 'low' }) })
        expect(w.text()).toContain('低')
    })
})

describe('RiskCard · 已处置态', () => {
    it('archivedStatus=handled 渲染"已处理"', () => {
        const w = mountCard({ archivedStatus: 'handled' })
        expect(w.text()).toContain('已处理')
    })

    it('archivedStatus=ignored 渲染"已忽略"', () => {
        const w = mountCard({ archivedStatus: 'ignored' })
        expect(w.text()).toContain('已忽略')
    })

    it('archivedStatus=null 不渲染处置徽章', () => {
        const w = mountCard({ archivedStatus: null })
        expect(w.text()).not.toContain('已处理')
        expect(w.text()).not.toContain('已忽略')
    })
})

describe('RiskCard · 焦点 / 钉住 视觉状态', () => {
    it('isFocused=true 时附加 border-red-500 类', () => {
        const w = mountCard({ isFocused: true })
        expect(w.html()).toContain('border-red-500')
    })

    it('isPinned 且非 focused 时附加 border-orange-500', () => {
        const w = mountCard({ isPinned: true, isFocused: false })
        expect(w.html()).toContain('border-orange-500')
    })

    it('isPinned 且 focused 时焦点样式优先（border-red-500）', () => {
        const w = mountCard({ isPinned: true, isFocused: true })
        expect(w.html()).toContain('border-red-500')
    })
})

describe('RiskCard · 钉住按钮', () => {
    it('未钉住时按钮 aria-label="钉住"', () => {
        const w = mountCard({ isPinned: false })
        const btn = w.find('button[aria-label="钉住"]')
        expect(btn.exists()).toBe(true)
    })

    it('已钉住时按钮 aria-label="取消钉住"', () => {
        const w = mountCard({ isPinned: true })
        const btn = w.find('button[aria-label="取消钉住"]')
        expect(btn.exists()).toBe(true)
    })

    it('点击钉按钮 emit togglePin（@click.stop 不触发 focus）', async () => {
        const w = mountCard({ isPinned: false })
        await w.find('button[aria-label="钉住"]').trigger('click')
        expect(w.emitted('togglePin')).toBeTruthy()
        expect(w.emitted('togglePin')![0]).toEqual(['risk-1'])
        // 点击钉按钮不应触发卡片自身的 focus
        expect(w.emitted('focus')).toBeFalsy()
    })
})
