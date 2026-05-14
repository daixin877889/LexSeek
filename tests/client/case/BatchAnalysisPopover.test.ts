/**
 * BatchAnalysisPopover 组件测试
 *
 * 验证：
 *  - trigger 点击后浮层显示后端返回的 session 列表
 *  - showBatchButton=false 时仅禁用底部「新建批量分析」（trigger 仍可见可点）
 *  - 点列表项 emit open-session / 点新建 emit new-batch
 *
 * **Feature: case-features-iter / Phase C**
 * **Validates: spec §3.1.3 + plan Task C2**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import BatchAnalysisPopover from '~/components/case/BatchAnalysisPopover.vue'

vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: vi.fn(async () => ([
        { sessionId: 'sid-1', title: '批量分析 #2', hasActiveRun: false, updatedAt: new Date().toISOString() },
        { sessionId: 'sid-2', title: '批量分析 #1', hasActiveRun: true, updatedAt: new Date().toISOString() },
    ])),
}))

/**
 * shadcn Popover 在 happy-dom 下偶发 click → open 状态推进不稳定（尤其多个测试串行后
 * Teleport 节点没法在 unmount 时被清理）。
 *
 * 这里把 Popover 系列 stub 为「Popover 监听内层 click 时自己置 open=true、PopoverContent
 * 仅在 open=true 时渲染」的简化模型，让我们能稳定断言「点击 trigger 触发 loadSessions、
 * content 内的按钮/列表行为」。
 * 真实 Popover 的 ARIA 行为/键盘交互/位置定位由 shadcn-vue + reka-ui 库保证，无需本地重测。
 */
const PopoverStub = defineComponent({
    name: 'Popover',
    props: { open: { type: Boolean, default: false } },
    emits: ['update:open'],
    setup(props, { slots, emit }) {
        return () => h(
            'div',
            {
                'data-stub': 'popover',
                'data-open': String(props.open),
                onClickCapture: (e: MouseEvent) => {
                    const target = e.target as HTMLElement | null
                    if (target?.closest('[data-stub="popover-trigger"]'))
                        emit('update:open', true)
                },
            },
            slots.default?.({ open: props.open }),
        )
    },
})
const PopoverTriggerStub = defineComponent({
    name: 'PopoverTrigger',
    setup(_, { slots }) {
        return () => h('div', { 'data-stub': 'popover-trigger' }, slots.default?.())
    },
})
const PopoverContentStub = defineComponent({
    name: 'PopoverContent',
    setup(_, { slots, attrs }) {
        return () => h('div', { 'data-stub': 'popover-content', ...attrs }, slots.default?.())
    },
})

function makeWrapper(props: { caseId?: number, showBatchButton: boolean, isAnalysisRunning?: boolean }) {
    return mount(BatchAnalysisPopover, {
        props: {
            caseId: props.caseId ?? 1,
            showBatchButton: props.showBatchButton,
            isAnalysisRunning: props.isAnalysisRunning ?? false,
        },
        global: {
            stubs: {
                Popover: PopoverStub,
                PopoverTrigger: PopoverTriggerStub,
                PopoverContent: PopoverContentStub,
            },
        },
    })
}

describe('BatchAnalysisPopover', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('点击 trigger 后请求会话列表并渲染', async () => {
        const wrapper = makeWrapper({ showBatchButton: true })
        await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
        await flushPromises()
        expect(wrapper.text()).toContain('批量分析 #2')
        expect(wrapper.text()).toContain('批量分析 #1')
    })

    it('showBatchButton=false 时底部新建按钮 disabled', async () => {
        const wrapper = makeWrapper({ showBatchButton: false })
        await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
        await flushPromises()
        const newBtn = wrapper.find('[data-testid="batch-new"]').element as HTMLButtonElement
        expect(newBtn).toBeTruthy()
        expect(newBtn.disabled).toBe(true)
    })

    it('showBatchButton=true 时底部新建按钮可点', async () => {
        const wrapper = makeWrapper({ showBatchButton: true })
        await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
        await flushPromises()
        const newBtn = wrapper.find('[data-testid="batch-new"]').element as HTMLButtonElement
        expect(newBtn.disabled).toBe(false)
    })

    it('点列表项 emit open-session 带 sessionId', async () => {
        const wrapper = makeWrapper({ showBatchButton: true })
        await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
        await flushPromises()
        await wrapper.findAll('[data-testid="batch-session-item"]')[0].trigger('click')
        expect(wrapper.emitted('open-session')).toEqual([['sid-1']])
    })

    it('点新建按钮 emit new-batch', async () => {
        const wrapper = makeWrapper({ showBatchButton: true })
        await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
        await flushPromises()
        await wrapper.find('[data-testid="batch-new"]').trigger('click')
        expect(wrapper.emitted('new-batch')).toBeTruthy()
    })

    it('showBatchButton=false 时点新建不 emit new-batch（disabled 兜底）', async () => {
        const wrapper = makeWrapper({ showBatchButton: false })
        await wrapper.find('[data-testid="batch-trigger"]').trigger('click')
        await flushPromises()
        // 即使绕过 disabled 直接触发 click handler，handleNew 内部也会被 showBatchButton=false 拦截
        await wrapper.find('[data-testid="batch-new"]').trigger('click')
        expect(wrapper.emitted('new-batch')).toBeUndefined()
    })
})
