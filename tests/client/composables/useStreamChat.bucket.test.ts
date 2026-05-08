/**
 * useStreamChat 子代理 bucket 索引测试
 *
 * 验证 SubThreadState.aiMessageIdToIndex 在各类事件下保持正确：
 * - sub_agent_token 累积到同一 messageId 时走 O(1) 索引、不重复 push
 * - sub_agent_thinking_token 同样 O(1) 索引
 * - sub_agent_tool_start 创建独立 AIMessage 也写入索引
 * - sub_agent_tool_end 不影响索引（tool 消息不索引）
 * - rebuildAiMessageIndex 正确遍历 messages 重建索引（hydration 路径）
 *
 * **Feature: useStreamChat-bucket-map-index**
 * **Validates: P2 — 子代理流式期 findIndex O(n) → Map.get O(1)**
 */

import { describe, it, expect } from 'vitest'
import {
  createEmptyBucket,
  mergeEventIntoBucket,
  rebuildAiMessageIndex,
} from '~/composables/useStreamChat'
import type { AgentEvent } from '#shared/types/agentRun'

function toolStartEvent(
  innerToolCallId: string,
  toolName: string,
  cbRunId: string,
  parentToolCallId = 'p-1',
): AgentEvent {
  return {
    type: 'custom_event',
    name: 'sub_agent_tool_start',
    metadata: {
      parentToolCallId,
      agentName: 'sub-agent',
      threadId: 't-1',
    },
    data: { innerToolCallId, toolName, cbRunId, input: {} },
  } as unknown as AgentEvent
}

function toolEndEvent(cbRunId: string, output: any, parentToolCallId = 'p-1'): AgentEvent {
  return {
    type: 'custom_event',
    name: 'sub_agent_tool_end',
    metadata: {
      parentToolCallId,
      agentName: 'sub-agent',
      threadId: 't-1',
    },
    data: { cbRunId, output },
  } as unknown as AgentEvent
}

// mergeEventIntoBucket 内部读法：const md = cev.metadata; m.content += md.delta ?? ''
// 所以 delta 字段在 metadata 上（不在 data）。
function tokenEv(messageId: string, delta: string, parentToolCallId = 'p-1'): AgentEvent {
  return {
    type: 'custom_event',
    name: 'sub_agent_token',
    metadata: {
      parentToolCallId,
      agentName: 'sub-agent',
      threadId: 't-1',
      messageId,
      delta,
    },
    data: {},
  } as unknown as AgentEvent
}

function thinkingEv(messageId: string, delta: string, parentToolCallId = 'p-1'): AgentEvent {
  return {
    type: 'custom_event',
    name: 'sub_agent_thinking_token',
    metadata: {
      parentToolCallId,
      agentName: 'sub-agent',
      threadId: 't-1',
      messageId,
      delta,
    },
    data: {},
  } as unknown as AgentEvent
}

