/**
 * ContractDocxPreview · quote 字符级高亮集成测试
 *
 * **Feature: contract-review-precise-anchoring (PR 5)**
 * **Validates: spec § 7.3.3 / 7.4 / 6.4 在组件层的接入**
 *
 * 4 个场景：
 *  1. CSS.highlights 不可用时 mount 不抛错（spec § 7.3.3 早出降级）
 *  2. quote=null 的 risk 透传到工具（由工具内部按 § 6.4 跳过）
 *  3. 切换 reviewedFileId 触发 clearAllQuoteHighlights（spec § 7.4 重渲染保护）
 *  4. focusedRiskId 变化触发 decorateQuoteRanges 重画
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

// vi.hoisted 把 mock fn 提到 vi.mock factory 之前可用
const hoisted = vi.hoisted(() => ({
    mockRenderAsync: vi.fn(async (_buf: ArrayBuffer, target: HTMLElement) => {
        target.innerHTML = `
            <div class="docx-wrapper">
                <section class="docx">
                    <p>第三条 工资支付</p>
                    <p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>
                </section>
            </div>
        `
    }),
    mockUseApiFetch: vi.fn(async () => ([{ ossFileId: 1, downloadUrl: 'http://mock-oss/file.docx' }])),
    mockDecorateQuoteRanges: vi.fn(),
    mockClearAllQuoteHighlights: vi.fn(),
}))

vi.mock('docx-preview', () => ({ renderAsync: hoisted.mockRenderAsync }))
vi.mock('~/composables/useApiFetch', () => ({ useApiFetch: hoisted.mockUseApiFetch }))
vi.mock('~/utils/quoteHighlight', () => ({
    decorateQuoteRanges: hoisted.mockDecorateQuoteRanges,
    clearAllQuoteHighlights: hoisted.mockClearAllQuoteHighlights,
}))

vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })))

import ContractDocxPreview from '~/components/assistant/contract/ContractDocxPreview.vue'

function makeRisk(over: Partial<RiskDisplayPhaseB> = {}): RiskDisplayPhaseB {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。',
        clauseParagraphIndex: 1,
        level: 'medium',
        category: '违约金',
        problem: '违约金过低',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        problematicQuote: '每日按 0.05% 加收滞纳金',
        quoteCharStart: 13,
        quoteCharEnd: 26,
        ...over,
    } as RiskDisplayPhaseB
}

describe('ContractDocxPreview · quote 字符级高亮集成', () => {
    beforeEach(() => {
        hoisted.mockDecorateQuoteRanges.mockClear()
        hoisted.mockClearAllQuoteHighlights.mockClear()
        hoisted.mockRenderAsync.mockClear()
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('CSS.highlights 不可用时 mount 不抛错（spec § 7.3.3 早出降级）', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: { reviewedFileId: 1, originalFileId: null, risks: [makeRisk()] },
        })
        await flushPromises()
        // 行为契约：组件确实调用了工具，由工具内部决定渲不渲染
        expect(hoisted.mockDecorateQuoteRanges).toHaveBeenCalled()
        wrapper.unmount()
    })

    it('quote=null 的 risk 透传到 decorateQuoteRanges（由工具按 § 6.4 跳过）', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: {
                reviewedFileId: 1,
                originalFileId: null,
                risks: [makeRisk({ problematicQuote: null, quoteCharStart: null, quoteCharEnd: null })],
            },
        })
        await flushPromises()
        const lastCall = hoisted.mockDecorateQuoteRanges.mock.calls.at(-1)
        const passedRisks = lastCall?.[0] as RiskDisplayPhaseB[]
        expect(passedRisks[0]?.quoteCharStart).toBeNull()
        wrapper.unmount()
    })

    it('切换 reviewedFileId 触发 clearAllQuoteHighlights（spec § 7.4 重渲染保护）', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: { reviewedFileId: 1, originalFileId: null, risks: [makeRisk()] },
        })
        await flushPromises()
        const before = hoisted.mockClearAllQuoteHighlights.mock.calls.length

        await wrapper.setProps({ reviewedFileId: 2 })
        await flushPromises()

        expect(hoisted.mockClearAllQuoteHighlights.mock.calls.length).toBeGreaterThan(before)
        wrapper.unmount()
    })

    it('focusedRiskId 变化触发 decorateQuoteRanges 重画', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: {
                reviewedFileId: 1,
                originalFileId: null,
                risks: [makeRisk(), makeRisk({ id: 'risk-2' })],
                focusedRiskId: null,
            },
        })
        await flushPromises()
        const before = hoisted.mockDecorateQuoteRanges.mock.calls.length

        await wrapper.setProps({ focusedRiskId: 'risk-1' })
        await nextTick()

        expect(hoisted.mockDecorateQuoteRanges.mock.calls.length).toBeGreaterThan(before)
        const lastCall = hoisted.mockDecorateQuoteRanges.mock.calls.at(-1)
        const passedState = lastCall?.[2] as { focusedRiskId: string | null; flashWindowActive: boolean }
        expect(passedState.focusedRiskId).toBe('risk-1')
        // focusedRiskId 切换时 flashWindowActive 应为 true（1 秒衰减窗口启动）
        expect(passedState.flashWindowActive).toBe(true)
        wrapper.unmount()
    })
})
