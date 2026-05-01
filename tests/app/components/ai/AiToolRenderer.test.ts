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

describe('AiToolRenderer - SUB_AGENT_LIKE 双卡分支（draft_document / review_contract）', () => {
    function makeSubAccess(toolCallId: string, opts: {
        messages?: any[]
        status?: 'running' | 'completed' | 'failed'
        error?: string
    }) {
        return {
            subThreadsMap: {
                [toolCallId]: {
                    agentName: 'documentMain',
                    threadId: 'sub-x',
                    messages: opts.messages ?? [],
                    status: opts.status ?? 'completed',
                    error: opts.error,
                },
            },
        }
    }

    it('draft_document 跑中（state=input-available + isRunning） → 仅 SubAgentChainOfThought', () => {
        const subAccess = makeSubAccess('call-d1', { status: 'running' })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-d1', name: 'draft_document', args: {}, state: 'input-available' },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
        expect(wrapper.find('.stub-result-card').exists()).toBe(false)
    })

    it('draft_document 跑完（state=output-available + 有 messages） → CoT + 结果卡都在', () => {
        const subAccess = makeSubAccess('call-d2', {
            messages: [{ type: 'ai', content: 'done' }],
            status: 'completed',
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-d2',
                    name: 'draft_document',
                    args: {},
                    result: { ok: true },
                    state: 'output-available',
                },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('draft_document cancelled（无 messages、未 running、未 failed） → 仅 结果卡，不显示空 CoT', () => {
        const subAccess = makeSubAccess('call-d3', { status: 'completed', messages: [] })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-d3',
                    name: 'draft_document',
                    args: {},
                    result: { cancelled: true },
                    state: 'output-available',
                },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(false)
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('draft_document 失败（isFailed=true）→ CoT 显示，failureReason 透传', () => {
        const subAccess = makeSubAccess('call-d4', { status: 'failed', error: '模型超时' })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-d4',
                    name: 'draft_document',
                    args: {},
                    state: 'input-available',
                },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        const cot = wrapper.findComponent({ name: 'SubAgentChainOfThought' })
        expect(cot.exists()).toBe(true)
        expect(cot.props('isFailed')).toBe(true)
        expect(cot.props('failureReason')).toBe('模型超时')
    })

    it('review_contract → agentTitle="合同审查"', () => {
        const subAccess = makeSubAccess('call-r1', { status: 'running' })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-r1', name: 'review_contract', args: {}, state: 'input-available' },
                toolMap: { review_contract: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        const cot = wrapper.findComponent({ name: 'SubAgentChainOfThought' })
        expect(cot.exists()).toBe(true)
        expect(cot.props('agentTitle')).toBe('合同审查')
    })

    it('legacy ask_*_expert 分支保持工作（回归保护）', () => {
        const subAccess = makeSubAccess('call-leg', {
            messages: [{ type: 'ai', content: '专家分析' }],
            status: 'completed',
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-leg',
                    name: 'ask_evidence_expert',
                    args: {},
                    state: 'output-available',
                    result: 'expert reply',
                },
                toolMap: {},
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
    })

    it('interrupt 期间 CoT 与 interrupt 卡共存：CoT 顶部独立渲染（修复跑中黑盒）', () => {
        // 行为变更：旧版 v-if 链让 isInterruptToolCardCall 屏蔽 SubAgentChainOfThought，
        // 导致 interrupt 阻塞期间用户看不到子流跑过的思考。新版 CoT 提到 v-if 顶部，
        // 跟 interrupt 卡共存。前置：subAccess 含 messages（守卫 shouldShowSubAgentCoT 通过）。
        const subAccess = makeSubAccess('call-int', {
            messages: [{ type: 'ai', content: '已搜过法规' }],
            status: 'running',
        })
        const ctx = makeContext({
            interruptData: { type: 'stub_tool_select', toolCallId: 'call-int' },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-int', name: 'draft_document', args: {}, state: 'input-available' },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: ctx } },
        })
        // CoT 卡 + interrupt dispatch 卡都存在
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
        expect(wrapper.find('.stub-tool-card').exists()).toBe(true)
    })

    it('interrupt + 无子流数据：仅 interrupt 卡渲染，不显示空 CoT（守卫生效）', () => {
        // 边界保护：interrupt 触发但 subThreadsMap 还没数据（子流尚未启动）—
        // shouldShowSubAgentCoT 守卫返回 false，CoT 不出现，避免空白卡。
        const subAccess = makeSubAccess('call-int2', { messages: [], status: 'running' })
        // 守卫看 messages.length > 0 || running || failed —— 这里 status=running 通过
        // 改用 completed + 空 messages 模拟"interrupt 之前子流还没启动"的真实场景
        subAccess.subThreadsMap['call-int2'].status = 'completed'
        const ctx = makeContext({
            interruptData: { type: 'stub_tool_select', toolCallId: 'call-int2' },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-int2', name: 'draft_document', args: {}, state: 'input-available' },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: ctx } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(false)
        expect(wrapper.find('.stub-tool-card').exists()).toBe(true)
    })
})
