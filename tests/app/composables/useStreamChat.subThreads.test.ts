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
})
