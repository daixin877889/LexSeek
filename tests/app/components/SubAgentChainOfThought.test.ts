import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import SubAgentChainOfThought from '~/components/ai/SubAgentChainOfThought.vue'

const globalStubs = {
  global: {
    stubs: {
      ChainOfThoughtStep: {
        template: '<div data-stub="cot-step"><slot name="icon" /><span data-stub="cot-step-label">{{ label }}</span><span data-stub="cot-step-description">{{ description }}</span><slot /></div>',
        props: ['label', 'description', 'status', 'class'],
      },
      MessageResponse: {
        template: '<div data-stub="message-response">{{ content }}</div>',
        props: ['content', 'mode'],
      },
      Loader2: true,
      Lightbulb: true,
      FileText: true,
      Wrench: true,
      CheckCircle2: true,
    },
  },
}

describe('SubAgentChainOfThought (static render)', () => {
  it('渲染 agentTitle 到标题行', () => {
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

  it('根据 subMessages 渲染对应步骤数（跑中态默认展开）', async () => {
    const msgs = [
      new AIMessage({
        content: '结论',
        tool_calls: [{ id: 'c1', name: 'search_law', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: '[{"title":"民法典"}]' }),
      new AIMessage({ content: '最终结论' }),
    ]
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: msgs, isRunning: true },
      ...globalStubs,
    })
    // 工具步骤用轻量渲染：显示中文工具名和结果摘要
    expect(w.text()).toContain('法律检索')
    expect(w.text()).toContain('找到 1 条结果')
    expect(w.text()).toContain('得出结论')
  })

  it('JSON 碎片内容不渲染为分析步骤', async () => {
    const msgs = [
      new AIMessage({
        content: '{}{"k": 10}',
        tool_calls: [{ id: 'c1', name: 'search_case_analysis', args: { k: 10 }, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: '[]' }),
    ]
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: msgs, isRunning: true },
      ...globalStubs,
    })
    // 原始 JSON 碎片不应出现
    expect(w.text()).not.toContain('{"k":')
    expect(w.text()).not.toContain('{}')
  })

  it('跑完后（isRunning=false + !isFailed）整个 CoT 默认折叠节省空间', async () => {
    const msgs = [
      new AIMessage({ content: '完整分析'.repeat(40) }),
    ]
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: msgs, isRunning: false },
      ...globalStubs,
    })
    // CoT 折叠态：header 标题可见，但 content 隐藏（CollapsibleContent state=closed）
    expect(w.text()).toContain('x')
    expect(w.text()).toContain('已完成')
  })

  it('失败时 CoT 默认展开让用户看到错误', async () => {
    const msgs = [new AIMessage({ content: '失败前进度' })]
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: msgs, isRunning: false, isFailed: true, failureReason: '模型超时' },
      ...globalStubs,
    })
    expect(w.text()).toContain('失败')
    expect(w.text()).toContain('模型超时')
    expect(w.text()).toContain('失败前进度')  // content 可见
  })
})

describe('SubAgentChainOfThought · per-step expand', () => {
  it('长文本 step 默认收起（非 active），点击后展开', async () => {
    // 用 isFailed=true 让 CoT 默认展开，同时 isRunning=false 让 step 不是 active
    // （这样 step 默认折叠才是有效断言；跑中态最后一条 step 自动 active 即默认展开）
    const longContent = 'a'.repeat(300)
    const msg = new AIMessage({ content: longContent })
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [msg], isRunning: false, isFailed: true },
      ...globalStubs,
    })
    // 默认收起：摘要可见，全文不可见
    expect(w.text()).toContain('a'.repeat(80))
    expect(w.text()).not.toContain('a'.repeat(200))

    // 点击摘要展开
    await w.find('.cursor-pointer').trigger('click')
    // 展开后 MessageResponse 渲染全文，摘要 div 应隐藏
    expect(w.text()).toContain('a'.repeat(200))
  })

  it('isRunning 时 active step 默认展开', async () => {
    const longContent = 'a'.repeat(300)
    const msg = new AIMessage({ content: longContent })
    const w = mount(SubAgentChainOfThought, {
      props: { agentTitle: 'x', subMessages: [msg], isRunning: true },
      ...globalStubs,
    })
    // active 状态下默认展开 → 全文渲染
    expect(w.text()).toContain('a'.repeat(200))
  })
})
