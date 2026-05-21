import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ContractReviewCard from '~/components/assistant/contract/ContractReviewCard.vue'
import type { ReviewListItem } from '#shared/types/contract'

/**
 * ContractReviewCard 单元测试
 *
 * 组件职责：
 * - 渲染合同名（缺失时显示「未命名合同」）、状态徽章、合同类型
 * - 渲染高/中风险条数；totalRiskCount=0 时显示「暂无风险」
 * - caseId 存在时显示「归属案件 #X」
 * - 点击删除按钮 emit delete(review)
 */

const NuxtLinkStub = defineComponent({
    name: 'NuxtLink',
    props: { to: { type: String, default: '' } },
    setup(props, { slots, attrs }) {
        return () => h('a', { href: props.to, ...attrs }, slots.default?.())
    },
})

function makeReview(over: Partial<ReviewListItem> = {}): ReviewListItem {
    return {
        id: 1, sessionId: 's1', caseId: null, contractType: '股权转让协议',
        partyA: null, partyB: null, stance: null, status: 'completed',
        summary: null, originalFileName: '股权转让协议.docx', hasUnsavedDocxChanges: false,
        highRiskCount: 0, mediumRiskCount: 0, totalRiskCount: 0,
        createdAt: new Date('2026-05-10T08:00:00Z'), updatedAt: new Date('2026-05-10T08:00:00Z'),
        ...over,
    }
}

function mountCard(review: ReviewListItem) {
    return mount(ContractReviewCard, {
        props: { review },
        global: { stubs: { NuxtLink: NuxtLinkStub } },
    })
}

describe('ContractReviewCard', () => {
    it('渲染合同名与状态标签', () => {
        const w = mountCard(makeReview())
        expect(w.text()).toContain('股权转让协议.docx')
        expect(w.text()).toContain('已完成')
    })

    it('originalFileName 为空时显示「未命名合同」', () => {
        const w = mountCard(makeReview({ originalFileName: null }))
        expect(w.text()).toContain('未命名合同')
    })

    it('有高/中风险时分别渲染条数', () => {
        const w = mountCard(makeReview({ highRiskCount: 3, mediumRiskCount: 2, totalRiskCount: 5 }))
        expect(w.text()).toContain('3 高')
        expect(w.text()).toContain('2 中')
    })

    it('无风险时显示「暂无风险」', () => {
        const w = mountCard(makeReview({ totalRiskCount: 0 }))
        expect(w.text()).toContain('暂无风险')
    })

    it('有 caseId 时显示归属案件', () => {
        const w = mountCard(makeReview({ caseId: 42 }))
        expect(w.text()).toContain('归属案件 #42')
    })

    it('点击删除按钮 emit delete 并携带 review', async () => {
        const w = mountCard(makeReview())
        await w.find('button[aria-label="删除审查"]').trigger('click')
        const emitted = w.emitted('delete')
        expect(emitted).toBeTruthy()
        expect((emitted![0][0] as ReviewListItem).id).toBe(1)
    })
})
