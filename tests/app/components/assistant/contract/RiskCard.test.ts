/**
 * RiskCard 单元测试（重做后：纯卡片）
 *
 * 焦点：等级徽章 / 状态徽章 / 未定位 / 分态着色 / 钉按钮 / 点卡片 focus emit。
 * 详情渲染与操作已迁移至 RiskDetailPanel，对应测试见 RiskDetailPanel.test.ts。
 *
 * **Feature: contract-review-detail-page-redesign**
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RiskCard from '~/components/assistant/contract/RiskCard.vue'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

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
    isFocused: boolean
    isPinned: boolean
    isHovered: boolean
    isJustAdded: boolean
    isOrphaned: boolean
    archivedStatus: 'handled' | 'ignored' | null
    notLocated: boolean
    playbookSnapshot: unknown
}> = {}) {
    return mount(RiskCard, {
        props: { risk: makeRisk(), ...props } as Record<string, unknown>,
    })
}

describe('RiskCard · 未定位标签', () => {
    it('notLocated=true 渲染"未定位"文字', () => {
        expect(mountCard({ notLocated: true }).text()).toContain('未定位')
    })

    it('notLocated=false 不渲染未定位标签', () => {
        expect(mountCard({ notLocated: false }).text()).not.toContain('未定位')
    })

    it('notLocated 未传时（默认 undefined）不渲染未定位标签', () => {
        expect(mountCard({}).text()).not.toContain('未定位')
    })
})

describe('RiskCard · 等级徽章', () => {
    it('high 等级渲染"高"', () => {
        expect(mountCard({ risk: makeRisk({ level: 'high' }) }).text()).toContain('高')
    })

    it('medium 等级渲染"中"', () => {
        expect(mountCard({ risk: makeRisk({ level: 'medium' }) }).text()).toContain('中')
    })

    it('low 等级渲染"低"', () => {
        expect(mountCard({ risk: makeRisk({ level: 'low' }) }).text()).toContain('低')
    })
})

describe('RiskCard · 已处置态', () => {
    it('archivedStatus=handled 渲染"已处理"', () => {
        expect(mountCard({ archivedStatus: 'handled' }).text()).toContain('已处理')
    })

    it('archivedStatus=ignored 渲染"已忽略"', () => {
        expect(mountCard({ archivedStatus: 'ignored' }).text()).toContain('已忽略')
    })

    it('archivedStatus=null 不渲染处置徽章', () => {
        const t = mountCard({ archivedStatus: null }).text()
        expect(t).not.toContain('已处理')
        expect(t).not.toContain('已忽略')
    })
})

describe('RiskCard · 分态着色', () => {
    it('isFocused（high）附加等级聚焦色 border-l-red-600 + ring', () => {
        const card = mountCard({ isFocused: true, risk: makeRisk({ level: 'high' }) })
        expect(card.classes()).toContain('border-l-red-600')
        expect(card.classes()).toContain('ring-2')
    })

    it('isPinned 且非 focused 时附加 border-l-orange-500', () => {
        const card = mountCard({ isPinned: true, isFocused: false })
        expect(card.classes()).toContain('border-l-orange-500')
    })

    it('isPinned 且 focused 时焦点样式优先（border-l-red-600）', () => {
        const card = mountCard({ isPinned: true, isFocused: true, risk: makeRisk({ level: 'high' }) })
        expect(card.classes()).toContain('border-l-red-600')
        expect(card.classes()).not.toContain('border-l-orange-500')
    })
})

describe('RiskCard · 钉住按钮', () => {
    it('未钉住时按钮 aria-label="钉住"', () => {
        expect(mountCard({ isPinned: false }).find('button[aria-label="钉住"]').exists()).toBe(true)
    })

    it('已钉住时按钮 aria-label="取消钉住"', () => {
        expect(mountCard({ isPinned: true }).find('button[aria-label="取消钉住"]').exists()).toBe(true)
    })

    it('点钉按钮 emit toggle-pin（@click.stop 不触发 focus）', async () => {
        const w = mountCard({ isPinned: false })
        await w.find('button[aria-label="钉住"]').trigger('click')
        expect(w.emitted('toggle-pin')).toBeTruthy()
        expect(w.emitted('toggle-pin')![0]).toEqual(['risk-1'])
        expect(w.emitted('focus')).toBeFalsy()
    })

    it('孤立卡不渲染钉按钮', () => {
        expect(mountCard({ isOrphaned: true }).find('button[aria-label="钉住"]').exists()).toBe(false)
    })
})

describe('RiskCard · 点击', () => {
    it('点卡片 emit focus(risk.id)', async () => {
        const w = mountCard()
        await w.find('[data-risk-id="risk-1"]').trigger('click')
        expect(w.emitted('focus')).toBeTruthy()
        expect(w.emitted('focus')![0]).toEqual(['risk-1'])
    })
})
