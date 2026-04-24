import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import SubAgentChainOfThought from '~/components/ai/SubAgentChainOfThought.vue'

const globalStubs = {
  global: {
    stubs: {
      // ai-elements 组件在测试环境挂 stub，避免内部依赖问题
      ChainOfThought: {
        template: '<div data-stub="chain-of-thought"><slot /><slot name="default" /></div>',
        props: ['modelValue'],
      },
      ChainOfThoughtHeader: {
        template: '<div data-stub="cot-header"><slot /></div>',
      },
      ChainOfThoughtStep: {
        template: '<div data-stub="cot-step"><slot name="icon" /><slot /></div>',
        props: ['label', 'description', 'status', 'class'],
      },
      ChainOfThoughtContent: {
        template: '<div data-stub="cot-content"><slot /></div>',
      },
      ChainOfThoughtSearchResults: {
        template: '<div data-stub="cot-search-results"><slot /></div>',
      },
      ChainOfThoughtSearchResult: {
        template: '<div data-stub="cot-search-result"><slot /></div>',
      },
      AiToolRenderer: true,
      AiElementsMessageResponse: true,
      Loader2: true,
      Brain: true,
      FileText: true,
      Wrench: true,
      CheckCircle2: true,
    },
  },
}

describe('SubAgentChainOfThought (static render)', () => {
  it('渲染 agentTitle 到 Header', () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: '风险评估专家', subMessages: [], isRunning: false },
      ...globalStubs,
    })
    expect(w.text()).toContain('风险评估专家')
  })

  it('isRunning=true 显示"思考中…"', () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
      ...globalStubs,
    })
    expect(w.text()).toContain('思考中')
  })

  it('isFailed=true + reason 显示红色徽章', () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: false, isFailed: true, failureReason: '超时' },
      ...globalStubs,
    })
    expect(w.text()).toContain('失败')
    expect(w.text()).toContain('超时')
  })

  it('根据 subMessages 渲染对应步骤数', async () => {
    const msgs = [
      new AIMessage({
        content: '结论',
        tool_calls: [{ id: 'c1', name: 'search_law', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: '[{"title":"民法典"}]' }),
      new AIMessage({ content: '最终结论' }),
    ]
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: msgs, isRunning: false, open: true },
      ...globalStubs,
    })
    // 1 个 analysis + 1 个 tool_call + 1 个 conclusion
    expect(w.text()).toContain('调用 search_law')
    expect(w.text()).toContain('得出结论')
  })
})

describe('SubAgentChainOfThought · auto-collapse', () => {
  it('isRunning 由 false→true 时自动展开（isOpen=true）', async () => {
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: false },
      ...globalStubs,
    })
    await w.setProps({ isRunning: true })
    await nextTick()
    // isOpen 由内部状态驱动，取出检查
    expect((w.vm as any).isOpen).toBe(true)
  })

  it('isRunning 由 true→false 后 1s 自动收起', async () => {
    vi.useFakeTimers()
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
      ...globalStubs,
    })
    await nextTick()
    expect((w.vm as any).isOpen).toBe(true)

    await w.setProps({ isRunning: false })
    await nextTick()
    // 1s 前仍开
    vi.advanceTimersByTime(500)
    expect((w.vm as any).isOpen).toBe(true)
    // 1s 后收起
    vi.advanceTimersByTime(600)
    expect((w.vm as any).isOpen).toBe(false)

    vi.useRealTimers()
  })

  it('用户手动点开后 → timer 取消 + 不再 auto-close', async () => {
    vi.useFakeTimers()
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
      ...globalStubs,
    })
    await nextTick()
    await w.setProps({ isRunning: false })   // 启动 1s timer
    await nextTick()

    // 用户 500ms 时手动展开（通过 update:open emit）
    vi.advanceTimersByTime(500)
    ;(w.vm as any).isOpen = true   // 模拟用户手动打开
    await nextTick()

    // 再推进超过 1s，不应被 auto-close
    vi.advanceTimersByTime(1200)
    expect((w.vm as any).isOpen).toBe(true)

    vi.useRealTimers()
  })

  it('isFailed=true 时 isRunning 变 false 不触发 auto-close', async () => {
    vi.useFakeTimers()
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [], isRunning: true },
      ...globalStubs,
    })
    await nextTick()
    await w.setProps({ isRunning: false, isFailed: true })
    await nextTick()

    vi.advanceTimersByTime(1500)
    expect((w.vm as any).isOpen).toBe(true)

    vi.useRealTimers()
  })
})

describe('SubAgentChainOfThought · active description throttle', () => {
  it('active step 的 description 读 throttled 值', async () => {
    const msg = new AIMessage({ content: 'a'.repeat(300) })
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [msg], isRunning: true, open: true },
      ...globalStubs,
    })
    await nextTick()
    // throttledActiveDescription 初始已在 immediate 时填入
    const txt = w.text()
    expect(txt).toContain('a'.repeat(80))   // 80 字截断
    expect(txt).not.toContain('a'.repeat(200))
  })
})