describe('useStreamChat bucket aiMessageIdToIndex', () => {
  it('createEmptyBucket 初始化空索引', () => {
    const bucket = createEmptyBucket('agent', 'thread')
    expect(bucket.aiMessageIdToIndex).toBeInstanceOf(Map)
    expect(bucket.aiMessageIdToIndex.size).toBe(0)
    expect(bucket.messages).toEqual([])
  })

  it('同 messageId 的多个 token 累积到同一条 message（不重复 push）', () => {
    const bucket = createEmptyBucket('a', 't')
    mergeEventIntoBucket(bucket, tokenEv('m-1', 'Hello'))
    mergeEventIntoBucket(bucket, tokenEv('m-1', ', '))
    mergeEventIntoBucket(bucket, tokenEv('m-1', 'world'))

    expect(bucket.messages).toHaveLength(1)
    expect(bucket.messages[0]).toMatchObject({
      type: 'ai',
      id: 'm-1',
      content: 'Hello, world',
    })
    expect(bucket.aiMessageIdToIndex.get('m-1')).toBe(0)
    expect(bucket.aiMessageIdToIndex.size).toBe(1)
  })

  it('不同 messageId 的 token 各自创建独立 message，索引指向正确位置', () => {
    const bucket = createEmptyBucket('a', 't')
    mergeEventIntoBucket(bucket, tokenEv('m-1', 'A'))
    mergeEventIntoBucket(bucket, tokenEv('m-2', 'B'))
    mergeEventIntoBucket(bucket, tokenEv('m-1', 'A2'))

    expect(bucket.messages).toHaveLength(2)
    expect(bucket.aiMessageIdToIndex.get('m-1')).toBe(0)
    expect(bucket.aiMessageIdToIndex.get('m-2')).toBe(1)
    expect(bucket.messages[0].content).toBe('AA2')
    expect(bucket.messages[1].content).toBe('B')
  })

  it('thinking token 累积到 additional_kwargs.reasoning_content，索引同步', () => {
    const bucket = createEmptyBucket('a', 't')
    mergeEventIntoBucket(bucket, thinkingEv('m-1', '思考1。'))
    mergeEventIntoBucket(bucket, thinkingEv('m-1', '思考2。'))

    expect(bucket.messages).toHaveLength(1)
    expect(bucket.messages[0].additional_kwargs?.reasoning_content).toBe('思考1。思考2。')
    expect(bucket.aiMessageIdToIndex.get('m-1')).toBe(0)
  })

  it('sub_agent_tool_start 创建独立 AIMessage 时也写入索引', () => {
    const bucket = createEmptyBucket('a', 't')
    mergeEventIntoBucket(bucket, toolStartEvent('inner-1', 'search', 'run-1'))

    expect(bucket.messages).toHaveLength(1)
    const ai = bucket.messages[0]
    expect(ai.type).toBe('ai')
    expect(ai.id).toBe('run-1')
    expect(ai.tool_calls).toEqual([
      { id: 'inner-1', name: 'search', args: {} },
    ])
    expect(bucket.aiMessageIdToIndex.get('run-1')).toBe(0)
  })

  it('sub_agent_tool_end push 的 ToolMessage 不写入 aiMessageIdToIndex', () => {
    const bucket = createEmptyBucket('a', 't')
    mergeEventIntoBucket(bucket, toolStartEvent('inner-1', 'search', 'run-1'))
    mergeEventIntoBucket(bucket, toolEndEvent('run-1', { ok: true }))

    expect(bucket.messages).toHaveLength(2)
    expect(bucket.messages[1].type).toBe('tool')
    // 索引只记录第一条 AI message，tool message 不入索引
    expect(bucket.aiMessageIdToIndex.size).toBe(1)
    expect(bucket.aiMessageIdToIndex.get('run-1')).toBe(0)
  })

  it('混合事件流：tool_start → token → tool_end → 新 messageId token，索引始终正确', () => {
    const bucket = createEmptyBucket('a', 't')
    mergeEventIntoBucket(bucket, toolStartEvent('inner-1', 'search', 'run-1'))
    mergeEventIntoBucket(bucket, tokenEv('msg-A', '回答开始'))
    mergeEventIntoBucket(bucket, toolEndEvent('run-1', { ok: true }))
    mergeEventIntoBucket(bucket, tokenEv('msg-A', '。继续。'))
    mergeEventIntoBucket(bucket, tokenEv('msg-B', '另一段'))

    expect(bucket.messages).toHaveLength(4)
    // [0] tool_start AI、[1] msg-A AI、[2] tool_end ToolMessage、[3] msg-B AI
    expect(bucket.aiMessageIdToIndex.get('run-1')).toBe(0)
    expect(bucket.aiMessageIdToIndex.get('msg-A')).toBe(1)
    expect(bucket.aiMessageIdToIndex.get('msg-B')).toBe(3)
    expect(bucket.messages[1].content).toBe('回答开始。继续。')
  })

  it('rebuildAiMessageIndex 从 messages 数组重建索引，跳过非 AI 消息和无 id 消息', () => {
    const messages = [
      { type: 'ai', id: 'a-1', content: 'x' },
      { type: 'tool', tool_call_id: 'tc-1', content: 'r' },
      { type: 'ai', id: 'a-2', content: 'y' },
      { type: 'ai', content: 'z' }, // 无 id 的 AI 消息（罕见但要兜住）
      { type: 'human', id: 'h-1', content: '问' },
    ]
    const idx = rebuildAiMessageIndex(messages)
    expect(idx.size).toBe(2)
    expect(idx.get('a-1')).toBe(0)
    expect(idx.get('a-2')).toBe(2)
    expect(idx.has('h-1')).toBe(false)
    expect(idx.has('tc-1')).toBe(false)
  })

  it('rebuildAiMessageIndex 兼容 BaseMessage 实例（用 _getType 判断）', () => {
    // 模拟 BaseMessage 实例：用 _getType 方法而非 type 字段
    const messages = [
      { _getType: () => 'ai', id: 'a-1', content: 'x' },
      { _getType: () => 'human', id: 'h-1', content: '问' },
      { _getType: () => 'ai', id: 'a-2', content: 'y' },
    ]
    const idx = rebuildAiMessageIndex(messages)
    expect(idx.size).toBe(2)
    expect(idx.get('a-1')).toBe(0)
    expect(idx.get('a-2')).toBe(2)
  })
})
