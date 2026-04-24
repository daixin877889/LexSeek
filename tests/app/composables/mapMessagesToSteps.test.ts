import { describe, it, expect } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { mapMessagesToSteps } from '~/components/ai/composables/mapMessagesToSteps'

describe('mapMessagesToSteps', () => {
  it('空消息数组返回空 steps', () => {
    expect(mapMessagesToSteps([], false)).toEqual([])
  })

  it('首条 HumanMessage（子 Agent 问题）不成 Step', () => {
    const msgs = [
      { type: 'human', content: '请分析风险' } as any,
    ]
    expect(mapMessagesToSteps(msgs, false)).toEqual([])
  })

  it('AIMessage 仅含 thinking → 「思考」Step', () => {
    const m = new AIMessage({
      content: '',
      additional_kwargs: { reasoning_content: '让我想想违约责任' },
    })
    const steps = mapMessagesToSteps([m], true /* running */)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      kind: 'thinking',
      label: '思考',
      status: 'active',
      isActive: true,
      fullContent: '让我想想违约责任',
    })
    expect(steps[0].description.length).toBeLessThanOrEqual(80)
  })

  it('AIMessage 同时含 thinking + content + tool_calls → 拆成 3 个 Step（思考/分析/工具）', () => {
    const m = new AIMessage({
      content: '基于上面的分析，我先查合同条款。',
      additional_kwargs: { reasoning_content: '违约责任需要三要素' },
      tool_calls: [{ id: 'call_1', name: 'search_case_materials', args: { query: '违约' }, type: 'tool_call' }],
    })
    const steps = mapMessagesToSteps([m], true)
    expect(steps).toHaveLength(3)
    expect(steps[0].kind).toBe('thinking')
    expect(steps[1].kind).toBe('analysis')
    expect(steps[2].kind).toBe('tool_call')
    expect(steps[2].toolName).toBe('search_case_materials')
    expect(steps[2].toolCallId).toBe('call_1')
  })

  it('ToolMessage 不单独成 Step，而是挂到对应 tool_call 的 toolResult', () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_1', name: 'search_law', args: { q: 'x' }, type: 'tool_call' }],
    })
    const tool = new ToolMessage({
      tool_call_id: 'call_1',
      content: JSON.stringify([{ title: '民法典 577' }]),
    })
    const final = new AIMessage({ content: '综合来看，违约成立' })
    const steps = mapMessagesToSteps([ai, tool, final], false /* finished */)

    // 1 个 tool_call + 1 个 conclusion = 2 个
    expect(steps).toHaveLength(2)
    expect(steps[0].kind).toBe('tool_call')
    expect(steps[0].status).toBe('complete')
    expect(steps[0].toolResult).toEqual([{ title: '民法典 577' }])

    expect(steps[1].kind).toBe('conclusion')
    expect(steps[1].status).toBe('complete')
    expect(steps[1].fullContent).toBe('综合来看，违约成立')
  })

  it('最后一条 AIMessage 的 content 始终映射为「得出结论」Step', () => {
    const ai1 = new AIMessage({ content: '先查材料' })  // 非最后 → analysis
    const ai2 = new AIMessage({ content: '结论：中高' }) // 最后 → conclusion
    const steps = mapMessagesToSteps([ai1, ai2], false)
    expect(steps.map(s => s.kind)).toEqual(['analysis', 'conclusion'])
    expect(steps[1].label).toBe('得出结论')
  })

  it('running=true 时最后一个非工具 Step 为 active；finished 时全部 complete', () => {
    const msgs = [new AIMessage({ content: '结论' })]
    expect(mapMessagesToSteps(msgs, true)[0].status).toBe('active')
    expect(mapMessagesToSteps(msgs, false)[0].status).toBe('complete')
  })

  it('hasMore 判定：content ≤ 80 字时 hasMore=false', () => {
    const m = new AIMessage({ content: '短结论' })
    const [s] = mapMessagesToSteps([m], false)
    expect(s.hasMore).toBe(false)

    const long = new AIMessage({ content: 'x'.repeat(200) })
    const [s2] = mapMessagesToSteps([long], false)
    expect(s2.hasMore).toBe(true)
  })

  it('tool_call 的 args 精简摘要取 JSON.stringify 前 60 字', () => {
    const m = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_1', name: 't', args: { q: 'x'.repeat(200) }, type: 'tool_call' }],
    })
    const [s] = mapMessagesToSteps([m], true)
    expect(s.description.length).toBeLessThanOrEqual(60 + 3 /* "..." */)
  })

  it('非数组或非 search 结构的 tool_result 不走 SearchResults', () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'any', args: {}, type: 'tool_call' }],
    })
    const tool = new ToolMessage({ tool_call_id: 'c1', content: '{"ok":true}' })
    const [step] = mapMessagesToSteps([ai, tool], false)
    expect(step.kind).toBe('tool_call')
    // toolResult 按 JSON.parse 成功后放 object，前端用 looksLikeSearchResult 判定
    expect(step.toolResult).toEqual({ ok: true })
  })
})
