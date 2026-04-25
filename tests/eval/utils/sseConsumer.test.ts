import { describe, it, expect } from 'vitest'
import { consumeAgentSseStream } from './sseConsumer'

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(s))
      controller.close()
    },
  })
}

describe('consumeAgentSseStream', () => {
  it('解析 named events 提取最终 AI message', async () => {
    const sse = [
      'event: messages',
      'data: {"role":"assistant","content":"hello"}',
      '',
      'event: values',
      'data: {"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"final answer 内容"}]}',
      '',
      'event: custom',
      'data: {"threadId":"thread-abc","status":"ok"}',
      '',
    ].join('\n')

    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.finalAnswer).toBe('final answer 内容')
    expect(result.threadId).toBe('thread-abc')
  })

  it('多个 values event 取最后一个的最后 AI message', async () => {
    const sse = [
      'event: values',
      'data: {"messages":[{"role":"assistant","content":"中间答案"}]}',
      '',
      'event: values',
      'data: {"messages":[{"role":"user","content":"q"},{"role":"assistant","content":"最终答案"}]}',
      '',
    ].join('\n')
    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.finalAnswer).toBe('最终答案')
  })

  it('空流返回空字符串', async () => {
    const result = await consumeAgentSseStream(streamFromString(''))
    expect(result.finalAnswer).toBe('')
    expect(result.threadId).toBe('')
  })

  it('threadId 兜底：custom event 不带 threadId 时，从 values event 的 configurable.thread_id 抽取', async () => {
    const sse = [
      'event: custom',
      'data: {"type":"status_change","status":"running"}',
      '',
      'event: values',
      'data: {"messages":[{"role":"assistant","content":"a"}],"configurable":{"thread_id":"sess-uuid-1"}}',
      '',
    ].join('\n')
    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.threadId).toBe('sess-uuid-1')
  })

  it('threadId 兜底：snake_case thread_id 顶层字段', async () => {
    const sse = [
      'event: custom',
      'data: {"thread_id":"sess-uuid-2","type":"x"}',
      '',
    ].join('\n')
    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.threadId).toBe('sess-uuid-2')
  })

  it('threadId 兜底：values event 顶层 thread_id 字段', async () => {
    const sse = [
      'event: values',
      'data: {"messages":[],"thread_id":"sess-uuid-3"}',
      '',
    ].join('\n')
    const result = await consumeAgentSseStream(streamFromString(sse))
    expect(result.threadId).toBe('sess-uuid-3')
  })
})
