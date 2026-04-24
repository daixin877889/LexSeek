import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
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
