/**
 * AiToolRenderer interrupt 分支分发测试
 *
 * **Feature: interrupt-tool-card-inline / Task 5**
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, reactive, defineComponent, h } from 'vue'
import AiToolRenderer from '~/components/ai/AiToolRenderer.vue'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

const StubToolCard = defineComponent({
    props: ['interrupt', 'resumeValue'],
    setup(props) {
        return () => h('div', {
            class: 'stub-tool-card',
            'data-mode': props.resumeValue !== undefined ? 'snapshot' : 'active',
        }, JSON.stringify(props))
    },
})

const StubResultCard = defineComponent({
    props: ['toolName', 'output'],
    setup(props) {
        return () => h('div', { class: 'stub-result-card' }, props.toolName)
    },
})

beforeAll(() => {
    globalInterruptRegistry.register('stub_tool_select', StubToolCard, { isToolCard: true })
})

afterAll(() => {
    // 清理全局注册表，避免污染后续测试文件（registry 是 module 级单例）
    const handlers = (globalInterruptRegistry as any).handlers as Map<string, unknown>
    handlers?.delete?.('stub_tool_select')
})

function makeContext(opts: {
    interruptData?: any
    resolvedInterrupts?: Record<string, any>
}) {
    return {
        interruptData: ref(opts.interruptData ?? null),
        resolvedInterrupts: reactive(opts.resolvedInterrupts ?? {}),
        resolveInterrupt: vi.fn(),
    }
}

describe('AiToolRenderer - interrupt 分支', () => {
    it('active interrupt 命中 toolCallId → 渲染 InterruptDispatcher（active 模式）', () => {
        const ctx = makeContext({
            interruptData: { type: 'stub_tool_select', toolCallId: 'call_x' },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_x', name: 'stub_tool', args: {}, state: 'input-available' },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        const card = wrapper.find('.stub-tool-card')
        expect(card.exists()).toBe(true)
        expect(card.attributes('data-mode')).toBe('active')
        expect(wrapper.find('.stub-result-card').exists()).toBe(false)
    })

    it('resolved interrupt + tool 已完成 → 同时渲染 snapshot + 完成态', () => {
        const ctx = makeContext({
            resolvedInterrupts: {
                call_x: {
                    interrupt: { type: 'stub_tool_select', toolCallId: 'call_x' },
                    resumeValue: { picked: 1 },
                    resolvedAt: new Date(),
                },
            },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_x', name: 'stub_tool', args: {}, result: { ok: true }, state: 'output-available' },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        const card = wrapper.find('.stub-tool-card')
        expect(card.exists()).toBe(true)
        expect(card.attributes('data-mode')).toBe('snapshot')
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('resolved interrupt + tool 未完成（用户取消） → 仅渲染 snapshot', () => {
        const ctx = makeContext({
            resolvedInterrupts: {
                call_x: {
                    interrupt: { type: 'stub_tool_select', toolCallId: 'call_x' },
                    resumeValue: null,
                    resolvedAt: new Date(),
                },
            },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_x', name: 'stub_tool', args: {}, state: 'input-available' },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        expect(wrapper.find('.stub-tool-card').exists()).toBe(true)
        expect(wrapper.find('.stub-result-card').exists()).toBe(false)
    })

    it('普通工具（非 isToolCard interrupt）→ 走 toolMap 默认分支', () => {
        const ctx = makeContext({})
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_y', name: 'stub_tool', args: {}, state: 'output-available', result: {} },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        expect(wrapper.find('.stub-tool-card').exists()).toBe(false)
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('messageStreamContext 未 provide 时 → 不影响普通工具渲染（向后兼容）', () => {
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_z', name: 'stub_tool', args: {}, state: 'output-available', result: {} },
                toolMap: { stub_tool: StubResultCard },
            },
        })
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    // 用户报告：点"使用此模板"后卡片状态没变（仍 active 可点）
    // 根因：resume 后 stream.values.__interrupt__ 还没被新 SSE 帧覆盖，active 仍命中
    // 修复：用 LangGraph _interruptId 区分"过渡态"vs"重新触发"
    it('active 与 resolved 同 _interruptId（resume 过渡态）→ 走 resolved snapshot 视图', () => {
        const ctx = makeContext({
            interruptData: {
                type: 'stub_tool_select',
                toolCallId: 'call_x',
                _interruptId: 'intr-abc',  // 同一个 interrupt id
            },
            resolvedInterrupts: {
                call_x: {
                    interrupt: { type: 'stub_tool_select', toolCallId: 'call_x', _interruptId: 'intr-abc' },
                    resumeValue: { picked: 1 },
                    resolvedAt: new Date(),
                },
            },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_x', name: 'stub_tool', args: {}, state: 'input-available' },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        // 应走 snapshot 模式（resumeValue 透传）—— 而不是 active
        expect(wrapper.find('.stub-tool-card').attributes('data-mode')).toBe('snapshot')
    })

    it('active 与 resolved 不同 _interruptId（agent 重新触发）→ active 优先', () => {
        const ctx = makeContext({
            interruptData: {
                type: 'stub_tool_select',
                toolCallId: 'call_x',
                _interruptId: 'intr-NEW',  // 新触发的 interrupt
            },
            resolvedInterrupts: {
                call_x: {
                    interrupt: { type: 'stub_tool_select', toolCallId: 'call_x', _interruptId: 'intr-OLD' },
                    resumeValue: { picked: 1 },
                    resolvedAt: new Date(),
                },
            },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call_x', name: 'stub_tool', args: {}, state: 'input-available' },
                toolMap: { stub_tool: StubResultCard },
            },
            global: { provide: { messageStreamContext: ctx } },
        })
        // 不同 id → 视为新 interrupt，走 active 模式（resumeValue undefined → 默认选 backend score 最高）
        expect(wrapper.find('.stub-tool-card').attributes('data-mode')).toBe('active')
    })
})
