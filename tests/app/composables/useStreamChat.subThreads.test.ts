import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
// mergeEventIntoBucket 将 export 供测试（见 Step 2）
import {
  mergeEventIntoBucket,
  createEmptyBucket,
  type SubThreadState,
} from '~/composables/useStreamChat'

describe('useStreamChat · subThreadsMap 分桶 reducer', () => {
  it('sub_agent_token 事件按 messageId 累积到同一 AIMessage.content', () => {
    const b = createEmptyBucket('expert_a', 'sess_sub_a')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'expert_a', threadId: 'sess_sub_a', parentToolCallId: 'p1', messageId: 'm1', delta: '基' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'expert_a', threadId: 'sess_sub_a', parentToolCallId: 'p1', messageId: 'm1', delta: '于' },
    } as any)
    expect(b.messages).toHaveLength(1)
    expect((b.messages[0] as any).content).toBe('基于')
    expect((b.messages[0] as any).id).toBe('m1')
  })

  it('sub_agent_tool_start 建 tool_call step + 记录 cbRunId → innerToolCallId 映射', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner1', input: '{"q":"x"}', cbRunId: 'run_x' },
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    expect(b.runIdToInnerToolCallId.get('run_x')).toBe('inner1')
  })

  it('sub_agent_tool_end 通过 cbRunId 回查 innerToolCallId，把 output 挂到对应 ToolMessage', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner1', input: '{"q":"x"}', cbRunId: 'run_x' },
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_end',
      data: { cbRunId: 'run_x', output: JSON.stringify([{ title: '命中1' }]) },
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    // 产生一条 tool type 的消息，tool_call_id=inner1
    const toolMsg = b.messages.find((m: any) => m.type === 'tool' && m.tool_call_id === 'inner1')
    expect(toolMsg).toBeTruthy()
  })

  it('status_change=completed 翻桶状态', () => {
    const b = createEmptyBucket('e', 't')
    expect(b.status).toBe('running')
    mergeEventIntoBucket(b, {
      type: 'status_change', runId: 'r', sessionId: 's', status: 'completed',
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    expect(b.status).toBe('completed')
  })

  it('status_change=failed 翻桶状态 + 记录 error', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'status_change', runId: 'r', sessionId: 's', status: 'failed', error: '超时',
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p' },
    } as any)
    expect(b.status).toBe('failed')
    expect(b.error).toBe('超时')
  })

  it('sub_agent_thinking_token 累积到 AIMessage.additional_kwargs.reasoning_content', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_thinking_token',
      data: undefined,
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p', messageId: 'm1', delta: '让我' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_thinking_token',
      data: undefined,
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p', messageId: 'm1', delta: '推理' },
    } as any)
    expect(b.messages).toHaveLength(1)
    const msg = b.messages[0] as any
    expect(msg.id).toBe('m1')
    expect(msg.content).toBe('')
    expect(msg.additional_kwargs?.reasoning_content).toBe('让我推理')
  })

  it('sub_agent_thinking_token 与 sub_agent_token 共用同一 messageId 时分别累 thinking / content', () => {
    const b = createEmptyBucket('e', 't')
    // 先到一个 thinking delta（创建 AIMessage）
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_thinking_token',
      data: undefined,
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p', messageId: 'm1', delta: '思考A' },
    } as any)
    // 再来一个普通 text delta（命中已有 AIMessage）
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p', messageId: 'm1', delta: '回复A' },
    } as any)
    expect(b.messages).toHaveLength(1)
    const msg = b.messages[0] as any
    expect(msg.content).toBe('回复A')
    expect(msg.additional_kwargs?.reasoning_content).toBe('思考A')
  })

  it('sub_agent_thinking_token 空 delta → 不触发任何变更', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_thinking_token',
      data: undefined,
      metadata: { agentName: 'e', threadId: 't', parentToolCallId: 'p', messageId: 'm1', delta: '' },
    } as any)
    expect(b.messages).toHaveLength(0)
  })

  it('sub_agent_tool_start 创建独立 AIMessage（id=cbRunId）含 tool_call，token 累积的 AIMessage 不被污染', () => {
    const b = createEmptyBucket('expert_a', 'sess_sub_a')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p1', messageId: 'm1', delta: '我打算搜法律法规' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner-1', input: '{"q":"民间借贷"}', cbRunId: 'cb-x', toolName: 'search_law' },
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p1' },
    } as any)
    const aiM1 = b.messages.find((m: any) => m.id === 'm1') as any
    expect(aiM1.content).toBe('我打算搜法律法规')
    expect(aiM1.tool_calls ?? []).toHaveLength(0)
    const aiTool = b.messages.find((m: any) => m.id === 'cb-x') as any
    expect(aiTool).toBeTruthy()
    expect(aiTool.tool_calls).toHaveLength(1)
    expect(aiTool.tool_calls[0]).toEqual({
      id: 'inner-1',
      name: 'search_law',
      args: { q: '民间借贷' },
    })
    expect(b.runIdToInnerToolCallId.get('cb-x')).toBe('inner-1')
  })

  it('sub_agent_tool_start args 不是合法 JSON 时保留原 string', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p', messageId: 'm-x', delta: 'x' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner-2', input: '不是 json', cbRunId: 'cb', toolName: 'process_materials' },
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p' },
    } as any)
    const aiTool = b.messages.find((m: any) => m.id === 'cb') as any
    expect(aiTool.tool_calls[0].args).toBe('不是 json')
  })

  it('同 innerToolCallId 重复 tool_start（幂等）→ tool_calls 不重复 push（不创建第二条 AIMessage）', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p', messageId: 'm', delta: 'x' },
    } as any)
    const evt = {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner-d', input: 'x', cbRunId: 'cb', toolName: 't' },
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p' },
    } as any
    mergeEventIntoBucket(b, evt)
    mergeEventIntoBucket(b, evt)
    const allCalls = b.messages.flatMap((m: any) => m.tool_calls ?? [])
    expect(allCalls.filter((c: any) => c?.id === 'inner-d')).toHaveLength(1)
  })

  it('tool_start 缺 toolName（旧版后端兼容）→ 不注入 tool_calls，仅记 cbRunId 映射', () => {
    const b = createEmptyBucket('e', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_token',
      data: undefined,
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p', messageId: 'm', delta: 'x' },
    } as any)
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'inner-old', input: 'x', cbRunId: 'cb' },  // 无 toolName
      metadata: { agentName: 'a', threadId: 't', parentToolCallId: 'p' },
    } as any)
    const ai = b.messages.find((m: any) => m.id === 'm') as any
    expect(ai.tool_calls ?? []).toHaveLength(0)
    expect(b.runIdToInnerToolCallId.get('cb')).toBe('inner-old')
  })

  it('tool_start 时 bucket 没有 AIMessage（stage 适配器路径）→ 创建空 AIMessage 把 tool_call 推进去', () => {
    const b = createEmptyBucket('contractReviewMain', 't')
    mergeEventIntoBucket(b, {
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: 'cr-segment', input: '', cbRunId: 'cr-segment', toolName: '切分合同条款' },
      metadata: { agentName: 'contractReviewMain', threadId: 't', parentToolCallId: 'p' },
    } as any)
    const ais = b.messages.filter((m: any) => m._getType?.() === 'ai' || m.type === 'ai') as any[]
    expect(ais).toHaveLength(1)
    expect(ais[0].id).toBe('cr-segment')
    expect(ais[0].tool_calls).toHaveLength(1)
    expect(ais[0].tool_calls[0]).toEqual({ id: 'cr-segment', name: '切分合同条款', args: '' })
    expect(b.runIdToInnerToolCallId.get('cr-segment')).toBe('cr-segment')
  })

  it('多个连续 tool_start（无 token 在前）→ 每个都创建独立 AIMessage', () => {
    const b = createEmptyBucket('contractReviewMain', 't')
    const make = (stage: string, name: string) => ({
      type: 'custom_event', runId: 'r', sessionId: 's', name: 'sub_agent_tool_start',
      data: { innerToolCallId: `cr-${stage}`, input: '', cbRunId: `cr-${stage}`, toolName: name },
      metadata: { agentName: 'contractReviewMain', threadId: 't', parentToolCallId: 'p' },
    } as any)
    mergeEventIntoBucket(b, make('segment', '切分合同条款'))
    mergeEventIntoBucket(b, make('detect', '识别甲乙方'))
    mergeEventIntoBucket(b, make('stance', '确认审查立场'))
    const ais = b.messages.filter((m: any) => m._getType?.() === 'ai' || m.type === 'ai') as any[]
    expect(ais).toHaveLength(3)
    expect(ais[0].tool_calls[0].name).toBe('切分合同条款')
    expect(ais[1].tool_calls[0].name).toBe('识别甲乙方')
    expect(ais[2].tool_calls[0].name).toBe('确认审查立场')
  })
})
