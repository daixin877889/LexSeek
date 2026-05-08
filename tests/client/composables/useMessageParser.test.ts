/**
 * useMessageParser 增量缓存测试
 *
 * 验证 AI / human 消息缓存在以下关键路径下的正确行为：
 * 1. 历史消息实例稳定时复用 ParsedMessage 引用（避免重复 extractThinking + matchToolCalls）
 * 2. 流式 AI 消息每次新实例（模拟 langgraph-sdk concat chunk）必须重新解析
 * 3. ToolMessage 到达时对应 AIMessage 缓存失效（toolCall.state input-available → output-available）
 * 4. interrupted 切换时缓存失效（toolCall.state input-available → input-paused）
 * 5. extras 注入合成卡片时缓存失效
 * 6. 人类消息实例稳定时直接返回同 ParsedMessage 引用
 *
 * **Feature: useMessageParser-incremental-cache**
 * **Validates: 消息越多越卡（P1）— 历史消息每个 SSE chunk 都重算 O(n) 解析的开销**
 */

import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import {
  useMessageParser,
  type ToolCallWithResult,
} from '~/components/ai/composables/useMessageParser'

describe('useMessageParser 增量缓存', () => {
  it('AI 消息实例稳定时跨 messages 数组重排复用 ParsedMessage 引用', () => {
    const ai = new AIMessage({ id: 'ai-1', content: 'hello world' })
    const messages = ref<any[]>([ai])
    const { parsedMessages } = useMessageParser(messages)

    const first = parsedMessages.value[0]
    expect(first?.content).toBe('hello world')

    // 数组引用变化但内部实例不变（典型场景：langgraph-sdk 每次 stream tick 都返回新数组）
    messages.value = [ai]

    const second = parsedMessages.value[0]
    // 缓存命中：ParsedMessage 是同一引用，下游 v-memo 不会重渲染
    expect(second).toBe(first)
  })

  it('AI 消息切换为新实例（模拟流式 chunk concat）必然重算', () => {
    const messages = ref<any[]>([])
    const { parsedMessages } = useMessageParser(messages)

    const chunk1 = new AIMessage({ id: 'ai-1', content: 'h' })
    messages.value = [chunk1]
    const r1 = parsedMessages.value[0]
    expect(r1?.content).toBe('h')

    // 流式累积：MessageTupleManager.add 用 prev.concat(chunk) 产生新实例
    const chunk2 = new AIMessage({ id: 'ai-1', content: 'hello' })
    messages.value = [chunk2]
    const r2 = parsedMessages.value[0]

    expect(r2).not.toBe(r1)
    expect(r2?.content).toBe('hello')
  })

  it('ToolMessage 到达后对应 AIMessage 缓存失效，state 切到 output-available', () => {
    const ai = new AIMessage({
      id: 'ai-1',
      content: '',
      tool_calls: [{ id: 'tc-1', name: 'search', args: {} }],
    })
    const messages = ref<any[]>([ai])
    const { parsedMessages } = useMessageParser(messages)

    const r1 = parsedMessages.value[0]
    expect(r1?.toolCalls?.[0]?.state).toBe('input-available')

    // ToolMessage 到达
    const tm = new ToolMessage({ tool_call_id: 'tc-1', content: 'search-result' })
    messages.value = [ai, tm]

    const r2 = parsedMessages.value[0]
    // ai 实例没变，但 toolResults 引用变了 → 缓存失效
    expect(r2).not.toBe(r1)
    expect(r2?.toolCalls?.[0]?.state).toBe('output-available')
  })

  it('interrupted 切换时缓存失效，未完成 toolCall 重标记为 input-paused', () => {
    const ai = new AIMessage({
      id: 'ai-1',
      content: '',
      tool_calls: [{ id: 'tc-1', name: 'search', args: {} }],
    })
    const messages = ref<any[]>([ai])
    const interrupted = ref(false)
    const { parsedMessages } = useMessageParser(messages, interrupted)

    const r1 = parsedMessages.value[0]
    expect(r1?.toolCalls?.[0]?.state).toBe('input-available')

    interrupted.value = true
    const r2 = parsedMessages.value[0]
    expect(r2).not.toBe(r1)
    expect(r2?.toolCalls?.[0]?.state).toBe('input-paused')

    interrupted.value = false
    const r3 = parsedMessages.value[0]
    expect(r3).not.toBe(r2)
    expect(r3?.toolCalls?.[0]?.state).toBe('input-available')
  })

  it('extras 注入合成卡片时缓存失效，toolCalls 末尾追加 synthetic', () => {
    const ai = new AIMessage({
      id: 'ai-1',
      content: 'done',
      tool_calls: [{ id: 'tc-1', name: 'save', args: {} }],
    })
    const tm = new ToolMessage({ tool_call_id: 'tc-1', content: 'ok' })
    const messages = ref<any[]>([ai, tm])
    const extras = ref<Record<string, ToolCallWithResult[]>>({})
    const { parsedMessages } = useMessageParser(messages, undefined, extras)

    const r1 = parsedMessages.value[0]
    expect(r1?.toolCalls?.length).toBe(1)

    extras.value = {
      'ai-1': [
        {
          id: 'synth-1',
          name: 'generate_summary',
          args: {},
          state: 'input-available',
        },
      ],
    }

    const r2 = parsedMessages.value[0]
    expect(r2).not.toBe(r1)
    expect(r2?.toolCalls?.length).toBe(2)
    expect(r2?.toolCalls?.[1]?.name).toBe('generate_summary')
  })

  it('人类消息实例稳定时跨数组重排复用 ParsedMessage 引用', () => {
    const human = new HumanMessage({ id: 'h-1', content: '你好，小索' })
    const messages = ref<any[]>([human])
    const { parsedMessages } = useMessageParser(messages)

    const r1 = parsedMessages.value[0]
    expect(r1?.type).toBe('human')

    // 追加一条 AI 消息触发数组引用变化
    const ai = new AIMessage({ id: 'ai-1', content: 'hi' })
    messages.value = [human, ai]

    const r2 = parsedMessages.value[0]
    expect(r2).toBe(r1)
  })

  it('response_metadata 引用变化时缓存失效（防止 contentBlocks getter 派生结果 stale）', () => {
    // contentBlocks 在 @langchain/core 是 getter，依赖 content + response_metadata 派生。
    // 我们没快照 contentBlocks（每次返回新数组会让缓存永远 miss），但 response_metadata
    // 引用变化时必须让缓存失效——否则 extractThinking 拿到的 contentBlocks 会是 stale。
    const ai = new AIMessage({
      id: 'ai-1',
      content: 'plain',
      response_metadata: { model_provider: 'openai' },
    })
    const messages = ref<any[]>([ai])
    const { parsedMessages } = useMessageParser(messages)

    const r1 = parsedMessages.value[0]
    expect(r1).toBeTruthy()

    // mutate response_metadata 引用（模拟 metadata 流式更新）
    ;(ai as any).response_metadata = { model_provider: 'anthropic', output_version: 'v1' }
    messages.value = [ai]

    const r2 = parsedMessages.value[0]
    expect(r2).not.toBe(r1)
  })

  it('混合场景：流式中最后一条 AI 重算，前面所有历史消息引用稳定', () => {
    const human = new HumanMessage({ id: 'h-1', content: '问题' })
    const aiHistory = new AIMessage({ id: 'ai-history', content: '历史回答' })
    const messages = ref<any[]>([human, aiHistory])
    const { parsedMessages } = useMessageParser(messages)

    const before = parsedMessages.value
    const humanBefore = before[0]
    const aiHistoryBefore = before[1]

    // 模拟流式：追加一条新的、每次 chunk 替换为新实例的 AI 消息
    const aiStreamChunk1 = new AIMessage({ id: 'ai-stream', content: '答' })
    messages.value = [human, aiHistory, aiStreamChunk1]
    const after1 = parsedMessages.value
    expect(after1[0]).toBe(humanBefore)         // 人类消息稳定
    expect(after1[1]).toBe(aiHistoryBefore)     // 历史 AI 消息稳定

    const aiStreamChunk2 = new AIMessage({ id: 'ai-stream', content: '答案' })
    messages.value = [human, aiHistory, aiStreamChunk2]
    const after2 = parsedMessages.value
    expect(after2[0]).toBe(humanBefore)         // 人类消息仍稳定
    expect(after2[1]).toBe(aiHistoryBefore)     // 历史 AI 消息仍稳定
    expect(after2[2]).not.toBe(after1[2])       // 流式 AI 实例变了 → 重算
    expect(after2[2]?.content).toBe('答案')
  })
})
